# Rastro — MVP

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
   raiz e propõe o serviço `rastro-api`.
3. Preencha as env vars marcadas como `sync: false`:
   - `DATABASE_URL` — connection string do Supabase (com `?sslmode=require`).
   - `ANTHROPIC_API_KEY` — opcional, só se quiser o agente respondendo.
   - `CORS_ORIGINS` — depois que o frontend subir, cole aqui a URL da Vercel
     (ex.: `https://rastro.vercel.app`).
4. Clique **Apply**. URL final tipo `https://rastro-api.onrender.com`.

> Plano free dorme após 15 min ocioso e cold-start leva ~30 s. Para piloto
> com cliente, suba para **Starter** ($7/mês, sempre ligado).

### Frontend → Vercel

1. Em https://vercel.com → **Add New** → **Project** → importe o repositório.
2. Em **Root Directory**, escolha `frontend`. A Vercel detecta o Vite e o
   `vercel.json` cuida do resto (SPA rewrites + headers do PWA).
3. Em **Environment Variables**, defina:
   - `VITE_API_URL` = a URL do Render acima.
4. **Deploy**. URL tipo `https://rastro.vercel.app`. Volte no Render e
   adicione essa URL em `CORS_ORIGINS`.

Pronto: painel em `/`, PWA do motorista em `/motorista` — instalável no celular.

## Onde está cada coisa do plano

| Semana | Entregável | Arquivos |
|---|---|---|
| 1 | Banco | `db/*.sql` |
| 2 | Backend / API | `backend/main.py`, `backend/README.md` |
| 3 | Front ligado ao backend | `frontend/src/RastroMVP.jsx`, `frontend/src/api.js` |
| 4 | Logger + WhatsApp | `docs/rastro_datalogger.md`, `docs/rastro_agente_whatsapp.md` |
| 5 | Hardening | (próximo: auth, RLS, rate limit — ver `docs/Rastro_Roteiro_Execucao.md`) |
| 6 | Piloto | `comercial/` |

## Próximos passos (Semana 5 — hardening)

- [ ] Autenticação nos endpoints (JWT/API key).
- [ ] Travar `CORS_ORIGINS` no `.env` para o domínio real.
- [ ] Rate limit no `/agente/responder` (custo Anthropic).
- [ ] Ativar e testar policies de RLS por `cliente_id` no Supabase.
- [ ] Retenção / mascaramento LGPD dos campos pessoais em `destinatarios`.
