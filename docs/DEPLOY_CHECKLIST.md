# Chamacarga — Checklist de Deploy

Roteiro passo a passo pra colocar o Chamacarga no ar. Segue exatamente
esta ordem — pular Supabase quebra Render, pular Render quebra Vercel,
pular JWT/CORS quebra tudo.

**Tempo estimado:** 45–60 min tela na mão.

**Pré-requisitos (5 min, se não tiver):**
- [ ] Conta Supabase — https://supabase.com (grátis, plano free basta).
- [ ] Conta Render — https://render.com (grátis, login com GitHub).
- [ ] Conta Vercel — https://vercel.com (grátis, login com GitHub).
- [ ] Repo `imobai-create/niveologistica` no GitHub já existe (✅).

---

## Bloco 1 · Supabase (15 min)

O banco já pode existir dessa etapa em diante. As migrations criam
schema, RLS, rotas públicas, hash-chain e metadado RBC.

### 1.1 Projeto Supabase

- [ ] Se ainda **não tem** projeto: **New project** → nome
  `chamacarga`, senha do banco (anota — vira parte da `DATABASE_URL`),
  região `South America (São Paulo)`. Aguarda ~2 min provisionar.
- [ ] Se **já tem** projeto: pula pra 1.2.

### 1.2 Rodar as 6 migrations SQL — Studio → SQL Editor

Copia e cola cada arquivo do repo, uma por vez, apertando **Run** entre
cada. Ordem obrigatória:

- [ ] `db/01_schema.sql` — cria as tabelas, enums, triggers imutáveis,
  view `vw_entrega_resumo`.
  **Verificar:** `select count(*) from information_schema.tables where
  table_schema='public';` deve retornar ≥ 10.
- [ ] `db/02_avaliar_excursao.sql` — função de avaliação de excursão.
  **Verificar:** `select avaliar_excursao('00000000-0000-0000-0000-000000000000'::uuid);`
  retorna sem erro (retorna `void`).
- [ ] `db/03_seed.sql` — cliente + destinatário + pedido + entrega de
  demo (opcional pra dev; **em produção pura, pula esse**).
- [ ] `db/04_rls_policies.sql` — habilita RLS em 10 tabelas, cria
  policies por `cliente_id`.
  **Verificar:** `select count(*) from pg_policies where
  schemaname='public';` deve retornar ≥ 8.
- [ ] `db/05_reservas_publicos.sql` — tabelas `janelas_ofertadas`,
  `reservas`, `tokens_publicos`, colunas de hash-chain, trigger
  `trg_eventos_hash_chain`.
  **Verificar:** `select column_name from information_schema.columns
  where table_name='eventos' and column_name in ('hash_prev','hash_atual');`
  retorna 2 linhas.
- [ ] `db/06_sensor_rbc.sql` — colunas `sensor_certificado_rbc` +
  validade em `entregas`.

### 1.3 Bucket de Storage pro POD

- [ ] Storage → **New bucket** → nome exatamente `pods`, marcar como
  **Public bucket**. Salvar.

### 1.4 Coletar as 4 credenciais que Render/Vercel vão pedir

Vai em Settings → API. Anota num arquivo local temporário:

| Nome | Onde no Supabase | Onde vai usar |
|---|---|---|
| **Project URL** | `https://xxxxx.supabase.co` | `SUPABASE_URL`, `VITE_SUPABASE_URL` |
| **anon / public** | `eyJ...` (chave longa) | `VITE_SUPABASE_ANON_KEY` |
| **service_role** | `eyJ...` (outra chave longa) | `SUPABASE_SERVICE_ROLE_KEY` — **NUNCA cola no frontend** |
| **JWT Secret** | mesma tela, campo escondido `Reveal` | `SUPABASE_JWT_SECRET` |

Settings → Database:

- [ ] **Connection string → URI**. Copia. Substitui `[YOUR-PASSWORD]`
  pela senha do banco. Adiciona `?sslmode=require` no final se não
  estiver. Formato final:
  `postgresql://postgres:SUAsenha@db.xxxxx.supabase.co:5432/postgres?sslmode=require`
  → esse é o `DATABASE_URL`.

**Fim do Bloco 1.** Você tem 5 valores anotados:
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.

---

## Bloco 2 · Render — backend + crons (15 min)

Render lê o `render.yaml` do repo e provisiona 4 serviços: 1 web + 3
crons. Você só preenche as env vars marcadas `sync: false`.

### 2.1 Conectar repo

- [ ] Render dashboard → **New +** (canto superior direito) →
  **Blueprint**.
- [ ] "Connect a repository" → escolhe `imobai-create/niveologistica`.
  Se não aparecer: clica **Configure account**, autoriza acesso do
  Render ao repo.
