# Chamacarga — MVP

Núcleo de custódia auditável para last-mile de carga sensível (farma 2–8 °C,
15–30 °C, etc.). Painel + API + banco + agente de WhatsApp.

```
.
├── backend/      FastAPI + asyncpg (API, ingestão de leituras, agente)
├── frontend/     Vite + React + Recharts (painel de custódia)
├── db/           Migrações SQL (Supabase / Postgres)
├── docs/         Roteiro de execução, prompt do agente, integração do logger
├── scripts/      Ferramentas de operação (simulador de logger BLE)
└── comercial/    Proposta, contrato, viabilidade, deck
```

## Como rodar o MVP localmente

### 1. Banco (Supabase ou Postgres local)

```sql
\i db/01_schema.sql
\i db/02_avaliar_excursao.sql
\i db/03_seed.sql           -- opcional: 1 cliente + 1 entrega de teste
```

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # preencha DATABASE_URL e ANTHROPIC_API_KEY
uvicorn main:app --reload
```

Docs em `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:8000
npm run dev
```

Abra `http://localhost:5173`. Se o backend não responder, o painel cai para
um seed de demonstração — útil para validar UI sem banco.

### 4. App do motorista (PWA)

Rota `/motorista` no mesmo frontend — abra `http://localhost:5173/motorista`
no celular (Android Chrome recomendado; usa câmera + GPS + assinatura no canvas
e posta em `POST /entregas/{id}/pod`). Adicionável à tela inicial via "Instalar app".

> **MVP:** foto e assinatura vão como data URL no campo `foto_url`/`assinatura_url`.
> Em produção, troque por upload no Supabase Storage e mande só a URL pública.
> Faltam ícones `public/icon-192.png` e `public/icon-512.png` — substitua os
> placeholders para que o PWA seja instalável de verdade no Android.

### 5. Simulador de logger BLE

Enquanto o hardware não chega, `scripts/simulador_logger.py` injeta leituras
no backend para validar custódia, alertas e dossiê. Sem dependências —
roda direto com Python 3.10+.

```bash
# lista entregas em aberto
python scripts/simulador_logger.py --listar --api http://localhost:8000

# backfill de 60 min de leituras dentro da faixa (rápido, ótimo para demo)
python scripts/simulador_logger.py --entrega <uuid> --modo backfill --minutos 60

# excursão térmica + GPS interpolado, em tempo real
python scripts/simulador_logger.py --entrega <uuid> --modo live \
    --intervalo 30 --cenario excursao --gps
```

Cenários: `normal`, `excursao` (rampa acima do `temp_max`), `porta-aberta`
(picos curtos) e `choque` (também emite evento `choque`). `--seed` deixa a
curva reprodutível.

## Publicar online (deploy)

Banco já está no Supabase. Frontend vai pra **Vercel** (free) e backend pra
**Render** (free). Configurações já estão no repo — você só conecta o GitHub
nos dois e clica deploy.

### Backend → Render

1. Em https://render.com → **New +** → **Blueprint**.
2. Conecte o repositório `niveologistica`. O Render lê o `render.yaml` da
   raiz e propõe o serviço `chamacarga-api`.
3. Preencha as env vars marcadas como `sync: false`:
   - `DATABASE_URL` — connection string do Supabase (com `?sslmode=require`).
   - `ANTHROPIC_API_KEY` — opcional, só se quiser o agente respondendo.
   - `CORS_ORIGINS` — depois que o frontend subir, cole aqui a URL da Vercel
     (ex.: `https://chamacarga.vercel.app`).
4. Clique **Apply**. URL final tipo `https://chamacarga-api.onrender.com`.

> Plano free dorme após 15 min ocioso e cold-start leva ~30 s. Para piloto
> com cliente, suba para **Starter** ($7/mês, sempre ligado).

### Frontend → Vercel

1. Em https://vercel.com → **Add New** → **Project** → importe o repositório.
2. Em **Root Directory**, escolha `frontend`. A Vercel detecta o Vite e o
   `vercel.json` cuida do resto (SPA rewrites + headers do PWA).
3. Em **Environment Variables**, defina:
   - `VITE_API_URL` = a URL do Render acima.
4. **Deploy**. URL tipo `https://chamacarga.vercel.app`. Volte no Render e
   adicione essa URL em `CORS_ORIGINS`.

Pronto: painel em `/`, PWA do motorista em `/motorista` — instalável no celular.

## Onde está cada coisa do plano

