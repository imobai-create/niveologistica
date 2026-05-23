# Rastro API — backend MVP

FastAPI ligando o painel Rastro ao Postgres do Supabase. A lógica de excursão
térmica vive no banco (`avaliar_excursao()`); a API só orquestra.

## 1. Pré-requisitos no banco

1. Rode `rastro_schema.sql` no SQL Editor do Supabase.
2. Adicione a coluna de distância (usada no cálculo de CO₂ do dossiê):

```sql
alter table entregas add column if not exists distancia_km numeric;
```

## 2. Variáveis de ambiente (`.env`)

```
DATABASE_URL=postgresql://postgres:<senha>@db.<projeto>.supabase.co:5432/postgres
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6        # claude-haiku-4-5-20251001 p/ custo menor
```

> Use a connection string do Supabase (Settings → Database). Para serverless,
> prefira a porta 6543 (pooler).

## 3. Rodar

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export $(cat .env | xargs)        # ou use python-dotenv
uvicorn main:app --reload
```

Docs interativas em `http://localhost:8000/docs`.

## 4. Endpoints

| Método | Rota | Função |
|---|---|---|
| GET  | `/health` | ping + checa banco |
| POST | `/pedidos` | cria destinatário + pedido |
| POST | `/pedidos/{id}/entregas` | cria entrega (+ evento `criada`) |
| GET  | `/entregas` | lista (view de resumo) |
| GET  | `/entregas/{id}` | detalhe: entrega, eventos, leituras, POD, excursão |
| POST | `/entregas/{id}/eventos` | adiciona evento à custódia |
| POST | `/entregas/{id}/leituras` | ingestão idempotente do logger + `avaliar_excursao()` |
| POST | `/entregas/{id}/pod` | registra POD, marca entregue |
| GET  | `/entregas/{id}/dossie` | dossiê de conformidade + ESG |
| POST | `/agente/responder` | agente WhatsApp (chama a API da Anthropic; aplica REAGENDAR/ESCALAR) |

## 5. Ligar o front (RastroMVP.jsx)

No protótipo, troque o seed/`window.storage` por chamadas a estes endpoints:
`GET /entregas` na lista, `GET /entregas/{id}` no detalhe, e `POST /agente/responder`
no painel do agente (em vez da chamada direta à API dentro do artifact).

## 6. Antes de produção (não pular)

- **Autenticação**: protraja todos os endpoints (API key/JWT). Hoje estão abertos.
- **RLS**: ative as policies por cliente no Supabase (comentadas no schema).
- **CORS**: troque `allow_origins=["*"]` pelos domínios reais.
- **Validação/limites**: rate limit no `/agente/responder` (custo de API) e no upload de leituras.
- **LGPD**: defina retenção e mascaramento de dado pessoal em logs.
