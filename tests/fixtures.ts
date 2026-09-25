import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { createToken, decryptToken } from '@/lib/tokens';
import type { WebhookRow } from '@/types/webhook';
import type { Repository } from '@/services/repository';
export const key = 'a'.repeat(64);
export function fixture() {
  let row: WebhookRow = {
    id: randomUUID(), public_id: randomUUID(), name: 'Integração Principal', module: 'delivery_webhook',
    active: true, auth_enabled: true, ...createToken(key),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_received_at: null,
  };
  const token = decryptToken(row.auth_token_encrypted, key);
  const db: Repository = {
    find: vi.fn(async () => row),
    list: vi.fn(async page => ({ items: [row], page, pageSize: 20, hasMore: false })),
    create: vi.fn(async values => ({ ...row, ...values, id: randomUUID(), public_id: randomUUID() })),
    update: vi.fn(async (_id, values) => { row = { ...row, ...values }; return row; }),
    record: vi.fn(async event => ({ id: randomUUID(), http_status: event.http_status, error_message: event.error_message })),
    events: vi.fn(async page => ({ items: [], page, pageSize: 20, hasMore: false })),
    event: vi.fn(async () => null),
  };
  return { row, token, db };
}
