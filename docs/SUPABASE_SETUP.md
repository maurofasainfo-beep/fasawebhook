# Preparar o Supabase — sem CLI

## 1. Criar o projeto

Entre em https://supabase.com/dashboard, clique em **New project**, escolha sua organização, nome e região e defina a senha do banco. Aguarde o provisionamento. Use um projeto destinado a esta aplicação.

## 2. Instalar as tabelas

1. Abra o projeto e acesse **SQL Editor**.
2. Clique **New query**.
3. Se você já instalou a versão anterior do sistema, abra o arquivo `supabase_webhook_update.sql` e copie todo o conteúdo. Caso ainda não tenha instalado o sistema, use `supabase_webhook.sql`.
4. No computador, abra:

   `C:\Users\User\Desktop\webhook-delivery\supabase_webhook.sql`

5. Copie **todo** o conteúdo do SQL escolhido, do comentário inicial até `COMMIT;`.
6. Cole no SQL Editor e clique **Run**.
7. Verifique no Table Editor as tabelas `public.webhooks` e `public.webhook_events`.

A atualização adiciona `deleted_at` e a função segura para excluir os logs de um webhook. Ela pode ser executada mais de uma vez.

O arquivo não precisa de substituições, senha, URL ou chaves. Cria tabelas, índices, constraints, FK, funções, triggers, permissões e RLS em uma transação. `gen_random_uuid()` já existe nas versões PostgreSQL usadas pelo Supabase: nenhuma extensão adicional é necessária.

Execute uma vez. Uma segunda execução informa que a tabela já existe e não deve ser usada para atualizar o schema. O script não apaga tabelas existentes nem ignora estruturas incompatíveis. Não habilite políticas de acesso anônimo para tentar corrigir erros.

## 3. Obter URL e chave privada

1. No diálogo **Connect** / configurações do projeto, copie a **Project URL**, semelhante a `https://seu-projeto.supabase.co`.
2. Abra **Project Settings → API Keys**.
3. Copie uma chave **Secret** (`sb_secret_...`) ou a chave legada **service_role**. Não copie a chave publishable/anon.
4. No projeto local, copie `.env.example` para `.env.local` e preencha:

   ```dotenv
   SUPABASE_URL=https://seu-projeto.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=coloque_a_chave_privada_aqui
   APP_PUBLIC_URL=http://localhost:3000
   WEBHOOK_MAX_PAYLOAD_SIZE=1048576
   WEBHOOK_TOKEN_ENCRYPTION_KEY=coloque_a_chave_hexadecimal_aqui
   WEBHOOK_TRUST_PROXY=false
   ```

   Os textos acima são marcadores; substitua-os pelos seus valores no arquivo local.

**NUNCA exponha SUPABASE_SERVICE_ROLE_KEY no frontend.** Não coloque em variáveis `NEXT_PUBLIC_`, arquivos públicos, screenshots, respostas HTTP, logs ou Git. O nome da variável é mantido por simplicidade e aceita uma secret key moderna server-side equivalente. Consulte a [documentação oficial das chaves](https://supabase.com/docs/guides/getting-started/api-keys).

## 4. Gerar a chave dos tokens

No terminal, dentro da pasta do projeto:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copie o resultado de 64 caracteres para `WEBHOOK_TOKEN_ENCRYPTION_KEY`. Guarde essa chave em local seguro: ela permite recuperar os tokens salvos. Não gere uma chave nova a cada inicialização.

## 5. Iniciar e testar

```powershell
cd C:\Users\User\Desktop\webhook-delivery
npm.cmd ci
npm.cmd run dev
```

Abra **http://localhost:3000**. Clique **Criar webhook**, copie URL/token e faça o teste descrito no README. Depois abra **Logs**, clique **Atualizar logs** e **Ver JSON**. O Table Editor deve mostrar o evento e a configuração deve mostrar o último recebimento.

Se alterar o arquivo `.env.local`, pare e inicie o servidor novamente.

## Se ocorrer um erro

- Confirme que o SQL inteiro foi executado sem erro no projeto correspondente à URL/chave.
- Confirme que a chave é server-side, não anon/publishable, e que o projeto não está pausado.
- Confirme que a Data API está habilitada e o schema `public` exposto nas configurações da API. O SQL concede acesso ao papel `service_role`; não abra grants/políticas para anon.
- Confirme que `WEBHOOK_TOKEN_ENCRYPTION_KEY` contém 64 caracteres hexadecimais e é a mesma utilizada ao criar os webhooks.
- O servidor registra apenas códigos técnicos sanitizados; não cole credenciais para diagnosticar.
- `403` no envio significa webhook desativado. `401` indica token errado/ausente. `413` indica limite do payload. O README detalha os códigos.
- Sem conexão com o Supabase não haverá confirmação de recebimento nem persistência local alternativa.

## Produção

Configure as mesmas variáveis no ambiente privado do backend, troque `APP_PUBLIC_URL` pelo domínio HTTPS e reinicie/reimplante a aplicação. Proteja o painel e `/api/admin/*` na infraestrutura, deixando o endpoint de recebimento acessível. O painel não tem autenticação de usuário por decisão do projeto.
