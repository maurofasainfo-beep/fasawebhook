-- Atualização segura para bancos nos quais o SQL inicial já foi executado.
-- Execute o arquivo inteiro no Supabase SQL Editor. É idempotente.
BEGIN;

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Keep the receiver atomic with archival: a request racing with deletion is rejected.
CREATE OR REPLACE FUNCTION public.record_webhook_event(p_event jsonb, p_expected_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_hook public.webhooks%ROWTYPE;
  v_event public.webhook_events%ROWTYPE;
  v_webhook_id uuid := (p_event->>'webhook_id')::uuid;
  v_status text := p_event->>'status';
  v_http smallint := (p_event->>'http_status')::smallint;
  v_error text := p_event->>'error_message';
BEGIN
  IF v_status = 'received' THEN
    SELECT * INTO v_hook FROM public.webhooks
    WHERE id = v_webhook_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      v_webhook_id := NULL;
      v_http := 404; v_error := 'Webhook not found.';
    ELSIF NOT v_hook.active THEN
      v_http := 403; v_error := 'Webhook disabled.';
    ELSIF p_expected_hash IS NULL OR v_hook.auth_token_hash <> p_expected_hash THEN
      v_http := 401; v_error := 'Invalid or missing token.';
    END IF;
    IF v_http <> 202 THEN v_status := 'rejected'; END IF;
  END IF;

  INSERT INTO public.webhook_events (
    webhook_id, requested_public_id, http_method, content_type, payload, headers,
    source_ip, status, http_status, error_message, external_event_id
  ) VALUES (
    v_webhook_id, (p_event->>'requested_public_id')::uuid, p_event->>'http_method',
    p_event->>'content_type', CASE WHEN v_status = 'received' THEN p_event->'payload' ELSE NULL END,
    COALESCE(p_event->'headers', '{}'::jsonb), (p_event->>'source_ip')::inet,
    v_status, v_http, v_error,
    CASE WHEN v_status = 'received' THEN p_event->>'external_event_id' ELSE NULL END
  ) RETURNING * INTO v_event;

  IF v_status = 'received' THEN
    UPDATE public.webhooks SET last_received_at = GREATEST(last_received_at, v_event.received_at)
    WHERE id = v_webhook_id;
  END IF;
  RETURN jsonb_build_object('id', v_event.id, 'http_status', v_event.http_status, 'error_message', v_event.error_message);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_webhook_events(p_public_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_deleted_count bigint;
BEGIN
  PERFORM 1 FROM public.webhooks WHERE public_id = p_public_id FOR UPDATE;
  DELETE FROM public.webhook_events
  WHERE webhook_id = (SELECT id FROM public.webhooks WHERE public_id = p_public_id);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('deletedCount', v_deleted_count);
END;
$$;

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhooks, public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.webhooks TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.webhook_events TO service_role;
REVOKE ALL ON FUNCTION public.delete_webhook_events(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_webhook_events(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_webhook_event(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(jsonb, text) TO service_role;
COMMENT ON COLUMN public.webhooks.deleted_at IS 'Arquivamento lógico: desativa recebimento e preserva os eventos históricos.';
COMMENT ON FUNCTION public.delete_webhook_events(uuid) IS 'Backend somente. Exclui logs de um webhook após confirmação explícita no painel.';
COMMENT ON FUNCTION public.record_webhook_event(jsonb, text) IS 'Backend somente. Receiver transacional revalida status, token e arquivamento.';

NOTIFY pgrst, 'reload schema';
COMMIT;
