# Relatório de entrega — Webhook Delivery

Data: 25/09/2026.

## Escopo e implementação

Projeto novo em `C:\Users\User\Desktop\webhook-delivery`. Todo o código criado nesta entrega está nessa pasta. Nenhum código de outros projetos foi alterado.

Painel operacional em português, sem autenticação de usuário. Criação de várias conexões, UUID/URL automática e permanente, edição de nome/status, tokens recuperáveis e copiáveis, confirmação de troca de token, receiver genérico JSON, persistência e erros, último recebimento, logs paginados e detalhe/cópia de JSON. Nenhum pedido é criado automaticamente.

## Arquitetura

Navegador → Next.js App Router/Route Handlers → `services` → cliente privado `supabase-js` → Supabase/PostgreSQL.

- Next.js 16.3.6, React 19.3.0, TypeScript 6.0.3 e CSS responsivo próprio.
- Node.js server runtime, sem Supabase Auth, login, usuários ou perfis.
- Banco oficial exclusivo: Supabase. Nenhum fallback local.
- `server-only` protege configuração, tokens, serviços e cliente do banco.
- RLS sem políticas públicas; grants apenas para service role.
- Token aleatório de 256 bits; AES-256-GCM para recuperação, SHA-256 para validação e comparação constante no servidor.
- Allowlist de headers e logs técnicos sanitizados; limite real de bytes; respostas sem stack trace.
- RPC transacional com lock e revalidação evita aceitar token revogado/webhook desativado durante uma gravação concorrente.

## Banco

`public.webhooks`: `id`, `public_id`, `name`, `module`, `active`, `auth_enabled`, `auth_token_encrypted`, `auth_token_hash`, `created_at`, `updated_at`, `last_received_at`.

`public.webhook_events`: `id`, `webhook_id`, `requested_public_id`, `http_method`, `content_type`, `payload`, `headers`, `source_ip`, `status`, `http_status`, `error_message`, `external_event_id`, `received_at`, `processed_at`, `created_at`.

IDs UUID, JSONB, timestamptz; FK com `ON DELETE RESTRICT`; índices de identificação, data/paginação, webhook e status. Trigger atualiza `updated_at`. `processed_at` reservado ao processador futuro.

**Arquivo pronto para Supabase SQL Editor:**

`C:\Users\User\Desktop\webhook-delivery\supabase_webhook.sql`

SQL autossuficiente em uma transação; nenhuma substituição manual ou Supabase CLI. Instalação uma vez em um projeto limpo. Tabelas preexistentes fazem o script falhar explicitamente e reverter, preservando os dados.

## Endpoints

| Método | Rota |
| --- | --- |
| GET / POST | `/api/admin/webhooks` |
| PATCH | `/api/admin/webhooks/:publicId` |
| POST | `/api/admin/webhooks/:publicId/token` |
| GET | `/api/admin/events` |
| GET | `/api/admin/events/:id` |
| POST | `/api/webhooks/receive/:publicId` |

