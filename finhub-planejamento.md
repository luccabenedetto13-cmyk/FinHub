# FinHub — Planejamento e Estado do Projeto

> Plataforma web de gestão financeira pessoal com sincronização automática via Open Finance Brasil.
>
> **Este documento é o ponto de partida para entender o projeto.** Cobre o produto, a arquitetura, o que já foi entregue e o que falta. Use-o para fazer onboarding antes de mexer no código.

---

## 1. Visão Geral

### Problema
Pessoas com múltiplas contas bancárias (PJ + PF, vários bancos) perdem o controle financeiro porque depender de planilhas manuais é insustentável. Não existe visão unificada do patrimônio, dos gastos e da entrada de receitas.

### Solução
Uma plataforma web que:
1. Conecta às contas bancárias do usuário via **Open Finance Brasil** (sem scraping, sem armazenar senhas).
2. Sincroniza automaticamente saldos, extratos e investimentos.
3. Categoriza transações com IA.
4. Apresenta dashboards unificados, projeções e alertas.

### Usuário-alvo (MVP)
Profissional autônomo ou PJ com múltiplas fontes de renda (salário, pró-labore, vale) e contas em diferentes bancos. Quer controle sem trabalho manual.

---

## 2. Status Atual

**MVP completo no código** (todos os 9 critérios de aceite cobertos). Falta apenas validação end-to-end em ambiente real (Supabase + Pluggy + email).

| Fase original | Status |
|---|---|
| 1. Fundação (auth + schema + RLS) | ✅ Completa |
| 2. Open Finance (conexão + sync + webhook + cron) | ✅ Completa |
| 3. Transações + IA (regras + A/B) | ✅ Completa |
| 4. Dashboard + Insights (cards + gráficos) | ✅ Completa |
| 5. Metas, polish e conformidade | ✅ Completa |
| **Sprint 5 extra: DevOps & Quality** | ✅ Completa (Sentry, audit log, rate limit, 2FA, Playwright) |

