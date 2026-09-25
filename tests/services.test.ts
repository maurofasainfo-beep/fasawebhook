import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToken, decryptToken, validToken } from '@/lib/tokens';
import { readJson, sanitizeHeaders, sourceIp, requireDashboard, pageNumber } from '@/lib/http';
import { createWebhook, present, rotateToken, updateWebhook } from '@/services/webhooks';
import { receive } from '@/services/receiver';
import { fixture, key } from './fixtures';
import type { Json } from '@/types/webhook';

afterEach(() => vi.restoreAllMocks());
const options = { maxPayload: 1024, trustProxy: false };
function req(token?: string, body = '{"event":"order.created","event_id":"evt-1"}', headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/webhooks/receive/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body });
}
describe('tokens e configuração', () => {
  it('gera tokens imprevisíveis, criptografa e recupera sem armazenar texto puro', () => {
    const a = createToken(key), b = createToken(key);
    const token = decryptToken(a.auth_token_encrypted, key);
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(a.auth_token_encrypted).not.toContain(token);
    expect(a.auth_token_hash).not.toBe(b.auth_token_hash);
    expect(validToken(token, a.auth_token_hash)).toBe(true);
    expect(validToken('incorreto', a.auth_token_hash)).toBe(false);
    expect(() => decryptToken(a.auth_token_encrypted, 'b'.repeat(64))).toThrow();
  });
  it('cria webhooks únicos e monta URL dinamicamente sem domínio persistido', async () => {
    const { db } = fixture();
    const a = await createWebhook(db, { name: 'Principal' }, key), b = await createWebhook(db, { name: 'Segunda' }, key);
    expect(a.public_id).not.toBe(b.public_id);
    const view = present(a, 'https://example.com', key);
    expect(view.url).toBe(`https://example.com/api/webhooks/receive/${a.public_id}`);
    expect(view).not.toHaveProperty('auth_token_hash');
    expect(view).not.toHaveProperty('auth_token_encrypted');
    expect(vi.mocked(db.create).mock.calls[0][0]).not.toHaveProperty('url');
  });
  it('ativa e desativa sem alterar URL ou token', async () => {
    const { db, row } = fixture();
    const off = await updateWebhook(db, row.public_id, { name: 'Novo nome', active: false });
    expect(off.active).toBe(false); expect(off.public_id).toBe(row.public_id);
    expect(off.auth_token_hash).toBe(row.auth_token_hash);
    expect((await updateWebhook(db, row.public_id, { name: 'Novo nome', active: true })).active).toBe(true);
  });
  it('exige confirmação e regenera token invalidando o anterior', async () => {
    const { db, row, token } = fixture();
    await expect(rotateToken(db, row.public_id, { confirm: false }, key)).rejects.toMatchObject({ status: 400 });
    const updated = await rotateToken(db, row.public_id, { confirm: true }, key);
    expect(validToken(token, updated.auth_token_hash)).toBe(false);
    expect(validToken(decryptToken(updated.auth_token_encrypted, key), updated.auth_token_hash)).toBe(true);
  });
  it.each([null, {}, { name: '' }, { name: 'a'.repeat(121) }])('rejeita configuração inválida %j', async body => {
    await expect(createWebhook(fixture().db, body as Json, key)).rejects.toMatchObject({ status: 400 });
  });
});
describe('recebimento', () => {
  it('aceita POST, autentica, salva JSON e retorna eventId', async () => {
    const { db, row, token } = fixture();
    const response = await receive(req(token), row.public_id, db, options);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, received: true, eventId: expect.any(String) });
    expect(db.record).toHaveBeenCalledWith(expect.objectContaining({ payload: { event: 'order.created', event_id: 'evt-1' }, external_event_id: 'evt-1', status: 'received' }), row.auth_token_hash);
  });
  it('aceita X-Webhook-Token e application/*+json', async () => {
    const { db, row, token } = fixture();
    expect((await receive(req(undefined, '{}', { 'X-Webhook-Token': token, 'Content-Type': 'application/vnd.delivery+json' }), row.public_id, db, options)).status).toBe(202);
  });
  it.each([undefined, 'token-incorreto'])('rejeita token ausente ou inválido (%s) e registra erro sem body', async token => {
    const { db, row } = fixture();
    expect((await receive(req(token), row.public_id, db, options)).status).toBe(401);
    expect(db.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', http_status: 401, payload: null, headers: { 'content-type': 'application/json' } }));
  });
  it('retorna 404 para UUID inexistente e salva metadados', async () => {
    const { db, row, token } = fixture(); vi.mocked(db.find).mockResolvedValue(null);
    expect((await receive(req(token), row.public_id, db, options)).status).toBe(404);
    expect(db.record).toHaveBeenCalledWith(expect.objectContaining({ webhook_id: null, http_status: 404 }));
  });
  it('retorna 404 para identificador malformado sem consultar banco', async () => {
    const { db } = fixture(); expect((await receive(req(), 'invalid', db, options)).status).toBe(404); expect(db.find).not.toHaveBeenCalled();
  });
  it('rejeita webhook inativo', async () => {
    const { db, row, token } = fixture(); row.active = false;
    expect((await receive(req(token), row.public_id, db, options)).status).toBe(403);
  });
  it.each(['{', '', '{"x":undefined}'])('rejeita JSON inválido %s', async body => {
    const { db, row, token } = fixture(); expect((await receive(req(token, body), row.public_id, db, options)).status).toBe(400);
  });
  it('aceita qualquer valor JSON válido, inclusive null', async () => {
    const { db, row, token } = fixture(); expect((await receive(req(token, 'null'), row.public_id, db, options)).status).toBe(202);
  });
  it.each(['{"value":"\\u0000"}', '{"value":"\\ud800"}', '{"value":1e400}', '['.repeat(130) + '0' + ']'.repeat(130)])('rejeita valores incompatíveis com JSONB sem erro interno (%s)', async body => {
    const { db, row, token } = fixture(); expect((await receive(req(token, body), row.public_id, db, options)).status).toBe(400);
  });
  it('limita bytes reais mesmo sem Content-Length', async () => {
    const { db, row, token } = fixture(); expect((await receive(req(token, JSON.stringify('á'.repeat(600))), row.public_id, db, options)).status).toBe(413);
    expect(db.record).toHaveBeenCalledWith(expect.objectContaining({ payload: null, http_status: 413 }));
  });
  it('rejeita Content-Length excedido antes de ler corpo', async () => {
    await expect(readJson(req('token', '{}', { 'content-length': '9999' }), 1024)).rejects.toMatchObject({ status: 413 });
  });
  it.each<Record<string, string>>([{ 'content-type': 'text/plain' }, { 'content-encoding': 'gzip' }])('rejeita formato/compressão não suportado %j', async headers => {
    const { db, row, token } = fixture(); expect((await receive(req(token, '{}', headers), row.public_id, db, options)).status).toBe(415);
  });
  it('retorna 405 e Allow para método não permitido', async () => {
    const { db, row } = fixture(); const res = await receive(new Request('http://localhost'), row.public_id, db, options);
    expect(res.status).toBe(405); expect(res.headers.get('allow')).toBe('POST');
  });
  it.each(['find', 'record'] as const)('trata falha do Supabase em %s sem vazar segredos', async method => {
    const { db, row, token } = fixture(); vi.mocked(db[method]).mockRejectedValue(new Error('secret-service-role'));
    const res = await receive(req(token), row.public_id, db, options);
    expect(res.status).toBe(500); expect(await res.text()).not.toContain('secret-service-role');
  });
  it('propaga rejeição por mudança concorrente no token', async () => {
    const { db, row, token } = fixture(); vi.mocked(db.record).mockResolvedValue({ id: 'id', http_status: 401, error_message: 'Token ausente ou inválido.' });
    expect((await receive(req(token), row.public_id, db, options)).status).toBe(401);
  });
  it('usa X-Request-ID quando não há event_id e não deduplica automaticamente', async () => {
    const { db, row, token } = fixture(); await receive(req(token, '{}', { 'X-Request-ID': 'request-123' }), row.public_id, db, options);
    expect(db.record).toHaveBeenCalledWith(expect.objectContaining({ external_event_id: 'request-123' }), expect.any(String));
  });
  it('não escreve tokens, payload ou headers sensíveis no log técnico', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { db, row, token } = fixture(); await receive(req(token, '{"password":"payload-secret"}', { Cookie: 'cookie-secret' }), row.public_id, db, options);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${token}|payload-secret|cookie-secret`));
  });
});
describe('limites e sanitização', () => {
  it('usa allowlist e remove todos os headers desconhecidos e credenciais', () => {
    expect(sanitizeHeaders(new Headers({ Authorization: 'secret', Cookie: 'secret', 'Set-Cookie': 'secret', 'X-Api-Key': 'secret', 'API-Key': 'secret', 'X-Private-Token': 'secret', 'Content-Type': 'application/json', 'X-Request-ID': '123' }))).toEqual({ 'content-type': 'application/json', 'x-request-id': '123' });
  });
  it('não confia em IP enviado pelo cliente por padrão', () => {
    const h = new Headers({ 'x-forwarded-for': '192.0.2.1, 127.0.0.1' });
    expect(sourceIp(h, false)).toBeNull(); expect(sourceIp(h, true)).toBe('192.0.2.1');
    expect(sourceIp(new Headers({ 'x-forwarded-for': 'fake' }), true)).toBeNull();
  });
  it('bloqueia mutações cross-origin sem criar autenticação de usuário', () => {
    expect(() => requireDashboard(new Request('http://localhost:3000', { headers: { Origin: 'https://evil.example', 'x-dashboard-request': '1' } }), 'http://localhost:3000')).toThrow();
    expect(() => requireDashboard(new Request('http://localhost:3000', { headers: { Origin: 'http://localhost:3000', 'x-dashboard-request': '1' } }), 'http://localhost:3000')).not.toThrow();
  });
  it('valida paginação e impede offsets sem limite', () => {
    expect(pageNumber('http://localhost?page=2')).toBe(2);
    for (const value of ['0', '-1', '1.5', 'abc', '1000000']) expect(() => pageNumber(`http://localhost?page=${value}`)).toThrow();
  });
});
