import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixtures';
import { GET as list, POST as create } from '@/app/api/admin/webhooks/route';
import { GET as options } from '@/app/api/admin/webhooks/options/route';
import { PATCH as update } from '@/app/api/admin/webhooks/[publicId]/route';
import { POST as rotate } from '@/app/api/admin/webhooks/[publicId]/token/route';
import { GET as events, DELETE as clearEvents } from '@/app/api/admin/events/route';
import { GET as detail, DELETE as deleteEvent } from '@/app/api/admin/events/[id]/route';
import { DELETE as archiveWebhook } from '@/app/api/admin/webhooks/[publicId]/route';
import { POST as receiver, GET as receiverGet } from '@/app/api/webhooks/receive/[publicId]/route';
import { repository } from '@/services/repository';
vi.mock('@/services/repository', () => ({ repository: vi.fn() }));
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-server-key');
  vi.stubEnv('WEBHOOK_TOKEN_ENCRYPTION_KEY', key);
  vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3000');
  f = fixture(); vi.mocked(repository).mockReturnValue(f.db);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost:3000${path}`, { method, headers: { 'x-dashboard-request': '1', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function context() { return { params: Promise.resolve({ publicId: f.row.public_id }) }; }
describe('Route Handlers do Next.js', () => {
  it('lista configurações com token recuperado, sem hash/cifra/credencial Supabase e sem cache', async () => {
    const res = await list(request('/api/admin/webhooks'));
    expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text(); expect(body).toContain(f.token);
    expect(body).not.toMatch(/auth_token_hash|auth_token_encrypted|private-server-key/);
  });
  it('cria configuração pela API', async () => {
    const res = await create(request('/api/admin/webhooks', 'POST', { name: 'Nova' }));
    expect(res.status).toBe(201); expect(await res.json()).toMatchObject({ name: 'Nova', token: expect.any(String) });
  });
  it('salva configuração e gera token pelas rotas', async () => {
    const updated = await update(request('/api/admin/webhooks/test', 'PATCH', { name: 'Nome salvo', active: false }), context());
    expect(updated.status).toBe(200); expect(await updated.json()).toMatchObject({ active: false });
    const res = await rotate(request('/api/admin/webhooks/test/token', 'POST', { confirm: true }), context());
    expect(res.status).toBe(200); expect((await res.json()).token).not.toBe(f.token);
  });
  it('lista logs com página validada e rejeita detalhe inexistente', async () => {
    const listRes = await events(request(`/api/admin/events?page=2&webhookId=${f.row.public_id}`));
    expect(await listRes.json()).toMatchObject({ page: 2, pageSize: 20 }); expect(f.db.events).toHaveBeenCalledWith(2, f.row.public_id);
    const res = await detail(request('/api/admin/events/test'), { params: Promise.resolve({ id: f.row.id }) }); expect(res.status).toBe(404);
    expect((await events(request('/api/admin/events?page=-1'))).status).toBe(400);
  });
  it('lista opções sem token, arquiva sem remover histórico e limpa eventos após seleção', async () => {
    const optionResponse = await options(request('/api/admin/webhooks/options'));
    expect(await optionResponse.json()).toMatchObject({ items: [{ name: 'Integração Principal' }] });
    const archived = await archiveWebhook(request(`/api/admin/webhooks/${f.row.public_id}`, 'DELETE', { confirm: true }), context());
    expect(archived.status).toBe(200); expect(await archived.json()).toMatchObject({ archived: true });
    expect(f.db.update).toHaveBeenCalledWith(f.row.public_id, { deleted_at: expect.any(String) });
    const cleared = await clearEvents(request(`/api/admin/events?webhookId=${f.row.public_id}`, 'DELETE', { confirm: true }));
    expect(cleared.status).toBe(200); expect(await cleared.json()).toMatchObject({ deletedCount: 3 });
    expect(f.db.clearEvents).toHaveBeenCalledWith(f.row.public_id);
  });
  it('exige confirmação explícita ao limpar logs de webhook', async () => {
    const cleared = await clearEvents(request(`/api/admin/events?webhookId=${f.row.public_id}`, 'DELETE', { confirm: false }));
    expect(cleared.status).toBe(400); expect(f.db.clearEvents).not.toHaveBeenCalled();
  });
  it('exclui log individual e devolve 404 quando ele não existe', async () => {
    expect((await deleteEvent(request('/api/admin/events/event-1', 'DELETE'), { params: Promise.resolve({ id: f.row.id }) })).status).toBe(200);
    vi.mocked(f.db.deleteEvent).mockResolvedValue(false);
    expect((await deleteEvent(request('/api/admin/events/event-1', 'DELETE'), { params: Promise.resolve({ id: f.row.id }) })).status).toBe(404);
  });
  it('recusa chamada administrativa de outro site', async () => {
    const res = await create(new Request('http://localhost:3000/api/admin/webhooks', { method: 'POST', headers: { origin: 'https://evil.example', 'x-dashboard-request': '1' } }));
    expect(res.status).toBe(403); expect(f.db.create).not.toHaveBeenCalled();
  });
  it('receiver público funciona sem cabeçalho administrativo ou Origin', async () => {
    const res = await receiver(new Request(`http://localhost:3000/api/webhooks/receive/${f.row.public_id}`, { method: 'POST', headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' }, body: '{}' }), context());
    expect(res.status).toBe(202);
  });
  it('receiver responde 405 mesmo sem configuração do banco', async () => {
    vi.stubEnv('SUPABASE_URL', ''); expect(receiverGet().status).toBe(405);
  });
  it('retorna erro seguro para ambiente ausente sem encerrar servidor', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ''); const res = await list(request('/api/admin/webhooks'));
    expect(res.status).toBe(500); expect(await res.text()).not.toMatch(/stack|private-server-key/);
  });
});
