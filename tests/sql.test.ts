import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createToken } from '@/lib/tokens';
import { key } from './fixtures';

// PostgreSQL WASM somente em memória no runner. NÃO é banco da aplicação.
const db = new PGlite();
let id: string, publicId: string, hash: string;
beforeAll(async () => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(readFileSync(new URL('../supabase_webhook.sql', import.meta.url), 'utf8'));
  const tokens = createToken(key); hash = tokens.auth_token_hash;
  const result = await db.query<{ id: string; public_id: string }>('INSERT INTO public.webhooks (name, auth_token_encrypted, auth_token_hash) VALUES ($1, $2, $3) RETURNING id, public_id', ['Teste SQL', tokens.auth_token_encrypted, hash]);
  id = result.rows[0].id; publicId = result.rows[0].public_id;
});
afterAll(async () => { await db.close(); });
function event(overrides = {}) {
  return { webhook_id: id, requested_public_id: publicId, http_method: 'POST', content_type: 'application/json', payload: { event: 'order.created' }, headers: { 'content-type': 'application/json' }, source_ip: null, status: 'received', http_status: 202, error_message: null, external_event_id: 'evt-1', ...overrides };
}
async function record(input = event(), expected: string | null = hash) {
  return db.query<{ result: { id: string; http_status: number } }>('SELECT public.record_webhook_event($1::jsonb, $2) AS result', [JSON.stringify(input), expected]);
}
describe('SQL completo executado em PostgreSQL', () => {
  it('gera UUID e estrutura com JSONB, timestamptz, índices e RLS', async () => {
    expect(publicId).toMatch(/^[a-f0-9-]{36}$/); expect(id).not.toBe(publicId);
    const tables = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('webhooks', 'webhook_events')");
    expect(tables.rows).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
    const types = await db.query<{ data_type: string }>("SELECT data_type FROM information_schema.columns WHERE table_name='webhook_events' AND column_name IN ('payload','received_at') ORDER BY column_name");
    expect(types.rows.map(r => r.data_type)).toEqual(['jsonb', 'timestamp with time zone']);
    const indexes = await db.query("SELECT indexname FROM pg_indexes WHERE tablename='webhook_events'"); expect(indexes.rows.length).toBe(4);
  });
  it('insere evento e atualiza último recebimento atomicamente como service_role', async () => {
    await db.exec('SET ROLE service_role');
    try {
      const result = await record(); expect(result.rows[0].result.http_status).toBe(202);
      const hook = await db.query<{ last_received_at: Date }>('SELECT last_received_at FROM webhooks WHERE id=$1', [id]);
      expect(hook.rows[0].last_received_at).not.toBeNull();
      const stored = await db.query<{ payload: unknown; processed_at: null }>('SELECT payload,processed_at FROM webhook_events WHERE id=$1', [result.rows[0].result.id]);
      expect(stored.rows[0]).toMatchObject({ payload: { event: 'order.created' }, processed_at: null });
    } finally { await db.exec('RESET ROLE'); }
  });
  it('rejeita hash antigo na transação e não salva payload', async () => {
    const result = await record(event(), 'b'.repeat(64)); expect(result.rows[0].result.http_status).toBe(401);
    const saved = await db.query<{ payload: null; status: string }>('SELECT payload,status FROM webhook_events WHERE id=$1', [result.rows[0].result.id]);
    expect(saved.rows[0]).toEqual({ payload: null, status: 'rejected' });
  });
  it('revalida ativo e trigger atualiza updated_at', async () => {
    const before = await db.query<{ updated_at: Date }>('SELECT updated_at FROM webhooks WHERE id=$1', [id]);
    await db.query('UPDATE webhooks SET active=false WHERE id=$1', [id]);
    expect((await record()).rows[0].result.http_status).toBe(403);
    const after = await db.query<{ updated_at: Date }>('SELECT updated_at FROM webhooks WHERE id=$1', [id]);
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.rows[0].updated_at).getTime());
    await db.query('UPDATE webhooks SET active=true WHERE id=$1', [id]);
  });
  it('protege histórico com FK RESTRICT', async () => {
    await expect(db.query('DELETE FROM webhooks WHERE id=$1', [id])).rejects.toThrow(/foreign key/i);
  });
  it('não altera timestamp se insert falha', async () => {
    const before = await db.query('SELECT last_received_at FROM webhooks WHERE id=$1', [id]);
    await expect(record(event({ http_method: 'X'.repeat(30) }))).rejects.toThrow();
    const after = await db.query('SELECT last_received_at FROM webhooks WHERE id=$1', [id]);
    expect(after.rows).toEqual(before.rows);
  });
  it('anon e authenticated não podem ler tokens, gravar eventos ou chamar RPC', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.query('SELECT * FROM webhooks')).rejects.toThrow(/permission denied/i);
        await expect(db.query('SELECT * FROM webhook_events')).rejects.toThrow(/permission denied/i);
        await expect(record()).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('RESET ROLE'); }
    }
  });
  it('rejeita instalação repetida explicitamente e preserva dados', async () => {
    await expect(db.exec(readFileSync(new URL('../supabase_webhook.sql', import.meta.url), 'utf8'))).rejects.toThrow(/already exists/i);
    await db.exec('ROLLBACK');
    expect((await db.query('SELECT id FROM webhooks WHERE id=$1', [id])).rows).toHaveLength(1);
  });
});
