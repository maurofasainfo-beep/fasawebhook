'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { EventDetail, EventSummary, Page, Webhook } from '@/types/webhook';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Request': '1', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data as T;
}
const date = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : 'Nenhum recebimento';
const message = (error: unknown) => error instanceof Error ? error.message : 'Falha na comunicação. Tente novamente.';

function Icon({ kind = 'link' }: { kind?: 'link' | 'copy' | 'arrow' | 'refresh' | 'plus' | 'settings' | 'logs' }) {
  const paths = { link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2', copy: 'M9 9h11v12H9zM15 5V2H3v13h3', arrow: 'M5 12h14M13 6l6 6-6 6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2', plus: 'M12 5v14M5 12h14', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', logs: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4' };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={close} aria-labelledby="dialog-title"><div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Fechar">×</button></div>{children}</dialog>;
}
function Pagination({ page, hasMore, busy, onPage }: { page: number; hasMore: boolean; busy: boolean; onPage: (value: number) => void }) {
  return <div className="pagination"><span>Página {page} · até 20 registros</span><div><button disabled={busy || page === 1} onClick={() => onPage(page - 1)}>Anterior</button><button disabled={busy || !hasMore} onClick={() => onPage(page + 1)}>Próxima <span aria-hidden="true">→</span></button></div></div>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon /></div><h2>{title}</h2>{children}</div>;
}

export default function Dashboard() {
  const [tab, setTab] = useState<'config' | 'logs'>('config');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); } }, [toast]);
  function notify(text: string, error = false) { setToast({ text, error }); }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); notify(`${label} ${label === 'URL' ? 'copiada' : 'copiado'}`); }
    catch { notify('Não foi possível copiar. Selecione o conteúdo e copie manualmente. Use HTTPS ou localhost.', true); }
  }
  return <>
    <header className="topbar"><Link className="brand" href="/" aria-label="Webhook Delivery, início"><span className="brand-mark"><Icon /></span><span>webhook<span className="brand-light"> / delivery</span></span></Link><span className="workspace-label"><span className="small-dot" /> Painel operacional</span></header>
    <main>
      <div className="intro"><div><p className="eyebrow">CONEXÕES QUE CHEGAM ATÉ VOCÊ</p><h1>Suas integrações,<br className="mobile-break" /> em um só lugar.</h1><p className="subtitle">Crie uma conexão. Copie a URL. Acompanhe cada evento.</p></div><span className="intro-symbol" aria-hidden="true"><Icon /></span></div>
      <div className="tabs" role="tablist" aria-label="Painel de webhooks"><button id="config-tab" role="tab" aria-selected={tab === 'config'} aria-controls="panel" onClick={() => setTab('config')}><Icon kind="settings" /> Configuração</button><button id="logs-tab" role="tab" aria-selected={tab === 'logs'} aria-controls="panel" onClick={() => setTab('logs')}><Icon kind="logs" /> Logs</button></div>
      <section id="panel" role="tabpanel" aria-labelledby={`${tab}-tab`}>
        {tab === 'config' ? <Configuration notify={notify} copy={copy} /> : <Logs notify={notify} copy={copy} />}
      </section>
      <footer><span><span className="small-dot" /> Webhook Delivery</span><span>Receber. Registrar. Acompanhar.</span></footer>
    </main>
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.error ? '!' : '✓'}</span>{toast.text}<button aria-label="Fechar aviso" onClick={() => setToast(null)}>×</button></div>}
  </>;
}
type PanelProps = { notify: (text: string, error?: boolean) => void; copy: (text: string, label: string) => Promise<void> };