- [ ] Branch: `main`. **Apply**.
- [ ] Aparece um sumário dos 4 serviços: `chamacarga-api` +
  `chamacarga-cron-sensor-mudo` + `chamacarga-cron-expirar-tokens` +
  `chamacarga-cron-lgpd`. Confirma.

### 2.2 Preencher env vars do `chamacarga-api`

Render pergunta uma a uma. Cola os valores do Bloco 1.4:

- [ ] `DATABASE_URL` = `postgresql://postgres:...?sslmode=require`
- [ ] `SUPABASE_JWT_SECRET` = valor do "JWT Secret"
- [ ] `SUPABASE_URL` = Project URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` = service_role
- [ ] `CORS_ORIGINS` = **por enquanto** `http://localhost:5173` (vai
  trocar no Bloco 3.4)
- [ ] `ANTHROPIC_API_KEY` = sua chave da Anthropic (opcional — sem
  ela, `/agente/responder` fica 500 mas o resto funciona)
- [ ] `SERVICE_TOKEN` = **deixa em branco** (só usa se for rodar o
  simulador de logger contra o backend real)
- [ ] `PUBLIC_BASE_URL` = **deixa em branco** (preenche após Vercel
  subir — Bloco 3.5)
- [ ] `WHATSAPP_*` e `SMS_*` = **deixa todos em branco** por enquanto
  (envio de link fica off — o 3PL copia URL do response e manda manual)

### 2.3 Preencher env vars dos 3 crons

Cada cron só precisa de `DATABASE_URL` — cola a mesma string do 2.2 em
cada um dos três.

### 2.4 Deploy

- [ ] **Create Resources**. Render clona o repo, roda `pip install`,
  sobe o uvicorn. Primeira vez: ~5 min. Aguarda todos aparecerem
  como **Live** (bolinha verde).
- [ ] Clica no nome do `chamacarga-api`. No topo tem a URL —
  algo tipo `https://chamacarga-api.onrender.com`. **Copia essa URL**.
- [ ] Teste rápido: cola `<URL>/health` no navegador → deve retornar
  `{"ok": true}`. Se der 500 ou nada carrega, vai em **Logs** — 90%
  das vezes é `DATABASE_URL` mal formatada ou faltando `sslmode=require`.

**Fim do Bloco 2.** Você tem `https://chamacarga-api.onrender.com`
(ou parecido). Anota.

---

## Bloco 3 · Vercel — frontend (10 min)

### 3.1 Importar projeto

- [ ] Vercel → **Add New...** → **Project** → importar
  `imobai-create/niveologistica`.
- [ ] Tela "Configure Project":
  - **Framework Preset:** Vite (detecta sozinho).
  - **Root Directory:** clica **Edit** e escolhe **`frontend`** —
    crítico, sem isso o build falha.
  - **Build & Output:** deixa no default (o `vercel.json` no
    `frontend/` cuida).

### 3.2 Environment Variables

Expande a seção. Adiciona 3:

- [ ] `VITE_API_URL` = URL do Render do Bloco 2.4 (sem `/` no final).
- [ ] `VITE_SUPABASE_URL` = Project URL do Supabase (Bloco 1.4).
- [ ] `VITE_SUPABASE_ANON_KEY` = anon/public do Supabase (Bloco 1.4).

Marca cada uma pra os 3 ambientes (**Production**, **Preview**, **Development**).

### 3.3 Deploy

- [ ] **Deploy**. ~1 min. No final aparece confete + URL — algo tipo
  `https://niveologistica.vercel.app` ou `https://chamacarga.vercel.app`.
- [ ] **Copia essa URL**. Abre — deve redirecionar pra `/login`
  (porque nenhum usuário existe ainda).

### 3.4 Trocar CORS no Render pra URL real

- [ ] Volta no Render → `chamacarga-api` → aba **Environment**.
- [ ] Edita `CORS_ORIGINS` → troca `http://localhost:5173` pela URL da
  Vercel (sem barra no final). Ex.: `https://chamacarga.vercel.app`.
- [ ] Se tiver domínio custom depois, separa por vírgula.
- [ ] **Save Changes** → Render redeploya sozinho em ~1 min.

### 3.5 Preencher `PUBLIC_BASE_URL`

- [ ] No mesmo painel Environment do Render, edita `PUBLIC_BASE_URL`
  → cola a URL da Vercel. Isso destrava as notificações
  WhatsApp/SMS quando você configurar depois.
- [ ] **Save Changes**.

---

## Bloco 4 · Primeiro usuário do 3PL (5 min)

Sem isso, ninguém consegue logar.

### 4.1 Criar cliente (empresa 3PL) no banco

Supabase → SQL Editor:

```sql
insert into clientes (razao_social, cnpj, segmento)
values ('3PH Medicamentos', '00.000.000/0001-00', 'farma')
returning id;
```

- [ ] Copia o `id` retornado (uuid).

