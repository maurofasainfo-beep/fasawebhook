import 'server-only';
import { HttpError, errorResponse, isUuid, json, readJson, sanitizeHeaders, sourceIp, technicalLog } from '@/lib/http';
import { validToken } from '@/lib/tokens';
import type { Json, WebhookRow } from '@/types/webhook';
import type { EventInput, Repository } from './repository';

function externalId(payload: Json, request: Request) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const key of ['event_id', 'request_id']) {
      const value = payload[key];
      if (typeof value === 'string' || typeof value === 'number') return String(value).slice(0, 256);
    }
  }
  return request.headers.get('x-request-id')?.slice(0, 256) || null;
}
export async function receive(request: Request, publicId: string, db: Repository, options: { maxPayload: number; trustProxy: boolean }) {
  if (request.method !== 'POST') return json({ success: false, error: 'Utilize POST.' }, 405, { Allow: 'POST' });
  if (!isUuid(publicId)) {
    technicalLog('webhook_invalid_identifier');
    return json({ success: false, error: 'Webhook não encontrado.' }, 404);
  }
  let hook: WebhookRow | null = null;
  const event: EventInput = {
    webhook_id: null, requested_public_id: publicId, http_method: request.method,
    content_type: request.headers.get('content-type')?.slice(0, 256) || null,
    payload: null, headers: sanitizeHeaders(request.headers), source_ip: sourceIp(request.headers, options.trustProxy),
    status: 'received', http_status: 202, error_message: null, external_event_id: null,
  };
  try {
    hook = await db.find(publicId);
    if (!hook) throw new HttpError(404, 'Webhook não encontrado.');
    event.webhook_id = hook.id;
    technicalLog('request_received', hook.id);
    if (!hook.active) throw new HttpError(403, 'Webhook desativado.');
    const authorization = request.headers.get('authorization');
    const token = authorization ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] : request.headers.get('x-webhook-token');
    if (!token || !validToken(token, hook.auth_token_hash)) throw new HttpError(401, 'Token ausente ou inválido.');
    event.payload = await readJson(request, options.maxPayload);
    event.external_event_id = externalId(event.payload, request);
    const saved = await db.record(event, hook.auth_token_hash);
    if (saved.http_status !== 202) {
      technicalLog('request_rejected_during_commit', hook.id);
      return json({ success: false, error: saved.error_message }, saved.http_status);
    }
    technicalLog('event_saved', hook.id);
    return json({ success: true, received: true, eventId: saved.id }, 202);
  } catch (error) {
    if (error instanceof HttpError) {
      technicalLog(`request_rejected_${error.status}`, hook?.id);
      // Invalid/unauthenticated bodies are never stored. Only sanitized metadata.
      try { await db.record({ ...event, payload: null, external_event_id: null, status: 'rejected', http_status: error.status, error_message: error.message }); }
      catch { return errorResponse(new Error('DATABASE_ERROR')); }
    }
    return errorResponse(error);
  }
}
