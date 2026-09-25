import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '@/services/repository';
import { fixture, key } from './fixtures';

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-key');
  vi.stubEnv('WEBHOOK_TOKEN_ENCRYPTION_KEY', key);
  vi.stubEnv('APP_PUBLIC_URL', 'http://localhost:3000');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('adaptador Supabase com SDK real e transporte HTTP simulado', () => {
  it('consulta logs com ordenação, limite e sem payloads completos', async () => {
    const fetchMock = vi.fn(async () => Response.json(Array.from({ length: 21 }, (_, i) => ({ id: String(i) }))));
    vi.stubGlobal('fetch', fetchMock);
    const page = await repository().events(2);
    expect(page.items).toHaveLength(20); expect(page.hasMore).toBe(true);
    const call = vi.mocked(fetch).mock.calls[0];
    const url = new URL(String(call[0]));
    expect(url.pathname).toBe('/rest/v1/webhook_events');
    expect(url.searchParams.get('offset')).toBe('20'); expect(url.searchParams.get('limit')).toBe('21');
    expect(url.searchParams.get('order')).toBe('received_at.desc,id.desc');
    expect(url.searchParams.get('select')).not.toMatch(/payload|headers|token/);
    expect(new Headers(call[1]?.headers).get('apikey')).toBe('server-only-test-key');
  });
  it('grava por RPC e envia hash para revalidação atômica', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'event-id', http_status: 202, error_message: null }));
    vi.stubGlobal('fetch', fetchMock);
    const event = { webhook_id: fixture().row.id, requested_public_id: fixture().row.public_id, http_method: 'POST', content_type: 'application/json', payload: { event: 'test' }, headers: {}, source_ip: null, status: 'received' as const, http_status: 202, error_message: null, external_event_id: null };
    expect((await repository().record(event, 'test-hash')).id).toBe('event-id');
    const call = vi.mocked(fetch).mock.calls[0];
    expect(String(call[0])).toContain('/rest/v1/rpc/record_webhook_event');
    expect(JSON.parse(String(call[1]?.body))).toEqual({ p_event: event, p_expected_hash: 'test-hash' });
  });
  it('busca detalhe por ID sem carregar histórico', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'event-id', payload: { value: 1 } })); vi.stubGlobal('fetch', fetchMock);
    expect(await repository().event('event-id')).toMatchObject({ payload: { value: 1 } });
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('id')).toBe('eq.event-id');
  });
  it('converte erro REST sem propagar resposta sensível', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'private-db-data' }, { status: 503 })));
    await expect(repository().events(1)).rejects.toThrow('DATABASE_ERROR');
  });
});