function Configuration({ notify, copy }: PanelProps) {
  const [data, setData] = useState<Page<Webhook>>({ items: [], page: 1, pageSize: 20, hasMore: false });
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    let ignore = false;
    api<Page<Webhook>>(`/api/admin/webhooks?page=${page}`).then(result => { if (!ignore) { setData(result); setError(''); } }).catch(e => { if (!ignore) setError(message(e)); }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [page, reload]);
  function go(value: number) { setLoading(true); setPage(value); setSelected(''); }
  async function create() {
    setCreating(true);
    try {
      const hook = await api<Webhook>('/api/admin/webhooks', { method: 'POST', body: JSON.stringify({ name: 'Integração Principal' }) });
      setSelected(hook.public_id); setPage(1); setLoading(true); setReload(v => v + 1); notify('Webhook criado. Sua URL está pronta!');
    } catch (e) { notify(message(e), true); } finally { setCreating(false); }
  }
  const hook = data.items.find(item => item.public_id === selected) || data.items[0];
  return <>
    <div className="section-heading"><div><h2>Configuração de webhooks</h2><p>Gerencie as conexões com seus sistemas externos.</p></div><div className="actions"><button className="icon-button" aria-label="Atualizar webhooks" disabled={loading || creating} onClick={() => { setLoading(true); setReload(v => v + 1); }}><Icon kind="refresh" /></button>{data.items.length > 0 && <button className="primary" disabled={creating || loading} onClick={create}><Icon kind="plus" />{creating ? 'Criando…' : 'Criar webhook'}</button>}</div></div>
    {loading ? <div className="loading" role="status"><span className="spinner" />Carregando configurações…</div> : error ? <div className="error-box" role="alert"><h3>Não foi possível carregar as configurações</h3><p>{error}</p><p>Na primeira instalação, execute o arquivo SQL no Supabase e preencha o arquivo .env.local seguindo o README.</p><button onClick={() => { setLoading(true); setReload(v => v + 1); }}>Tentar novamente</button></div> : !hook ? <div className="card"><Empty title="Nenhum webhook configurado."><p>Crie um webhook para começar a receber eventos externos.</p><button className="primary" onClick={create} disabled={creating}><Icon kind="plus" />{creating ? 'Criando…' : 'Criar webhook'}</button></Empty></div> : <div className="configuration-grid">
      <aside className="connection-list" aria-label="Webhooks configurados"><p className="eyebrow">SUAS CONEXÕES</p>{data.items.map(item => <button key={item.id} aria-pressed={item.id === hook.id} onClick={() => setSelected(item.public_id)}><span className={`connection-dot ${item.active ? 'on' : ''}`} /><span><strong>{item.name}</strong><small>{item.active ? 'Ativo' : 'Desativado'}</small></span><span aria-hidden="true">›</span></button>)}<div className="aside-note"><Icon /><p>Uma URL permanente para cada integração.</p></div></aside>
      <WebhookForm key={`${hook.id}-${hook.updated_at}`} hook={hook} notify={notify} copy={copy} onSaved={updated => setData(current => ({ ...current, items: current.items.map(item => item.id === updated.id ? updated : item) }))} />
    </div>}
    {!error && (data.hasMore || page > 1) && <Pagination page={page} hasMore={data.hasMore} busy={loading} onPage={go} />}
    <div className="how-it-works"><span className="eyebrow">COMECE EM 3 PASSOS</span><span><b>01</b> Crie seu webhook</span><span><b>02</b> Copie a URL e o token</span><span><b>03</b> Conecte o sistema externo</span></div>
  </>;
}

function WebhookForm({ hook, onSaved, notify, copy }: PanelProps & { hook: Webhook; onSaved: (hook: Webhook) => void }) {
  const [name, setName] = useState(hook.name);
  const [active, setActive] = useState(hook.active);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function save() {
    setBusy(true);
    try { onSaved(await api<Webhook>(`/api/admin/webhooks/${hook.public_id}`, { method: 'PATCH', body: JSON.stringify({ name, active }) })); notify('Configuração salva'); }
    catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }
  async function rotate() {
    setBusy(true);
    try { onSaved(await api<Webhook>(`/api/admin/webhooks/${hook.public_id}/token`, { method: 'POST', body: JSON.stringify({ confirm: true }) })); notify('Novo token gerado. Atualize a integração externa.'); setConfirm(false); }
    catch (e) { notify(message(e), true); } finally { setBusy(false); }
  }
  return <><form className="card webhook-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="card-heading"><div className="module-icon"><Icon /></div><div><span className="eyebrow">MÓDULO</span><h3>Integração Pedidos - Webhook</h3></div><span className={`badge ${hook.active ? 'success' : 'neutral'}`}>{hook.active ? 'Ativo' : 'Desativado'}</span></div>
    <div className="form-body"><div className="form-row"><label className="grow" htmlFor="webhook-name">Nome da integração<input id="webhook-name" value={name} maxLength={120} required disabled={busy} onChange={e => setName(e.target.value)} /></label><label className="active-field" htmlFor="webhook-active">Ativo<select id="webhook-active" value={String(active)} disabled={busy} onChange={e => setActive(e.target.value === 'true')}><option value="true">Sim</option><option value="false">Não</option></select></label></div>
    <div className="field"><label htmlFor="webhook-url">URL do webhook <span className="field-tag">POST</span></label><div className="input-action"><input id="webhook-url" className="mono" value={hook.url} readOnly /><button type="button" onClick={() => copy(hook.url, 'URL')}><Icon kind="copy" />Copiar URL</button></div><p className="help">Cole este endereço no sistema que enviará os eventos.</p></div>
    <div className="field"><label htmlFor="webhook-token">Token de autenticação</label><div className="input-action"><input id="webhook-token" className="mono" type={showToken ? 'text' : 'password'} value={hook.token} readOnly autoComplete="off" /><button type="button" onClick={() => copy(hook.token, 'Token')}><Icon kind="copy" />Copiar token</button></div><div className="token-actions"><button type="button" className="text-button" onClick={() => setShowToken(v => !v)}>{showToken ? 'Ocultar token' : 'Mostrar token'}</button><button type="button" className="text-button" disabled={busy} onClick={() => setConfirm(true)}><Icon kind="refresh" />Gerar novo token</button></div></div>
    <div className="received"><span className="received-icon">↙</span><div><span>Último recebimento</span><strong>{date(hook.last_received_at)}</strong></div><span className="received-help">Eventos aceitos e salvos</span></div></div>
    <div className="card-footer"><span>Alterações de nome e status precisam ser salvas.</span><button className="primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar configuração'}<Icon kind="arrow" /></button></div>
  </form>{confirm && <Modal title="Gerar novo token?" close={() => { if (!busy) setConfirm(false); }}><p>Gerar um novo token invalidará o token atual. A integração externa deverá ser atualizada.</p><div className="modal-actions"><button disabled={busy} onClick={() => setConfirm(false)}>Cancelar</button><button className="primary" disabled={busy} onClick={rotate}>{busy ? 'Gerando…' : 'Confirmar novo token'}</button></div></Modal>}</>;
}