Histórico de execução: [§ 13 — Histórico de Sprints](#13-histórico-de-sprints).

---

## 3. Escopo do MVP — Checklist de Aceite

| # | Critério | Implementação |
|---|---|---|
| 1 | Criar conta e fazer login | `/login` com email/senha + Google OAuth + reset (`/auth/forgot-password`, `/auth/update-password`) |
| 2 | Conectar pelo menos um banco | `PluggyConnectButton` + Edge Function `create-pluggy-token` + `save-bank-connection` |
| 3 | Ver transações sincronizadas automaticamente | `sync-all-connections` agendada via `pg_cron` 03:00 UTC + webhook Pluggy |
| 4 | Ver cada transação categorizada | `categorize-transactions` com `category_rules` antes da IA + A/B Gemini vs Claude |
| 5 | Corrigir categoria → próximas similares ficam corretas | Edição inline em `/transactions` cria entrada em `category_rules` aplicada na próxima rodada |
| 6 | Dashboard com patrimônio, entradas/saídas, gastos por categoria | `/` com cards + Recharts (`MonthlyFlowCards`, `CategoryBreakdownChart`, `NetWorthChart`) |
| 7 | Criar meta e acompanhar progresso | `/goals` com CRUD + barra de progresso + contribuir/retirar |
| 8 | Desconectar banco | `/accounts` com botão Remover (chama Pluggy `DELETE /items` + cascade local) |
| 9 | Excluir conta (LGPD) | `/settings` → DangerZone → Edge Function `delete-account` (service role) |

**Fora do escopo do MVP** (versões futuras): app mobile nativo, faturas detalhadas de crédito, importação de notas fiscais, conta conjunta, pagamento via plataforma, recomendações de investimento.

---

## 4. Stack Técnica

| Camada | Tecnologia | Versão | Notas |
|---|---|---|---|
| Frontend | **Next.js (App Router)** + TypeScript | 14.2.35 | SSR, Server Actions, RSC |
| UI | **Tailwind CSS** + **shadcn/ui** + **@base-ui/react** | 3.4 / shadcn 4.6 | Componentes acessíveis e customizáveis |
| Gráficos | **Recharts** | ^3.8.1 | BarChart, AreaChart no dashboard |
| Backend | **Supabase** (Postgres + Auth + Edge Functions) | – | RLS nativo, JWT, MFA TOTP |
| Cliente Supabase | `@supabase/ssr` + `@supabase/supabase-js` | 0.10 / 2.105 | Cookies SSR, todos os clients tipados com `Database` |
| Open Finance | **Pluggy** | – | `react-pluggy-connect` ^2.12 no widget |
| IA (categorização) | **Gemini 1.5 Flash** + **Claude Haiku 4.5** | – | A/B 50/50 com métricas em `categorization_runs`. Decisão final adiada. |
| Cron / Jobs | **Supabase pg_cron + pg_net** | – | Configurado via `supabase/cron-setup.sql` |
| Observabilidade | **Sentry** (frontend) + **Supabase Logs** | @sentry/nextjs ^10.52 | Edge Functions Deno usam `console.error` por enquanto |
| Testes E2E | **Playwright** | ^1.59 | 3 specs cobrindo rotas públicas e middleware |
| Deploy | **Vercel** (frontend) + **Supabase Cloud** (backend) | – | Não há `vercel.json` — config padrão |

---

## 5. Arquitetura

```
┌─────────────────┐       ┌──────────────────────────┐
│  Next.js App    │◄─────►│   Supabase               │
│  (Vercel)       │       │   - Postgres (RLS)       │
│  - Server Comp  │       │   - Auth + MFA           │
│  - Server Actns │       │   - Edge Functions       │
│  - Middleware   │       │   - pg_cron + pg_net     │
└────────┬────────┘       └──────────┬───────────────┘
         │                           │
         │     ┌──── Sentry ─────┐   │
         │     │ (errors)        │   │
         │     └─────────────────┘   ▼
         │                  ┌────────────────────┐
         ├─────────────────►│  Pluggy API        │◄── Bancos
         │                  │  + Webhook (HMAC)  │    (Itaú, Nubank...)
         │                  └────────────────────┘
         │
         ▼
┌─────────────────┐    ┌────────────────────┐
│  Gemini 1.5     │    │  Claude Haiku 4.5  │
│  (Google)       │    │  (Anthropic)       │
└─────────────────┘    └────────────────────┘
   ↑               A/B 50/50 com métricas
```

### Fluxos principais

**Fluxo 1 — Conexão de banco (síncrono, iniciado pelo usuário):**
1. Usuário clica em "Conectar banco" no dashboard ou `/accounts`.
2. Frontend chama Edge Function `create-pluggy-token` (modo create) → devolve `accessToken`.
3. Frontend abre o **Pluggy Connect Widget** com o token.
4. Usuário autoriza no banco. Pluggy retorna um `itemId` no callback `onSuccess`.
5. Frontend envia o `itemId` para Edge Function `save-bank-connection` → busca dados do item, persiste em `bank_connections` e `accounts`.
6. `router.refresh()` para mostrar o banco no dashboard.

**Fluxo 2 — Reconectar banco (status `login_required` ou `error`):**
1. `/accounts` mostra botão "Reconectar" ao lado da conexão.
2. `PluggyConnectButton` é renderizado com prop `itemIdToReconnect`.
3. `create-pluggy-token` recebe `itemId` no body e gera token em **modo update** (validando ownership).
4. Widget abre direto no fluxo de re-autenticação.

**Fluxo 3 — Sincronização (3 caminhos):**
- **Cron diário (3h UTC):** `sync-all-connections` (service role) itera por todas as conexões `active`/`updating` e chama `syncBankConnection` para cada (helper compartilhado em `_shared/sync/`).
- **Manual por conta:** botão `<AccountSyncButton>` chama `sync-transactions` com o `accountId` específico.
- **Webhook Pluggy:** eventos `item/updated`, `item/login_succeeded` e `transactions/*` disparam sync; eventos `item/error`, `item/waiting_user_input` apenas atualizam `bank_connections.status`.

**Fluxo 4 — Categorização (regras antes da IA):**
1. Botão "Categorizar com IA" em `/transactions` chama `categorize-transactions`.
2. Função busca todas as transações com `category_id IS NULL` e `auto_categorized = false` (até 50).
3. **Antes da IA**, aplica `category_rules` (ILIKE sobre `merchant_name + description`). Matches são categorizados sem custo.
4. O resto vai para o provider escolhido por `selectProvider()` (Gemini ou Claude com prompt caching).
5. Cada categorização da IA cria 1 linha em `categorization_runs` com latency, tokens e custo estimado.
6. Resposta inclui `ruleMatched` e `aiCategorized` separadamente.

**Fluxo 5 — Correção de categoria (treina o sistema):**
1. Usuário clica no chip de categoria de uma transação em `/transactions`.
2. `<CategoryPicker>` abre `<select>` agrupado por tipo. Ao escolher, Server Action `updateTransactionCategory`:
   - Atualiza `transactions` com `category_id` e `user_modified = true`.
   - Deriva pattern de `merchant_name` (ou primeiras palavras da `description`).
   - Cria/incrementa linha em `category_rules`.
   - Marca runs anteriores em `categorization_runs` como `was_corrected = true` (sinal para o A/B).

**Fluxo 6 — Detecção automática de transferências:**
1. Botão "Detectar transferências" em `/transactions` chama Server Action `detectTransfers`.
2. Algoritmo determinístico agrupa por valor absoluto e procura pares com sinais opostos em contas diferentes em ±1 dia.
3. Atribui categoria default "Entre Contas Próprias" para ambas (`auto_categorized = true`).

---

## 6. Modelo de Dados (Postgres / Supabase)

10 tabelas no schema `public`. **Todas com RLS habilitado.** Tipos TypeScript em [`src/types/database.types.ts`](src/types/database.types.ts).

### Tabelas de domínio

```sql
profiles (id, full_name, avatar_url, created_at)
  └─ id REFERENCES auth.users PRIMARY KEY

bank_connections (id, user_id, pluggy_item_id, institution_name,
                  institution_logo_url, status, last_sync_at, created_at)
  └─ status: 'active' | 'error' | 'updating' | 'login_required'
  └─ pluggy_item_id UNIQUE

accounts (id, bank_connection_id, user_id, pluggy_account_id, type,
          name, balance, currency, updated_at)
  └─ bank_connection_id ... ON DELETE CASCADE
  └─ type: 'checking' | 'savings' | 'credit_card' | 'investment' | 'loan'

categories (id, user_id NULLABLE, parent_id, name, icon, color, type, is_default)
  └─ user_id IS NULL = categoria default global (compartilhada entre usuários)
  └─ type: 'income' | 'expense' | 'transfer'

transactions (id, user_id, account_id, pluggy_transaction_id, category_id,
              amount, description, merchant_name, transaction_date,
              posted_at, auto_categorized, user_modified, notes, created_at)
  └─ account_id ... ON DELETE CASCADE
  └─ pluggy_transaction_id UNIQUE
  └─ index (user_id, transaction_date desc) e (category_id)

category_rules (id, user_id, pattern, category_id, match_count, created_at)
  └─ pattern em UPPERCASE, comparado por ILIKE

recurring_incomes (id, user_id, source_name, type, expected_amount,
                   expected_day_of_month, active)
  └─ type: 'salary' | 'pro_labore' | 'benefit' | 'other'

goals (id, user_id, name, target_amount, current_amount, target_date, created_at)

budgets (id, user_id, category_id, monthly_limit, active)
  └─ UNIQUE (user_id, category_id)
```

### Tabelas de telemetria/segurança (adicionadas durante o desenvolvimento)

```sql
categorization_runs (id, user_id, transaction_id, provider, model,
                     suggested_category_id, suggested_category_name,
                     latency_ms, tokens_input, tokens_output,
                     estimated_cost_usd, was_corrected, corrected_at,
                     corrected_to_category_id, created_at)
  └─ provider: 'gemini' | 'anthropic'
  └─ transaction_id ... ON DELETE CASCADE
  └─ alimenta o A/B test entre IAs

audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
  └─ tabela WRITE-ONCE (sem policy de UPDATE/DELETE)
  └─ action: 'bank_connection.removed' | 'category.merged' | 'category.deleted'
           | 'data.exported' | 'profile.updated' | 'account.delete_requested'

rate_limits (id, user_id, action, window_start, count)
  └─ UNIQUE (user_id, action, window_start)
  └─ função public.cleanup_rate_limits() apaga > 7 dias (cron 03:30 UTC)
```

### Padrão de RLS

```sql
-- Padrão para tabelas pessoais
create policy "Users read own X" on X for select using (auth.uid() = user_id);
create policy "Users insert own X" on X for insert with check (auth.uid() = user_id);
create policy "Users update own X" on X for update using (auth.uid() = user_id);
create policy "Users delete own X" on X for delete using (auth.uid() = user_id);

-- Exceção: categories aceita defaults globais
create policy "Users can read own or default categories"
  on categories for select using (auth.uid() = user_id or is_default = true);

-- Exceção: audit_logs sem UPDATE/DELETE (write-once)
```

### Migrations aplicadas (em ordem)

```
20260501000000_initial_schema.sql      9 tabelas + RLS
20260501000001_auth_trigger.sql        trigger auto-cria profile no signup
20260501020000_categorization_runs.sql tabela + 3 índices + RLS
20260501030000_cron_extensions.sql     pg_cron + pg_net
20260501040000_audit_logs.sql          write-once + RLS de SELECT/INSERT
20260501050000_rate_limits.sql         fixed window + RLS
20260501060000_cleanup_rate_limits.sql função SQL para purge
```

### Seed

`supabase/seed.sql` insere 23 categorias default (`is_default = true`, `user_id IS NULL`) — Receitas, Despesas e Transferências do apêndice. Idempotente via `WHERE NOT EXISTS`.

---

## 7. Edge Functions

Todas em `supabase/functions/`. Lógica compartilhada em `_shared/`.

| Função | verify_jwt | Responsabilidade | Limite |
|---|---|---|---|
| `create-pluggy-token` | ✓ | Gera connect token (modo create ou update via `itemId` no body) | 20/h |
| `save-bank-connection` | ✓ | Persiste item + accounts após o widget | – |
| `sync-transactions` | ✓ | Sync por conta (manual via UI) | – |
| `sync-all-connections` | ✗ | Cron diário, itera todos os users (service role + Bearer auth) | – |
| `pluggy-webhook` | ✗ | Recebe eventos Pluggy, valida HMAC SHA256 e dispara sync | – |
| `categorize-transactions` | ✓ | Aplica `category_rules` → IA (Gemini/Claude A/B) → grava `categorization_runs` | 30/h |
| `detect-recurring-income` | ✓ | Heurística determinística sobre últimos 6 meses | 5/h |
| `delete-account` | ✓ | Apaga tudo + `auth.admin.deleteUser` (service role) | – |
| `delete-pluggy-item` | ✓ | Chama `DELETE /items/{itemId}` no Pluggy ao remover conexão | – |

### Módulos compartilhados

- **`_shared/sync/`** — `authenticatePluggy`, `syncAccountTransactions`, `syncBankConnection`, `markConnectionSynced`. Usado por `sync-transactions`, `sync-all-connections`, `pluggy-webhook`.
- **`_shared/ai/`** — abstração de provider:
  - `types.ts` — interface `CategorizationProvider`, `SYSTEM_PROMPT`, `buildUserMessage`
  - `gemini.ts` — `gemini-1.5-flash`
  - `anthropic.ts` — `claude-haiku-4-5` com prompt caching ephemeral no system
  - `index.ts` — `selectProvider()` (env `AI_PROVIDER` ou random 50/50) e `getProviderWithFallback()`
- **`_shared/rate-limit/`** — `checkRateLimit` (fixed window) e `rateLimitResponse` (429 com `Retry-After`).

---

## 8. Telas (Frontend)

15 rotas. Layout compartilhado por `<AppHeader>` em `src/components/layout/`.

| Rota | Tipo | Função |
|---|---|---|
| `/` | dynamic | Dashboard: saldo total, cards de fluxo do mês com %change, gráficos (Recharts), instituições, últimas 5 tx |
| `/login` | static | Email/senha + Google + link para reset; suporta MFA challenge inline |
| `/transactions` | dynamic | Lista com filtros URL-based (data/conta/categoria/tipo/busca), paginação 50/pg, edição inline de categoria, "Categorizar com IA" e "Detectar transferências" |
| `/categories` | dynamic | CRUD com 3 seções (Receitas/Despesas/Transferências), merge entre categorias do mesmo tipo |
| `/accounts` | dynamic | Cards de conexão com badge de status, reconectar quando `login_required`/`error`, remover com confirmação detalhada |
| `/goals` | dynamic | CRUD de metas com barra de progresso + contribuir/retirar |
| `/budgets` | dynamic | Limite mensal por categoria com alerta verde/amarelo/vermelho conforme uso |
| `/recurring` | dynamic | Receitas recorrentes detectadas; pausar/ativar/remover |
| `/settings` | dynamic | Perfil, 2FA TOTP, exportar CSV, excluir conta (DangerZone com confirmação dupla "EXCLUIR") |
| `/auth/callback` | dynamic | OAuth callback (Google) |
| `/auth/confirm` | dynamic | Confirmação de email + token de recovery |
| `/auth/forgot-password` | static | Form de email para recuperar senha |
| `/auth/update-password` | static | Definir nova senha após link de recovery |
| `/api/export-csv` | dynamic | Stream de CSV com BOM UTF-8 e separador `;` |
| `_not-found` | static | 404 |

### Estrutura do `src/`

```
src/
├── app/
│   ├── api/export-csv/route.ts
│   ├── auth/{callback,confirm,forgot-password,update-password}/
│   ├── accounts/{page.tsx, actions.ts}
│   ├── budgets/{page.tsx, actions.ts}
│   ├── categories/{page.tsx, actions.ts}
│   ├── goals/{page.tsx, actions.ts}
│   ├── login/page.tsx
│   ├── recurring/{page.tsx, actions.ts}
│   ├── settings/{page.tsx, actions.ts}
│   ├── transactions/{page.tsx, actions.ts}
│   ├── layout.tsx, page.tsx (dashboard), globals.css
├── components/
│   ├── layout/AppHeader.tsx
│   ├── dashboard/{MonthlyFlowCards, CategoryBreakdownChart, NetWorthChart}.tsx
│   ├── transactions/{TransactionRow, TransactionFilters, CategoryPicker, DetectTransfersButton}.tsx
│   ├── categories/{CategoryItem, NewCategoryForm}.tsx
│   ├── accounts/RemoveBankConnectionButton.tsx
│   ├── goals/{GoalCard, NewGoalForm}.tsx
│   ├── budgets/{BudgetItem, NewBudgetForm}.tsx
│   ├── recurring/{RecurringIncomeItem, DetectRecurringButton}.tsx
│   ├── settings/{ProfileSection, MfaSection, DangerZone}.tsx
│   ├── ui/  ← shadcn primitives (button, card, input, label)
│   └── {AccountSyncButton, AiCategorizeButton, PluggyConnectButton}.tsx
├── lib/
│   ├── audit.ts        ← helper para audit_logs
│   ├── dashboard.ts    ← agregações puras (aggregateFlow, etc.)
│   └── utils.ts        ← cn() helper
├── types/
│   └── database.types.ts ← types gerados manualmente do schema
├── utils/supabase/
│   ├── client.ts, server.ts, middleware.ts ← createClient<Database>()
├── instrumentation.ts ← hook do Sentry
└── middleware.ts ← protege rotas (exceto /login e /auth/*)
```

---

## 9. Decisões de Arquitetura (registro histórico)

Decisões importantes tomadas durante o desenvolvimento. Releia antes de mudar arquitetura.

### A/B test entre Gemini e Claude (Sprint 1, Bloco C)
- **Contexto:** plano original especificava Claude Haiku 4.5; primeira implementação usou Gemini 1.5 Flash.
- **Decisão:** abstrair em `CategorizationProvider`, rodar A/B 50/50 e medir em `categorization_runs`.
- **Métricas:** latency, tokens, custo estimado, taxa de correção (`was_corrected`).
- **Decisão final:** adiada para quando houver volume — query sugerida em [§ 12](#12-pendências-operacionais-para-deploy).

### Categorização: regras antes da IA (Sprint 1, Bloco B)
- Quando o usuário corrige uma categoria, gera entrada em `category_rules` com `pattern` derivado de `merchant_name` ou primeiras palavras da `description`, em UPPERCASE.
- A função `categorize-transactions` aplica regras (ILIKE) **antes** de chamar IA. Matches viram zero tokens.
- `match_count` é incrementado a cada hit para ranqueamento futuro.

### Transferências entre contas próprias (Sprint 2, Bloco E)
- Algoritmo determinístico (sem IA): agrupa transações elegíveis por valor absoluto, procura pares com sinais opostos em contas diferentes do mesmo user em ±1 dia.
- Marca ambas com a categoria default "Entre Contas Próprias".
- Disparado manualmente pelo botão em `/transactions` (não roda automaticamente; pode virar cron depois).

### Audit log write-once (Sprint 4, Bloco C)
- Tabela `audit_logs` sem policy de UPDATE/DELETE. Helper `logAudit()` é best-effort — falhas só logam, nunca quebram a action principal.
- **Sem PII em metadata:** ex.: `profile.updated` registra só `full_name_length`, não o valor.

### Rate limit não-atômico (Sprint 4, Bloco E)
- Fixed window com SELECT + UPDATE. Race em alta concorrência pode permitir N+M-1 chamadas onde M = paralelismo.
- Aceitável para um único usuário; se virar gargalo, migrar para função RPC com `ON CONFLICT DO UPDATE RETURNING`.

### `removeBankConnection`: Pluggy DELETE é best-effort (Sprint 5, Bloco C)
- A Server Action chama Edge Function `delete-pluggy-item` antes do delete local.
- Se a chamada Pluggy falhar (rede, API instável, key expirada), apenas loga e segue. UX prevalece sobre cidadania de housekeeping.

### Sentry: só prod, só com DSN (Sprint 5, Bloco A)
- `sentry.{client,server,edge}.config.ts` checam DSN antes de inicializar. Em dev, ficam no-op.
- `withSentryConfig` em modo `silent: true` quando sem DSN.
- Source maps desabilitados a menos que `SENTRY_AUTH_TOKEN` esteja setado.
- Edge Functions Deno **não** estão integradas — usam `console.error`. Adaptar requer `@sentry/deno` ou fetch direto à API Sentry.

---

## 10. Segurança e LGPD

Não-negociável para um app financeiro:

- ✅ **RLS em todas as tabelas com `user_id`** — isolamento por usuário.
- ✅ **Nunca armazenar credenciais bancárias** — Pluggy faz a custódia, recebemos só `pluggy_item_id`.
- ✅ **HTTPS only** (Vercel força).
- ✅ **Variáveis sensíveis** (`PLUGGY_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) só em Edge Functions, nunca no client. Frontend só vê `NEXT_PUBLIC_*`.
- ✅ **Rate limiting** nas Edge Functions de IA e Pluggy (`create-pluggy-token`, `categorize-transactions`, `detect-recurring-income`).
- ✅ **Audit log** de ações sensíveis (`audit_logs`).
- ✅ **LGPD: exclusão de conta** — Edge Function `delete-account` apaga em ordem: `bank_connections` (cascade) → `categorization_runs` → `category_rules` → `budgets` → `recurring_incomes` → `goals` → `categories` próprias → `profiles` → `auth.users` via admin API.
- ✅ **Webhook Pluggy** com validação HMAC SHA256 timing-safe.
- ✅ **2FA via TOTP** (Supabase Auth) — UI em `/settings`, challenge no `/login` quando `nextLevel == aal2`.

**Pendentes:**
- ❌ Sentry nas Edge Functions Deno (apenas frontend coberto).
- ❌ Cleanup periódico de `categorization_runs` antigas (sem privacy issue, mas tabela cresce).

---

## 11. Como Rodar Localmente

### Pré-requisitos
- Node.js 20+ e npm
- Docker (para Supabase local) ou conta no Supabase Cloud
- (Opcional) Supabase CLI: `npx supabase` funciona sem instalação global

### Setup do frontend
```bash
git clone <repo>
cd FinHub
npm install
cp .env.local.example .env.local  # se existir; senão crie manualmente
# preencher NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

App em `http://localhost:3000`.

### Setup do Supabase

**Opção A — Cloud (mais simples):**
1. Criar projeto em [supabase.com](https://supabase.com)
2. `supabase link --project-ref <ref>` (do CLI)
3. `supabase db push` aplica todas as migrations
4. SQL Editor: rodar `supabase/seed.sql` para popular categorias default
5. (Opcional) `supabase/cron-setup.sql` para agendar jobs (substituindo placeholders)

**Opção B — Local com Docker:**
```bash
npx supabase start
npx supabase db reset  # aplica migrations + seed
```

### Variáveis de ambiente

`.env.local` (frontend):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
PLUGGY_CLIENT_ID=...        # só usado em testes locais; em prod fica nas Edge Functions
PLUGGY_CLIENT_SECRET=...
# NEXT_PUBLIC_SENTRY_DSN=...  # opcional
```

Edge Functions (via `supabase secrets set` em prod, ou `supabase/functions/.env` em dev):
```
PLUGGY_CLIENT_ID=...
PLUGGY_CLIENT_SECRET=...
PLUGGY_WEBHOOK_SECRET=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
AI_PROVIDER=ab              # 'gemini' | 'anthropic' | 'ab' (default 50/50)
SUPABASE_SERVICE_ROLE_KEY=... # delete-account, sync-all-connections, pluggy-webhook
```

### Comandos úteis

```bash
npm run dev            # Next dev server
npm run build          # Build produção (valida tipos)
npm run lint           # ESLint
npx tsc --noEmit       # Só type check, sem build

npm run test:e2e       # Playwright (requer `npx playwright install` na 1ª vez e `npm run dev` rodando)
npm run test:e2e:ui    # Playwright UI mode

npx supabase db push           # aplica migrations
npx supabase functions deploy <nome>
npx supabase secrets set KEY=valor
npx supabase functions logs <nome> --since 1h
```

---

## 12. Pendências Operacionais para Deploy

Quando for colocar em produção (ou em ambiente de homologação), execute esta lista:

```bash
# 1. Aplicar todas as 7 migrations
supabase db push

# 2. Rodar seed.sql (categorias default) — pelo SQL Editor do Dashboard ou:
psql "$DATABASE_URL" -f supabase/seed.sql

# 3. Deploy de todas as Edge Functions
supabase functions deploy \
  create-pluggy-token \
  save-bank-connection \
  sync-transactions \
  sync-all-connections \
  pluggy-webhook \
  categorize-transactions \
  detect-recurring-income \
  delete-account \
  delete-pluggy-item

# 4. Setar secrets das Edge Functions
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  PLUGGY_CLIENT_ID=... \
  PLUGGY_CLIENT_SECRET=... \
  PLUGGY_WEBHOOK_SECRET=... \
  GEMINI_API_KEY=... \
  ANTHROPIC_API_KEY=sk-ant-... \
  AI_PROVIDER=ab

# 5. SQL Editor: rodar supabase/cron-setup.sql substituindo placeholders
#    <SUPABASE_PROJECT_REF> e <SUPABASE_SERVICE_ROLE_KEY>
#    Agenda 'finhub-sync-daily' (03:00 UTC) e 'finhub-cleanup-rate-limits' (03:30 UTC).

# 6. Pluggy Dashboard: criar webhook apontando para
#    https://<ref>.supabase.co/functions/v1/pluggy-webhook
#    O secret usado deve bater com PLUGGY_WEBHOOK_SECRET acima.

# 7. Deploy do frontend (Vercel ou similar) com as env vars NEXT_PUBLIC_*
#    e (opcionais) SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT.
```

### Decisão de IA — query SQL para análise do A/B

Quando houver pelo menos algumas semanas de dados em `categorization_runs`:

```sql
select
  provider,
  count(*)                             as runs,
  round(avg(latency_ms))               as avg_latency_ms,
  round(sum(estimated_cost_usd)::numeric, 4) as total_cost_usd,
  round(100.0 * sum(case when was_corrected then 1 else 0 end) / count(*), 1)
                                        as correction_rate_pct
from categorization_runs
where created_at > now() - interval '30 days'
group by provider;
```

Se um provider tem **menor latência** + **menor custo** + **menor taxa de correção**, escolher ele e setar `AI_PROVIDER=<provider>` para parar o A/B.

### TODOs conhecidos
- [ ] Sentry nas Edge Functions Deno (`@sentry/deno` ou fetch direto).
- [ ] Cleanup cron para `categorization_runs` antigas (>1 ano? a definir).
- [ ] Playwright com `globalSetup` autenticado (cria user via service role, salva storage state) — abriria caminho para testar dashboard, edição inline, criação de meta etc.
- [ ] UI para inspecionar `audit_logs` (ex: aba em `/settings` com últimas 50 ações).
- [ ] Refinar `detect-recurring-income`: considerar variação de até ±10% de valor para semanas com 5 vs 4 dias úteis; aceitar intervalos quinzenais.

---

## 13. Histórico de Sprints

20 commits em ~2 semanas de execução, agrupados em 5 sprints. Cada sprint tem um arquivo de memória detalhada em `~/.claude/projects/.../memory/project_sprint_N_plan.md`.

| Sprint | Temas | Commits |
|---|---|---|
| **Sprint 1** | Estabilizar base + tela de transações + A/B IA | `5da84c2` (init), `efdb777` |
| **Sprint 2** | Categorias CRUD, /accounts, reset senha, /settings, transferências | `6f40f77`, `4429b48`, `5b67a59`, `3abe866`, `3061ac1` |
| **Sprint 3** | Cron diário, webhook, recurring-income, dashboard com gráficos | `cd5d678`, `b15079d`, `56919f1`, `4d29688` |
| **Sprint 4** | Metas, orçamentos, audit log, 2FA, rate limit | `774a2f2`, `99b654a`, `438644c`, `21b45bf`, `11df19f` |
| **Sprint 5** | Sentry, /recurring UI, cleanup, Playwright | `96aa85f`, `d6a9115`, `471d943`, `4482a1a` |

---

## 14. Roadmap Futuro (pós-MVP)

Lista priorizada de features não cobertas no MVP. Não há datas — pegar conforme necessidade:

### Curto prazo (semanas)
- **Smoke test em produção** — validar fluxo completo com 1 conta sandbox + 1 real.
- **Dashboard de IA admin** — visualização das métricas de `categorization_runs` para tomar a decisão final.
- **Tela de `audit_logs`** — `/settings` ganharia uma aba "Atividade".

### Médio prazo (mês)
- **Faturas de cartão de crédito detalhadas** — agrupar tx de credit_card em "fatura aberta/fechada" com data de vencimento.
- **Compartilhamento controlado** com cônjuge/contador (read-only views por categoria de contas).
- **Alertas push/email** — orçamento estourado, queda anormal de saldo, fim do mês.
- **Cashflow projetado** — combinar `recurring_incomes` + média de despesas + saldo atual.

### Longo prazo (trimestre+)
- **PWA instalável** — alternativa barata a app nativo.
- **Importação OFX/CSV** — bancos não suportados pelo Open Finance.
- **Multi-currency** real (hoje só BRL).
- **Recomendações de movimentação** — "você tem R$ X parado em CC, considera CDI".

---

## Apêndice A — Categorias Default (já no `seed.sql`)

**Receitas** (7): Salário, Pró-labore, Vale (alimentação/refeição), Freelance, Rendimentos de Investimentos, Reembolso, Outras Receitas

**Despesas** (13): Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Compras, Assinaturas, Impostos, Pets, Viagem, Tarifas Bancárias, Outras Despesas

**Transferências** (3): Entre Contas Próprias, Investimento, Pagamento de Cartão

Cada uma com `icon` (Lucide) e `color` (hex).

## Apêndice B — Convenções de Código

- TypeScript estrito; queries do Supabase tipadas via `createClient<Database>()`.
- Server Components onde possível; Client Components (`'use client'`) só para interatividade.
- Server Actions em `src/app/<route>/actions.ts` retornam `ActionResult = { ok: true } | { ok: false; error: string }`.
- Edge Functions usam helpers de `_shared/`. Erros são logados (`console.error`) e retornados como `{ error: string }`.
- RLS protege os dados; código só faz double-check redundante (`eq('user_id', user.id)`) por segurança em depth.
- Audit log via `logAudit()` em ações sensíveis. **Best effort** — nunca falha a action principal.
- Commits seguem `feat:` / `fix:` / `chore:` / `test:` com escopo do sprint quando relevante.

## Apêndice C — Quem mantém o quê

Solo. Lucca Benedetto é o desenvolvedor único do projeto até o momento. Onboarding deste documento foi pensado para escalar quando entrar mais alguém (humano ou IA).
