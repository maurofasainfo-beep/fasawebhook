import 'server-only';
import { isIP } from 'node:net';
import type { Json } from '@/types/webhook';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
// Only fixed diagnostic codes and non-secret identifiers may enter technical logs.
export function technicalLog(code: string, webhookId?: string) {
  console.info(JSON.stringify({ scope: 'webhook', code, ...(webhookId ? { webhookId } : {}) }));
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return json({ success: false, error: error.message }, error.status);
  technicalLog(error instanceof Error && error.message === 'SERVER_CONFIGURATION' ? 'server_configuration_missing' : 'internal_or_database_error');
  return json({ success: false, error: 'Não foi possível concluir. Verifique a configuração do servidor e a conexão com o Supabase.' }, 500);
}
export async function safe(action: () => Promise<Response>) {
  try { return await action(); } catch (error) { return errorResponse(error); }
}
export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  // An allowlist also discards unknown provider-specific secrets.
  for (const name of ['content-type', 'content-length', 'user-agent', 'x-request-id']) {
    const value = headers.get(name);
    if (value) result[name] = value.slice(0, 512);
  }
  return result;
}
export function sourceIp(headers: Headers, trustProxy: boolean) {
  if (!trustProxy) return null;
  const value = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return value && isIP(value) ? value : null;
}
export function requireDashboard(request: Request, appUrl: string) {
  if (request.headers.get('x-dashboard-request') !== '1') throw new HttpError(403, 'Solicitação administrativa não permitida.');
  const origin = request.headers.get('origin');
  if ((origin && origin !== appUrl) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Origem não permitida.');
}
// PostgreSQL JSONB rejects NUL and unpaired surrogates. Bound depth before
// supabase-js serializes the body, and avoid silently converting Infinity to null.
function databaseJson(value: Json): Json {
  const pending: Array<{ value: Json; depth: number }> = [{ value, depth: 0 }];
  const validString = (text: string) => !text.includes('\0') && text.isWellFormed();
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 128 || (typeof item.value === 'number' && !Number.isFinite(item.value)) ||
        (typeof item.value === 'string' && !validString(item.value))) {
      throw new HttpError(400, 'JSON contém valores incompatíveis ou profundidade acima de 128 níveis.');
    }
    if (item.value && typeof item.value === 'object') {
      for (const [key, child] of Object.entries(item.value)) {
        if (!validString(key)) throw new HttpError(400, 'JSON contém uma chave incompatível.');
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return value;
}
export async function readJson(request: Request, limit: number): Promise<Json> {
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new HttpError(415, 'Envie JSON sem compressão.');
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(contentType || '')) throw new HttpError(415, 'Utilize Content-Type: application/json.');
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) throw new HttpError(413, 'Payload excedeu o limite permitido.');
  if (!request.body) throw new HttpError(400, 'JSON inválido ou vazio.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, 'Payload excedeu o limite permitido.');
      }
      chunks.push(value);
    }
    let parsed: Json;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as Json; }
    catch { throw new HttpError(400, 'JSON inválido ou vazio.'); }
    return databaseJson(parsed);
  } finally { reader.releaseLock(); }
}
export function pageNumber(url: string) {
  const raw = new URL(url).searchParams.get('page') || '1';
  if (!/^[1-9]\d{0,5}$/.test(raw)) throw new HttpError(400, 'Página inválida.');
  return Number(raw);
}
