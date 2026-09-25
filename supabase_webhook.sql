-- Webhook Delivery | Instalação completa no Supabase SQL Editor.
-- Execute o arquivo inteiro UMA VEZ em um projeto limpo.
-- Se as tabelas já existirem, o script falha e reverte a transação: não apaga dados
-- nem mascara um schema incompatível. Atualizações futuras exigem revisão explícita.
BEGIN;

-- gen_random_uuid() é nativo no PostgreSQL 13+. Nenhuma extensão é necessária.
CREATE TABLE public.webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  module text NOT NULL DEFAULT 'delivery_webhook' CHECK (module = 'delivery_webhook'),
  active boolean NOT NULL DEFAULT true,
  auth_enabled boolean NOT NULL DEFAULT true CHECK (auth_enabled = true),
  auth_token_encrypted text NOT NULL CHECK (auth_token_encrypted ~ '^v1\.[a-f0-9]{24}\.[a-f0-9]{32}\.[a-f0-9]{86}$'),
  auth_token_hash text NOT NULL CHECK (auth_token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz
);

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid REFERENCES public.webhooks(id) ON DELETE RESTRICT,
  requested_public_id uuid,
  http_method text NOT NULL CHECK (char_length(http_method) BETWEEN 1 AND 16),
  content_type text CHECK (char_length(content_type) <= 256),
  payload jsonb,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(headers) = 'object'),
  source_ip inet,
  status text NOT NULL CHECK (status IN ('received', 'rejected')),
  http_status smallint NOT NULL,
  error_message text CHECK (char_length(error_message) <= 500),
  external_event_id text CHECK (char_length(external_event_id) <= 256),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_result CHECK (
    (status = 'received' AND http_status = 202 AND webhook_id IS NOT NULL AND error_message IS NULL)
    OR (status = 'rejected' AND http_status BETWEEN 400 AND 599 AND error_message IS NOT NULL)
  )
);

-- UNIQUE(public_id) já cria o índice de lookup. Boolean active não é filtrado
-- nas consultas atuais: um índice isolado teria pouca utilidade.
CREATE INDEX webhooks_created_idx ON public.webhooks (created_at DESC, id DESC);
CREATE INDEX webhook_events_received_idx ON public.webhook_events (received_at DESC, id DESC);
CREATE INDEX webhook_events_webhook_received_idx ON public.webhook_events (webhook_id, received_at DESC, id DESC);
CREATE INDEX webhook_events_status_received_idx ON public.webhook_events (status, received_at DESC, id DESC);

CREATE FUNCTION public.webhook_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER webhooks_updated_at BEFORE UPDATE ON public.webhooks
FOR EACH ROW EXECUTE FUNCTION public.webhook_touch_updated_at();

-- Uma única chamada RPC: evento + last_received_at são atômicos.
-- O lock e a revalidação impedem aceitar um token revogado ou webhook desativado
-- entre a leitura inicial do backend e o commit do evento.
CREATE FUNCTION public.record_webhook_event(p_event jsonb, p_expected_hash text DEFAULT NULL)
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
    SELECT * INTO v_hook FROM public.webhooks WHERE id = v_webhook_id FOR UPDATE;
    IF NOT FOUND THEN
      v_webhook_id := NULL;
      v_http := 404; v_error := 'Webhook não encontrado.';
    ELSIF NOT v_hook.active THEN
      v_http := 403; v_error := 'Webhook desativado.';
    ELSIF p_expected_hash IS NULL OR v_hook.auth_token_hash <> p_expected_hash THEN
      v_http := 401; v_error := 'Token ausente ou inválido.';
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

-- Sem políticas públicas. Browser nunca acessa estas tabelas diretamente.
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhooks, public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.webhooks TO service_role;
GRANT SELECT, INSERT ON TABLE public.webhook_events TO service_role;
REVOKE ALL ON FUNCTION public.webhook_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_webhook_event(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(jsonb, text) TO service_role;

COMMENT ON TABLE public.webhooks IS 'Configuração operacional; tokens AES-256-GCM e hash SHA-256. A chave de criptografia existe somente no servidor.';
COMMENT ON TABLE public.webhook_events IS 'Recebimentos e rejeições. Não cria pedidos. Payload apenas para JSON autenticado e aceito.';
COMMENT ON COLUMN public.webhooks.last_received_at IS 'Último evento aceito e persistido com sucesso.';
COMMENT ON COLUMN public.webhook_events.external_event_id IS 'ID opcional do fornecedor, sem deduplicação automática nesta versão.';
COMMENT ON COLUMN public.webhook_events.processed_at IS 'Reservado para processador futuro; receiver mantém NULL.';
COMMENT ON FUNCTION public.record_webhook_event(jsonb, text) IS 'Backend somente. Transação de recebimento com revalidação de ativo e token.';
NOTIFY pgrst, 'reload schema';
COMMIT;