| Semana | Entregável | Arquivos |
|---|---|---|
| 1 | Banco | `db/*.sql` |
| 2 | Backend / API | `backend/main.py`, `backend/README.md` |
| 3 | Front ligado ao backend | `frontend/src/ChamacargaMVP.jsx`, `frontend/src/api.js` |
| 4 | Logger + WhatsApp | `docs/chamacarga_datalogger.md`, `docs/chamacarga_agente_whatsapp.md` |
| 5 | Hardening | `backend/main.py` (JWT+rate limit), `db/04_rls_policies.sql`, `render.yaml` |
| 6 | Piloto | `comercial/` |

## Hardening (Sprint 1) — o que mudou

Toda rota, exceto `/health`, agora exige `Authorization: Bearer <JWT>`.
O JWT precisa carregar o claim `cliente_id` (top-level ou em
`app_metadata`) — o backend rejeita com 403 se estiver ausente e filtra
todas as consultas por esse valor.

**Env vars novas obrigatórias no backend:**

- `SUPABASE_JWT_SECRET` — Supabase → Settings → API → JWT Secret.
- `CORS_ORIGINS` — não aceita mais `*`, tem que ser lista explícita.
- `SERVICE_TOKEN` (opcional) — se preenchido, requests com esse Bearer
  bypassam o filtro de `cliente_id` (uso interno: simulador, cron).

**Banco:** rodar `db/04_rls_policies.sql` no Supabase para habilitar RLS
em todas as tabelas de tenant (defesa em profundidade — o backend já
filtra, mas RLS pega qualquer outra conexão).

**Rate limit:** `/agente/responder` limitado a 5/min e 100/dia por IP
(slowapi). Ajuste em `backend/main.py` conforme o piloto.

**Fluxo de token pro front (Sprint 1 provisório):**
enquanto a UI de login não é feita (Sprint 2), cole um JWT válido em
`localStorage.chamacarga_token` no console do navegador. Como gerar um
em dev:

```sql
-- No Supabase Studio, crie um usuário via Auth e adicione o claim:
update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('cliente_id', '<uuid do cliente>')
where email = 'seu@email.com';
-- Depois faça login pelo Supabase Auth (ou use a API) e copie o access_token.
```

**Simulador:** exportar `CHAMACARGA_TOKEN=<SERVICE_TOKEN ou JWT>` antes
de rodar `scripts/simulador_logger.py`.

## Sprint 3 — o que mudou

Rotas públicas do destinatário (`/r/:token`) e do dossiê (`/d/:token`) ganham
banco e endpoints reais.

**Banco (`db/05_reservas_publicos.sql`, aplicar no Supabase):**

- `janelas_ofertadas` — o 3PL cadastra opções de janela por entrega.
- `reservas` — o destinatário confirma uma janela; único por
  `(entrega_id, janela_id)`.
- `tokens_publicos` — token opaco curto (`a7f3-b2c1`) com TTL, tipo
  `'r'` (reserva) ou `'d'` (dossiê).
- `eventos.hash_prev` + `eventos.hash_atual` — hash-chain SHA-256 via
  trigger `trg_eventos_hash_chain`. Cada evento novo referencia o hash
  do anterior da mesma entrega, tornando o log verificável ponta a ponta
  (requisito RDC 430/653). Backfill em cascata para eventos já existentes.

**Backend (`backend/main.py`):**

- `POST /entregas/{id}/janelas` — cadastra oferta de janela (autenticado).
- `POST /entregas/{id}/tokens?tipo=r|d&dias=7` — gera link público
  (autenticado); retorna `{"token": "...", "url": "/r/..."}`.
- `GET /r/{token}` — o que o destinatário vê (público).
- `POST /r/{token}/reservar` `{slot_id}` — confirma janela (público).
  Grava evento `reagendada` com autor `destinatario`, entra no
  hash-chain automaticamente.
- `GET /d/{token}` — dossiê público formato laudo (público). Traz o
  hash do último evento como prova de integridade.

## Próximos passos (Sprint 4+)

- [ ] WhatsApp Business Cloud API — o 3PL cria a entrega, backend gera
      token `r`, envia link ao destinatário. Cadastro Meta Business é o
      gargalo (2–4 semanas de aprovação).
- [ ] SMS fallback (Zenvia/Twilio) pra quando o WhatsApp travar.
- [ ] Upload POD (foto + assinatura) pro Supabase Storage.
- [ ] UI de login no frontend (Supabase Auth SDK) — remove o "cole
      token no localStorage".
- [ ] Cron de expiração de reservas + detecção de sensor mudo.
- [ ] Retenção / mascaramento LGPD dos campos pessoais em
      `destinatarios` (job mensal + máscara em `endereco_raw`/`documento`).
- [ ] Metadado `sensor_certificado_rbc` + validade em
      `leituras_temperatura` (ISO 17025).
