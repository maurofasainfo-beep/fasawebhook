export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface WebhookRow {
  id: string; public_id: string; name: string; module: string; active: boolean;
  auth_enabled: true; auth_token_encrypted: string; auth_token_hash: string;
  created_at: string; updated_at: string; last_received_at: string | null; deleted_at: string | null;
}
export type Webhook = Omit<WebhookRow, 'auth_token_encrypted' | 'auth_token_hash'> & { url: string; token: string };
export interface EventRow {
  id: string; webhook_id: string | null; requested_public_id: string | null;
  http_method: string; content_type: string | null; payload: Json;
  headers: Record<string, string>; source_ip: string | null;
  status: 'received' | 'rejected'; http_status: number; error_message: string | null;
  external_event_id: string | null; received_at: string; processed_at: string | null; created_at: string;
}
export type EventDetail = EventRow & { webhook: { name: string } | null };
export type EventSummary = Pick<EventDetail, 'id' | 'webhook_id' | 'received_at' | 'status' | 'http_status' | 'source_ip' | 'external_event_id' | 'webhook'>;
export interface Page<T> { items: T[]; page: number; pageSize: number; hasMore: boolean }
export type WebhookSummary = Pick<WebhookRow, 'id' | 'public_id' | 'name' | 'active' | 'last_received_at' | 'created_at' | 'deleted_at'>;
