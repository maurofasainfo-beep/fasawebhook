// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '@/components/dashboard';
import type { Webhook } from '@/types/webhook';

const hook: Webhook = { id: 'hook', public_id: 'public-uuid', name: 'Integração Principal', module: 'delivery_webhook', active: true, auth_enabled: true, created_at: '2026-09-25T12:00:00Z', updated_at: '2026-09-25T12:00:00Z', last_received_at: null, deleted_at: null, url: 'https://example.com/api/webhooks/receive/public-uuid', token: 'test-webhook-token' };
const item = { id: 'event-1', webhook_id: hook.id, webhook: { name: hook.name }, received_at: hook.created_at, status: 'received', http_status: 202, source_ip: null, external_event_id: null };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => Response.json(handler(url, init))));
}
describe('painel operacional', () => {
  it('abre diretamente, mostra vazio, cria webhook e copia URL e token', async () => {
    let created = false;
    mockFetch((_url, init) => {
      if (init?.method === 'POST') { created = true; return hook; }
      return { items: created ? [hook] : [], page: 1, pageSize: 20, hasMore: false };
    });
    const user = userEvent.setup(); render(<Dashboard />);
    expect(await screen.findByText('Nenhum webhook configurado.')).toBeInTheDocument();
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar webhook' }));
    expect(await screen.findByLabelText(/URL do webhook/)).toHaveValue(hook.url);
    await user.click(screen.getByRole('button', { name: 'Copiar URL' }));
    expect(await screen.findByText('URL copiada')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(hook.url);
    await user.click(screen.getByRole('button', { name: 'Copiar token' }));
    expect(await screen.findByText('Token copiado')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(hook.token);
  });
  it('salva nome e desativação', async () => {
    mockFetch((_url, init) => init?.method === 'PATCH' ? { ...hook, ...JSON.parse(String(init.body)) } : { items: [hook], page: 1, pageSize: 20, hasMore: false });
    const user = userEvent.setup(); render(<Dashboard />);
    const name = await screen.findByLabelText('Nome da integração'); await user.clear(name); await user.type(name, 'Sistema externo');
    await user.selectOptions(screen.getByLabelText('Ativo'), 'false'); await user.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    expect(await screen.findByText('Configuração salva')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.body === JSON.stringify({ name: 'Sistema externo', active: false }))).toBe(true);
  });
  it('exige confirmação antes de regenerar token e permite cancelar', async () => {
    mockFetch((_url, init) => init?.method === 'POST' ? { ...hook, token: 'new-token', updated_at: '2026-09-25T13:00:00Z' } : { items: [hook], page: 1, pageSize: 20, hasMore: false });
    const user = userEvent.setup(); render(<Dashboard />);
    await user.click(await screen.findByRole('button', { name: 'Gerar novo token' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('invalidará o token atual');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Gerar novo token' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar novo token' }));
    await waitFor(() => expect(screen.getByLabelText('Token de autenticação')).toHaveValue('new-token'));
  });
  it('lista logs, abre detalhe, copia JSON e pagina', async () => {
    mockFetch(url => {
      if (url.endsWith('/event-1')) return { ...item, http_method: 'POST', content_type: 'application/json', payload: { event: 'order.created' }, headers: { 'content-type': 'application/json' }, error_message: null };
      if (url.includes('/events')) return { items: [item], page: url.includes('page=2') ? 2 : 1, pageSize: 20, hasMore: !url.includes('page=2') };
      if (url.includes('/options')) return { items: [hook], page: 1, pageSize: 20, hasMore: false };
      return { items: [], page: 1, pageSize: 20, hasMore: false };
    });
    const user = userEvent.setup(); render(<Dashboard />);
    await user.click(screen.getByRole('tab', { name: 'Logs' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir evento event-1' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('order.created');
    await user.click(screen.getByRole('button', { name: 'Copiar JSON' }));
    expect(await screen.findByText('JSON copiado')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(JSON.stringify({ event: 'order.created' }, null, 2));
    await user.click(screen.getByRole('button', { name: /^Fechar$/ }));
    await user.click(screen.getByRole('button', { name: /Próxima/ }));
    expect(await screen.findByText('Página 2 · até 20 registros')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Próxima/ })).toBeDisabled();
  });
  it('mostra falha real da API e permite tentar novamente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Supabase indisponível' }, { status: 500 })));
    render(<Dashboard />); expect(await screen.findByRole('alert')).toHaveTextContent('Supabase indisponível');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
  it('mostra estado vazio dos logs', async () => {
    mockFetch(url => url.includes('/options') ? { items: [hook], page: 1, pageSize: 20, hasMore: false } : { items: [], page: 1, pageSize: 20, hasMore: false });
    const user = userEvent.setup(); render(<Dashboard />); await user.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(await screen.findByText(`Nenhum log para ${hook.name}.`)).toBeInTheDocument();
  });
});
