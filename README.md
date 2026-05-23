# Rastro — MVP

Núcleo de custódia auditável para last-mile de carga sensível (farma 2–8 °C,
15–30 °C, etc.). Painel + API + banco + agente de WhatsApp.

```
.
├── backend/      FastAPI + asyncpg (API, ingestão de leituras, agente)
├── frontend/     Vite + React + Recharts (painel de custódia)
├── db/           Migrações SQL (Supabase / Postgres)
├── docs/         Roteiro de execução, prompt do agente, integração do logger
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