function Logs({ notify, copy }: PanelProps) {
  const [data, setData] = useState<Page<EventSummary>>({ items: [], page: 1, pageSize: 20, hasMore: false });
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let ignore = false;
    api<Page<EventSummary>>(`/api/admin/events?page=${page}`).then(result => { if (!ignore) { setData(result); setError(''); } }).catch(e => { if (!ignore) setError(message(e)); }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [page, reload]);
  async function open(id: string) {
    setOpening(true);
    try { setDetail(await api<EventDetail>(`/api/admin/events/${id}`)); } catch (e) { notify(message(e), true); } finally { setOpening(false); }
  }
  return <>
    <div className="section-heading"><div><h2>Histórico de eventos</h2><p>Cada recebimento, com os detalhes que você precisa.</p></div><button disabled={loading} onClick={() => { setLoading(true); setReload(v => v + 1); }}><Icon kind="refresh" />Atualizar logs</button></div>
    {opening && <p role="status">Abrindo evento…</p>}
    <div className="card">{loading ? <div className="loading" role="status"><span className="spinner" />Carregando eventos…</div> : error ? <div className="error-box" role="alert"><h3>Não foi possível carregar os logs</h3><p>{error}</p></div> : data.items.length === 0 ? <Empty title={page === 1 ? 'Nenhum evento recebido até o momento.' : 'Nenhum evento nesta página.'}><p>Configure a URL no sistema externo para começar a receber eventos.</p></Empty> : <div className="table-scroll"><table><thead><tr><th>Data / hora</th><th>Webhook / evento</th><th>Status</th><th>HTTP</th><th>Origem</th><th><span className="sr-only">Detalhes</span></th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td className="date-cell">{date(item.received_at)}</td><td><strong>{item.webhook?.name || 'Webhook não encontrado'}</strong><small className="event-id" title={item.external_event_id || item.id}>{item.external_event_id || item.id}</small></td><td><span className={`badge ${item.status === 'received' ? 'success' : 'danger'}`}>{item.status === 'received' ? 'Recebido' : 'Rejeitado'}</span></td><td className="mono">{item.http_status}</td><td className="mono">{item.source_ip || 'Não informada'}</td><td><button className="detail-button" disabled={opening} onClick={() => open(item.id)} aria-label={`Abrir evento ${item.id}`}>Ver JSON <Icon kind="arrow" /></button></td></tr>)}</tbody></table></div>}</div>
    {!error && <Pagination page={page} hasMore={data.hasMore} busy={loading} onPage={value => { setLoading(true); setPage(value); }} />}
    <p className="help logs-help">Os eventos são registrados aqui. A criação de pedidos será uma integração futura.</p>
    {detail && <Modal title="Detalhes do evento" close={() => setDetail(null)}><dl className="detail-grid"><div><dt>Webhook</dt><dd>{detail.webhook?.name || 'Não encontrado'}</dd></div><div><dt>Data / hora</dt><dd>{date(detail.received_at)}</dd></div><div><dt>Status</dt><dd>{detail.status === 'received' ? 'Recebido' : 'Rejeitado'} · HTTP {detail.http_status}</dd></div><div><dt>Método / Content-Type</dt><dd>{detail.http_method} · {detail.content_type || 'Não informado'}</dd></div><div><dt>IP de origem</dt><dd>{detail.source_ip || 'Não informado'}</dd></div><div><dt>ID do evento</dt><dd className="mono">{detail.id}</dd></div></dl>{detail.error_message && <div className="error-box" role="alert">{detail.error_message}</div>}<div className="json-heading"><h3>JSON recebido</h3><button onClick={() => copy(JSON.stringify(detail.payload, null, 2), 'JSON')} disabled={detail.status === 'rejected'}><Icon kind="copy" />Copiar JSON</button></div>{detail.status === 'rejected' ? <p className="help">O corpo de uma requisição rejeitada não é armazenado.</p> : <pre tabIndex={0}>{JSON.stringify(detail.payload, null, 2)}</pre>}<h3>Headers permitidos</h3><pre tabIndex={0}>{JSON.stringify(detail.headers, null, 2)}</pre></Modal>}
  </>;
}
