import 'server-only';
import { createToken, decryptToken } from '@/lib/tokens';
import { HttpError } from '@/lib/http';
import type { Json, Webhook, WebhookRow } from '@/types/webhook';
import type { Repository } from './repository';

export function present(row: WebhookRow, appUrl: string, key: string): Webhook {
  const { auth_token_hash: hash, auth_token_encrypted: encrypted, ...publicData } = row;
  void hash;
  return { ...publicData, url: `${appUrl}/api/webhooks/receive/${row.public_id}`, token: decryptToken(encrypted, key) };
}
function values(body: Json) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Configuração inválida.');
  return body;
}
function name(value: Json | undefined) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new HttpError(400, 'Informe um nome de até 120 caracteres.');
  return value.trim();
}
export async function createWebhook(db: Repository, body: Json, key: string) {
  return db.create({ name: name(values(body).name), ...createToken(key) });
}
export async function updateWebhook(db: Repository, publicId: string, body: Json) {
  const input = values(body);
  if (typeof input.active !== 'boolean') throw new HttpError(400, 'Informe se o webhook está ativo.');
  const row = await db.update(publicId, { name: name(input.name), active: input.active });
  if (!row) throw new HttpError(404, 'Webhook não encontrado.');
  return row;
}
export async function rotateToken(db: Repository, publicId: string, body: Json, key: string) {
  if (values(body).confirm !== true) throw new HttpError(400, 'Confirme a substituição do token.');
  const row = await db.update(publicId, createToken(key));
  if (!row) throw new HttpError(404, 'Webhook não encontrado.');
  return row;
}

export async function archiveWebhook(db: Repository, publicId: string, body: Json) {
  if (values(body).confirm !== true) throw new HttpError(400, 'Confirme a exclusão do webhook.');
  const row = await db.update(publicId, { deleted_at: new Date().toISOString() });
  if (!row) throw new HttpError(404, 'Webhook não encontrado.');
  return { archived: true as const, publicId: row.public_id };
}

export async function clearWebhookEvents(db: Repository, publicId: string, body: Json) {
  if (values(body).confirm !== true) throw new HttpError(400, 'Confirme a exclusão dos logs.');
  if (!(await db.find(publicId, true))) throw new HttpError(404, 'Webhook não encontrado.');
  return { deletedCount: await db.clearEvents(publicId) };
}