Listagens: `?page=1`, até 20 itens por página. Receiver: Authorization Bearer ou X-Webhook-Token. Evento aceito retorna 202 e `eventId`. HTTP 403 identifica webhook inativo.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run lint` | Aprovado, sem erros ou avisos. |
| `npm.cmd run typecheck` | Aprovado. |
| `npm.cmd test` | **63 testes aprovados**, 5 arquivos de teste. |
| `npm.cmd run build` | Aprovado; página e todas as APIs geradas. |
| `npm.cmd run test:http` | 4 verificações aprovadas contra servidor Next de produção temporário. |
| `npm.cmd audit` | Zero vulnerabilidades reportadas. |
| Busca no bundle `.next/static` | Sem variáveis privadas de Supabase/AES nem campos de hash/cifra do token. |

Testes cobrem criação, UUID/URL, ativar/desativar, criptografia e troca de token, validação do receiver, ausência/token inválido, inexistente/inativo, JSON inválido/incompatível, tamanho, Content-Type, indisponibilidade do banco, paginação, sanitização, rotas, cópia de URL/token/JSON, detalhe e estados da interface.

O arquivo SQL inteiro foi executado em PostgreSQL WASM/PGlite temporário em memória, **exclusivamente no runner de testes**, validando estrutura, constraints, permissões/RLS, bloqueio anon/authenticated, FK RESTRICT, transação, updated_at e revalidação de token/ativo. O SDK Supabase real foi testado com transporte HTTP simulado para conferir consultas e RPC.

Smoke HTTP: página 200 sem login; headers de proteção; método inválido 405/Allow; API sem credenciais retorna JSON 500 seguro e o servidor permanece disponível. O processo temporário de teste foi encerrado ao final.

## Limites da validação e dependências externas

- **Não foi utilizado um projeto Supabase remoto real.** A URL/chave e a execução do SQL no projeto escolhido dependem do operador. Persistência fim a fim em Supabase remoto deve ser confirmada após essa configuração.
- O navegador integrado estava indisponível. A interface foi validada com Testing Library/jsdom; não houve inspeção visual em navegador real nem prova em celular físico.
- Domínio/HTTPS e publicação dependem da infraestrutura escolhida. Não foi feito deploy nem implementada proteção de rede.
- Não há rate limit, expiração automática, deduplicação nem processamento de pedidos. Essas decisões estão documentadas; não impedem o receiver genérico.
- Sem banco disponível não é possível salvar um evento/erro no banco: resposta 500 permite ao fornecedor tentar novamente.

## Instalação pelo operador

1. Criar um projeto no Supabase.
2. Abrir **SQL Editor → New query**.
3. Copiar o arquivo `supabase_webhook.sql` inteiro, colar e clicar **Run**.
4. Copiar `.env.example` para `.env.local`.
5. Preencher URL/chave privada do Supabase, URL pública, limite e chave AES. A chave AES é gerada com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
6. Executar `npm.cmd ci` e `npm.cmd run dev` na pasta do projeto.
7. Abrir `http://localhost:3000` e clicar **Criar webhook**.
8. Copiar URL/token e executar o envio de teste do README.
9. Consultar **Logs → Atualizar logs → Ver JSON**.

**NUNCA exponha SUPABASE_SERVICE_ROLE_KEY no frontend.**

Este painel não possui autenticação de usuário. Caso seja publicado na internet, recomenda-se restringir seu acesso no nível de infraestrutura, rede, reverse proxy, VPN, Cloudflare Access ou solução equivalente. Proteja o painel e `/api/admin/*`; mantenha o receiver público para fornecedores.

## Inventário completo dos arquivos de entrega

Todos os caminhos abaixo são relativos a `C:\Users\User\Desktop\webhook-delivery`.

```text
.env.example
.gitignore
README.md
package.json
package-lock.json
tsconfig.json
next-env.d.ts
next.config.ts
eslint.config.mjs
vitest.config.ts
supabase_webhook.sql
app/layout.tsx
app/page.tsx
app/globals.css
app/api/admin/webhooks/route.ts
app/api/admin/webhooks/[publicId]/route.ts
app/api/admin/webhooks/[publicId]/token/route.ts
app/api/admin/events/route.ts
app/api/admin/events/[id]/route.ts
app/api/webhooks/receive/[publicId]/route.ts
components/dashboard.tsx
lib/config.ts
lib/http.ts
lib/tokens.ts
lib/supabase/server.ts
services/repository.ts
services/webhooks.ts
services/receiver.ts
types/webhook.ts
scripts/http-smoke.mjs
tests/server-only.ts
tests/fixtures.ts
tests/services.test.ts
tests/sql.test.ts
tests/repository.test.ts
tests/dashboard.test.tsx
tests/routes.test.ts
docs/SUPABASE_SETUP.md
docs/RELATORIO_ENTREGA.md
```

`node_modules/`, `.next/` e `tsconfig.tsbuildinfo` são artefatos gerados pela instalação/build, ignorados pelo Git. Nenhum `.env.local` com credenciais foi criado. O inventário lista arquivos entregues, incluindo este relatório.