### 4.2 Criar usuário Auth + vincular ao cliente

- [ ] Supabase → **Authentication** → **Users** → **Add user** →
  Create new user → email + senha (usa seu email real, você vai
  logar). Confirma.
- [ ] Copia o **UUID do usuário** que aparece na lista.
- [ ] Volta no SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('cliente_id', '<uuid do cliente>')
where id = '<uuid do usuário>';
```

Isso adiciona o claim `cliente_id` no JWT — sem ele, o backend
retorna 403 mesmo com login correto.

### 4.3 Testar

- [ ] Abre a URL da Vercel → cai em `/login`.
- [ ] Entra com o email + senha do 4.2.
- [ ] Deve carregar `/` (painel) com KPIs zerados e "Nenhuma entrega
  precisando de ação. Bom trabalho." — porque não tem entrega nenhuma
  vinculada a esse cliente ainda.

---

## Bloco 5 · Fumaça end-to-end (10 min)

Cria uma entrega inteira via API pra ver o painel popular.

- [ ] No Supabase → Auth → Users → seu usuário → **Send magic link**
  ou, mais simples, no seu navegador logado, abre DevTools (F12) →
  Console:
  ```js
  const { data } = await window.supabase.auth.getSession()
  copy(data.session.access_token)   // copia pro clipboard
  ```
- [ ] Se `window.supabase` não existe, vai em Authentication → sua
  linha → **JWT** → copia o access_token direto.

Com o token na mão, no terminal:

```bash
TOKEN=<cola aqui>
API=https://chamacarga-api.onrender.com

# 1. Cria pedido (usa o cliente_id do JWT automaticamente)
PEDIDO=$(curl -s -X POST $API/pedidos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "destinatario": {"nome":"Farmácia Popular","telefone":"5511999998888"},
    "ref_externa":"PED-0001",
    "faixa":"refrigerado_2_8","temp_min":2,"temp_max":8,
    "termolabil":true
  }' | jq -r .pedido_id)
echo $PEDIDO

# 2. Cria entrega
ENTREGA=$(curl -s -X POST $API/pedidos/$PEDIDO/entregas \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"logger_id":"CX-041","sensor_certificado_rbc":"12345","sensor_certificado_validade":"2027-03-31"}' \
  | jq -r .entrega_id)
echo $ENTREGA

# 3. Gera link do destinatário
curl -s -X POST "$API/entregas/$ENTREGA/tokens?tipo=r&dias=7" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Recarrega o painel na Vercel — deve aparecer 1 entrega em
  "Atenção agora" (por não ter motorista).
- [ ] Abre a URL do token retornado — `/r/xxxx-xxxx` — vê a tela do
  destinatário funcionando com dados reais.

---

## Bloco 6 · Opcional pós-piloto

Não precisa pro primeiro cliente rodar. Faz quando fizer sentido:

- [ ] **Domínio custom** `chamacarga.com.br` → registro.br (R$ 40/ano)
  → aponta CNAME `chamacarga.com.br` → `cname.vercel-dns.com`. Depois
  vai na Vercel → Domains → adiciona. Repete pro backend em Render.
- [ ] **Render plan Starter** ($7/mês) — tira cold start de 30s do
  free tier. Faz antes de demo com cliente.
- [ ] **WhatsApp Cloud API** — cadastro Meta Business + template
  `reserva_janela_pt_br` (2–4 semanas Meta aprovar). Cola
  `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE_NAME` no
  Render.
- [ ] **Zenvia SMS** — fallback rápido enquanto WhatsApp não sai.
  Cadastro Zenvia → API key → cola `SMS_PROVIDER=zenvia`,
  `SMS_API_KEY=<chave>` no Render.

---

## Troubleshooting

| Sintoma | Onde olhar |
|---|---|
| Render `chamacarga-api` fica "Build failed" | Render → aba **Logs**. Normalmente é `pip install` (dependência quebrada) ou `PYTHON_VERSION`. |
| `/health` retorna 500 ou timeout | Render → Logs. `DATABASE_URL` mal formatada ou faltando `sslmode=require`. |
| `/health` retorna 200 mas `/painel/entregas` retorna 403 | Falta `cliente_id` no `raw_app_meta_data` do usuário (Bloco 4.2). |
| Painel na Vercel: erro "sessão inválida" | Faz logout+login pra pegar JWT novo com o claim. |
| Vercel: build falha com "vite: not found" | Root Directory não tá em `frontend`. Refaz 3.1. |
| Painel abre em branco | DevTools → Console. Se for CORS, confere que `CORS_ORIGINS` no Render tem exatamente a URL da Vercel (sem barra). |
| Cron nunca dispara | Render → serviço do cron → **Events**. Confere que status é "Suspended: No" e o schedule tá certo em UTC. |

Se travar em algum passo específico, me chama que a gente ajusta em
tempo real.
