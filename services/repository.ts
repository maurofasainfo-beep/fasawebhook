import 'server-only';
import { HttpError } from '@/lib/http';
import { supabaseServer } from '@/lib/supabase/server';
import type { EventDetail, EventRow, EventSummary, Page, WebhookRow, WebhookSummary } from '@/types/webhook';

export type EventInput = Omit<EventRow, 'id' | 'received_at' | 'processed_at' | 'created_at'>;
export interface Repository {
  find(publicId: string, includeArchived?: boolean): Promise<WebhookRow | null>;
  list(page: number): Promise<Page<WebhookRow>>;
  options(page: number): Promise<Page<WebhookSummary>>;
  create(data: Pick<WebhookRow, 'name' | 'auth_token_hash' | 'auth_token_encrypted'>): Promise<WebhookRow>;
  update(publicId: string, data: Partial<Pick<WebhookRow, 'name' | 'active' | 'deleted_at' | 'auth_token_hash' | 'auth_token_encrypted'>>): Promise<WebhookRow | null>;
  record(event: EventInput, expectedHash?: string): Promise<{ id: string; http_status: number; error_message: string | null }>;
  events(page: number, webhookId: string): Promise<Page<EventSummary>>;
  event(id: string): Promise<EventDetail | null>;
  deleteEvent(id: string): Promise<boolean>;
  clearEvents(publicId: string): Promise<number>;
}
function check(error: unknown) { if (error) throw new Error('DATABASE_ERROR'); }
const PAGE_SIZE = 20;
function paged<T>(data: T[], page: number): Page<T> {
  return { items: data.slice(0, PAGE_SIZE), page, pageSize: PAGE_SIZE, hasMore: data.length > PAGE_SIZE };
}
export function repository(): Repository {
  const db = supabaseServer();
  return {
    async find(publicId, includeArchived = false) {
      let query = db.from('webhooks').select('*').eq('public_id', publicId);
      if (!includeArchived) query = query.is('deleted_at', null);
      const { data, error } = await query.maybeSingle(); check(error);
      return data as WebhookRow | null;
    },
    async list(page) {
      const start = (page - 1) * PAGE_SIZE;
      const { data, error } = await db.from('webhooks').select('*').is('deleted_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + PAGE_SIZE); check(error);
      return paged(data as WebhookRow[], page);
    },
    async options(page) {
      const start = (page - 1) * PAGE_SIZE;
      const { data, error } = await db.from('webhooks').select('id,public_id,name,active,last_received_at,created_at,deleted_at').order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + PAGE_SIZE); check(error);
      return paged(data as WebhookSummary[], page);
    },
    async create(values) {
      const { data, error } = await db.from('webhooks').insert(values).select('*').single(); check(error); return data as WebhookRow;
    },
    async update(publicId, values) {
      const { data, error } = await db.from('webhooks').update(values).eq('public_id', publicId).is('deleted_at', null).select('*').maybeSingle(); check(error); return data as WebhookRow | null;
    },
    async record(event, expectedHash) {
      const { data, error } = await db.rpc('record_webhook_event', { p_event: event, p_expected_hash: expectedHash ?? null }); check(error);
      return data as { id: string; http_status: number; error_message: string | null };
    },
    async events(page, webhookPublicId) {
      const hook = await this.find(webhookPublicId, true);
      if (!hook) throw new HttpError(404, 'Webhook não encontrado.');
      const start = (page - 1) * PAGE_SIZE;
      const { data, error } = await db.from('webhook_events')
        .select('id,webhook_id,received_at,status,http_status,source_ip,external_event_id,webhook:webhooks(name)')
        .eq('webhook_id', hook.id)
        .order('received_at', { ascending: false }).order('id', { ascending: false }).range(start, start + PAGE_SIZE); check(error);
      return paged(data as unknown as EventSummary[], page);
    },
    async event(id) {
      const { data, error } = await db.from('webhook_events').select('*,webhook:webhooks(name)').eq('id', id).maybeSingle(); check(error);
      return data as EventDetail | null;
    },
    async deleteEvent(id) {
      const { data, error } = await db.from('webhook_events').delete().eq('id', id).select('id').maybeSingle(); check(error); return Boolean(data);
    },
    async clearEvents(publicId) {
      const { data, error } = await db.rpc('delete_webhook_events', { p_public_id: publicId }); check(error);
      return (data as { deletedCount: number }).deletedCount;
    },
  };
}
