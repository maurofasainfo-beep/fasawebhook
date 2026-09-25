# Webhook Delivery

Painel simples, em português, para criar conexões, receber JSON de sistemas externos e consultar eventos. Abre diretamente em **Configuração**, sem login, cadastro, usuários ou Supabase Auth. Não cria pedidos de delivery.

## Requisitos e arquitetura

- Node.js 22 ou superior (recomendado: Node.js 24 LTS) e npm.
- Um projeto Supabase com Data API disponível para o schema `public`.
- Next.js 16, React 19, TypeScript, App Router e CSS responsivo próprio.
- Navegador → API Next.js → Supabase/PostgreSQL. `supabase-js` existe apenas no servidor, protegido por `server-only`.
- Nenhum banco local, Redis, Docker ou Supabase CLI é necessário para executar a aplicação.

## Instalação no Windows

1. Crie um projeto no [Supabase](https://supabase.com/dashboard).
2. Abra **SQL Editor → New query**.
3. Abra `supabase_webhook.sql` na raiz deste projeto. Copie o arquivo inteiro, cole no editor e clique **Run**. Execute uma única vez em um projeto limpo; não é preciso editar o SQL.
4. No PowerShell:

   ```powershell
   cd C:\Users\User\Desktop\webhook-delivery
   npm.cmd ci
   Copy-Item .env.example .env.local
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

5. Preencha `.env.local` com os valores abaixo, incluindo a chave de criptografia produzida pelo comando. Não envie chaves em mensagens nem as inclua no Git.
6. Execute `npm.cmd run dev` e abra **http://localhost:3000**.
7. Clique **Criar webhook**, ajuste o nome/status e clique **Salvar configuração**.
8. Copie a URL e o token; configure o sistema externo para enviar POST com JSON e `Authorization: Bearer TOKEN`.
9. Envie um evento e abra **Logs → Atualizar logs → Ver JSON**.

Instruções detalhadas: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

## Variáveis do servidor

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS do projeto Supabase, obtida no diálogo Connect/Project Settings. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave server-side do projeto: `service_role` legada ou uma chave secreta `sb_secret_...`. Nunca use `anon`/publishable nesta variável. |
| `APP_PUBLIC_URL` | Origem da aplicação, sem caminho, query ou credenciais. Local: `http://localhost:3000`. Produção: `https://seu-dominio.com`. |
| `WEBHOOK_MAX_PAYLOAD_SIZE` | Limite em **bytes**. Padrão `1048576` (1 MiB); permitido de 1 a 10485760 (10 MiB). |
| `WEBHOOK_TOKEN_ENCRYPTION_KEY` | 32 bytes em hexadecimal: exatamente 64 caracteres. Gerada com o comando acima. |
| `WEBHOOK_TRUST_PROXY` | `false` por padrão. Só use `true` se seu reverse proxy substituir completamente `X-Forwarded-For`, impedindo spoofing. |

**NUNCA exponha SUPABASE_SERVICE_ROLE_KEY no frontend.** Não utilize prefixo `NEXT_PUBLIC_` para nenhuma chave. `.env.local` é ignorado pelo Git. Reinicie o servidor após mudar variáveis.

A chave AES deve permanecer estável e ter backup seguro separado do banco. Perdê-la impede recuperar os tokens salvos. Alterá-la arbitrariamente impede abrir as configurações existentes; uma troca planejada exige recriptografar os registros. Não reutilize a service role como chave AES.

O banco guarda `public_id`, não o domínio. Alterar `APP_PUBLIC_URL` muda as URLs apresentadas sem editar registros. O fornecedor ainda precisa receber o novo domínio.

## Uso

- **Criar webhook:** cria UUIDs no PostgreSQL e token aleatório de 32 bytes no servidor. É possível manter várias conexões.
- **Configuração:** selecione a conexão, edite nome/ativo, salve; copie URL/token a qualquer momento. O token fica visualmente oculto até clicar Mostrar token.
- **Novo token:** exige confirmação e invalida o anterior. Atualize o fornecedor em seguida. A URL permanece igual.
- **Último recebimento:** data do último evento **aceito e salvo**, convertida para o fuso do navegador. Atualize as configurações para consultar novos recebimentos.
- **Logs:** 20 registros por página, ordenados por data e ID decrescentes; atualização manual. O detalhe mostra payload, headers permitidos, origem e erro.
- **Desativar:** bloqueia novos eventos com HTTP 403 e preserva histórico. Não há exclusão nem regeneração de URL nesta versão.
- Requisições rejeitadas guardam somente metadados e erro, nunca o corpo não autenticado/inválido.

## Endpoints

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/api/admin/webhooks?page=1` | Lista até 20 configurações, URL e token recuperável. |
| POST | `/api/admin/webhooks` | Cria; body `{ "name": "Integração Principal" }`. |
| PATCH | `/api/admin/webhooks/:publicId` | Salva; body `{ "name": "Principal", "active": true }`. |
| POST | `/api/admin/webhooks/:publicId/token` | Regenera; body `{ "confirm": true }`. |
| GET | `/api/admin/events?page=1` | Lista resumo, sem carregar payloads inteiros. |
| GET | `/api/admin/events/:id` | Detalhe de um evento. |
| POST | `/api/webhooks/receive/:publicId` | Recebe evento externo. |

APIs administrativas usam `X-Dashboard-Request: 1` e verificam `Origin` quando presente. Isso reduz solicitações indevidas de outros sites, **não é autenticação**. As APIs administrativas entregam tokens de webhook por necessidade operacional; devem ter a mesma restrição de rede do painel. Nenhuma resposta contém a chave do Supabase.

## Teste de envio

Troque `UUID` e `TOKEN` pelos dados copiados do painel. Bash/cURL:

```bash
curl -i -X POST "http://localhost:3000/api/webhooks/receive/UUID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"event":"order.created","order_id":"123456","status":"created"}'
```

No **PowerShell**, use variáveis preenchidas localmente:

```powershell
$webhookUrl = Read-Host 'Cole a URL do webhook'
$webhookToken = Read-Host 'Cole o token' -MaskInput # PowerShell 7; no Windows PowerShell 5, remova -MaskInput
$payload = @{ event = 'order.created'; order_id = '123456'; status = 'created' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $webhookUrl -ContentType 'application/json' -Headers @{ Authorization = "Bearer $webhookToken" } -Body $payload
```

Resposta: HTTP **202**, `{ "success": true, "received": true, "eventId": "UUID" }`. Isso confirma persistência, não processamento nem criação de pedido. Também aceita `X-Webhook-Token` como alternativa; se Authorization estiver presente, ele tem prioridade.

Respostas: 400 JSON/configuração inválida; 401 token ausente/inválido; 403 webhook inativo (ou origem administrativa bloqueada); 404 inexistente; 405 método inválido; 413 limite excedido; 415 formato/compressão inválida; 500 falha de configuração/banco. Nenhum stack trace é entregue.

## Banco e decisões de segurança

- `public.webhooks`: IDs UUID, nome, módulo, ativo, autenticação obrigatória, token cifrado AES-256-GCM com IV aleatório, hash SHA-256 e timestamps.
- `public.webhook_events`: ID UUID, FK para webhook, identificador solicitado, método, Content-Type, JSONB, headers sanitizados, IP, status HTTP/recebimento, erro, ID externo e timestamps.
- FK `ON DELETE RESTRICT` protege histórico. `webhook_id` pode ser nulo para UUID inexistente. `id` já é o UUID do evento; não há coluna duplicada `event_uuid`.
- RLS habilitada; sem políticas públicas; `anon` e `authenticated` sem acesso. Grants e RPC restritos à service role. Funções `SECURITY INVOKER`, com `search_path` fixo.
- A RPC bloqueia a configuração, revalida ativo/hash e salva evento + último recebimento na mesma transação. Alterações de token/status concorrentes não contornam a validação.
- O token original só é recuperado no backend. SHA-256 é adequado aqui porque a entrada é aleatória de 256 bits; não é uma senha escolhida por usuário. Comparação por tempo constante no Node.
- Headers permitidos: `content-type`, `content-length`, `user-agent`, `x-request-id`, truncados a 512 caracteres. Authorization, cookies, API keys e todos os headers desconhecidos são descartados. Fornecedores não devem colocar segredos nos headers permitidos.
- Payload autenticado é preservado como JSON, podendo conter dados pessoais do fornecedor; trate o acesso aos logs como acesso a esses dados. Logs técnicos não imprimem payload, tokens, credenciais ou objetos de erro do banco.
- Validação conta bytes reais durante leitura do stream, além de verificar Content-Length. Requisições comprimidas não são aceitas. O proxy/provedor pode impor limite menor antes de alcançar o código.
- JSON fica limitado a 128 níveis; NUL, Unicode malformado e números fora da faixa finita do JavaScript são rejeitados com 400 antes do JSONB. IDs numéricos longos devem ser enviados como strings para preservar precisão no JavaScript.
- IP permanece vazio por padrão: Next.js não fornece um endereço remoto portátil confiável. Habilite proxy confiável somente quando configurado corretamente.
- `event_id`, `request_id` ou `X-Request-ID` são guardados quando disponíveis. Retentativas são registros distintos: nenhuma deduplicação automática ou suposição sobre formato de pedidos.
- `processed_at` fica nulo. Um processador futuro deverá tratar os eventos independentemente do recebimento.
- Não há retries infinitos; chamadas Supabase têm timeout de 10 segundos. Se o banco falhar, responde 500 sem confirmar recebimento. Se o banco estiver indisponível, também não será possível persistir o erro nele; haverá somente diagnóstico sanitizado no servidor.
- UUID malformado e métodos não permitidos são recusados antes de gravação. UUID válido inexistente gera log de rejeição. Registros sem webhook aparecem como "Webhook não encontrado".
- Logs são mantidos sem expiração automática. Não há rate limit nesta versão. Defina retenção/limites na infraestrutura conforme volume real, sem apagar histórico automaticamente.

## Publicação sem login

**Este painel não possui autenticação de usuário. Caso seja publicado na internet, recomenda-se restringir seu acesso no nível de infraestrutura, rede, reverse proxy, VPN, Cloudflare Access ou solução equivalente.**

Proteja **`/` e `/api/admin/*`** e mantenha **`/api/webhooks/receive/*`** acessível aos fornecedores. Nenhuma dessas soluções é instalada automaticamente. O cabeçalho administrativo é público e não substitui essa proteção.

```powershell
npm.cmd run build
npm.cmd start
```

O servidor escuta `127.0.0.1:3000`, apropriado para desenvolvimento ou reverse proxy na mesma máquina. Em plataformas gerenciadas, configure o comando de inicialização/host/porta exigido pelo provedor (por exemplo `npx next start --hostname 0.0.0.0 --port 3000`) e as variáveis no ambiente do servidor. Requer runtime Node; **não** funciona como exportação HTML estática. Use HTTPS e `APP_PUBLIC_URL` com a origem exata de acesso ao painel. `localhost` só funciona na própria máquina; fornecedores precisam de um endereço público alcançável.

## Verificações

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:http
```

Testes Vitest cobrem serviços, criptografia, receiver, integração do SDK com transporte HTTP simulado, rotas e interface (Testing Library/jsdom). O SQL completo também roda no PostgreSQL WASM do PGlite, em memória e somente nos testes, incluindo RLS/grants/RPC/FK/transações. **PGlite não é usado pela aplicação e não é um banco alternativo de produção.**

Os testes não substituem o teste real no seu Supabase após configurar as credenciais. Não há dados fictícios no painel nem fallback local de persistência. Sem configuração, o painel apresenta um erro orientando a instalação.

## Estrutura

```text
app/                 Página, layout, CSS e Route Handlers
components/          Painel Configuração + Logs
lib/                 Configuração, HTTP, criptografia e cliente Supabase privado
services/            Configuração, receiver e repositório Supabase
types/               Contratos de webhook/evento/paginação
tests/               Testes automatizados; banco temporário exclusivo do runner
scripts/             Smoke HTTP com servidor de produção temporário
docs/                Instalação Supabase e relatório de entrega
supabase_webhook.sql  Instalação completa, sem segredos
.env.example         Modelo de variáveis
```

Documentação oficial: [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
