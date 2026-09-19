"""
CHAMACARGA API — backend MVP (FastAPI + Postgres/Supabase)
Liga o painel ao schema: ingestão de leituras, criação de entrega, custódia,
POD, dossiê e o agente de WhatsApp (chamada real à API da Anthropic).

Reaproveita a função SQL avaliar_excursao() — a lógica de excursão vive no banco.

Auth: Bearer JWT (Supabase, HS256). Toda rota exige o claim `cliente_id`.
Um SERVICE_TOKEN opcional (env) libera acesso irrestrito para o simulador
de logger e jobs internos.

Env:  DATABASE_URL, SUPABASE_JWT_SECRET, CORS_ORIGINS
      ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opcional)
      SERVICE_TOKEN (opcional; se setado, bypassa filtro por cliente_id)
Rodar: uvicorn main:app --reload
"""
import hashlib, os, json, re, secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import asyncpg, httpx, jwt
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

DATABASE_URL         = os.environ["DATABASE_URL"]
SUPABASE_JWT_SECRET  = os.environ["SUPABASE_JWT_SECRET"]
ANTHROPIC_API_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL      = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
SERVICE_TOKEN        = os.environ.get("SERVICE_TOKEN", "")
CO2_KG_POR_KM        = 0.25  # emissão evitada vs. van diesel

_cors_raw = os.environ.get("CORS_ORIGINS", "").strip()
if not _cors_raw or _cors_raw == "*":
    raise RuntimeError(
        "CORS_ORIGINS obrigatório (lista de domínios separada por vírgula). "
        "'*' é rejeitado — combinar com JWT Bearer não é seguro."
    )
CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]

pool: Optional[asyncpg.Pool] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    yield
    await pool.close()


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Chamacarga API", version="0.2", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ------------------------------ auth ----------------------------------
bearer = HTTPBearer(auto_error=True)


def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """Valida JWT do Supabase (HS256) e extrai cliente_id.
    Aceita SERVICE_TOKEN opcional (env) como bypass para uso interno."""
    token = cred.credentials
    if SERVICE_TOKEN and token == SERVICE_TOKEN:
        return {"sub": "service", "cliente_id": None, "role": "service"}
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"token inválido: {e}")
    # cliente_id pode vir como claim top-level ou dentro de app_metadata
    cliente_id = payload.get("cliente_id") or (payload.get("app_metadata") or {}).get("cliente_id")
    if not cliente_id:
        raise HTTPException(403, "token sem claim cliente_id")
    return {
        "sub": payload["sub"],
        "cliente_id": str(cliente_id),
        "role": payload.get("role", "authenticated"),
    }


async def ensure_owns_entrega(conn, user: dict, entrega_id: str) -> None:
    """Confirma que a entrega pertence ao cliente do usuário. Service bypassa."""
    if user["role"] == "service":
        return
    row = await conn.fetchrow(
        """select 1 from entregas e
           join pedidos p on p.id = e.pedido_id
           where e.id = $1 and p.cliente_id = $2""",
        entrega_id, user["cliente_id"],
    )
    if not row:
        raise HTTPException(404, "entrega não encontrada")


async def ensure_owns_pedido(conn, user: dict, pedido_id: str) -> None:
    if user["role"] == "service":
        return
    row = await conn.fetchrow(
        "select 1 from pedidos where id = $1 and cliente_id = $2",
        pedido_id, user["cliente_id"],
    )
    if not row:
        raise HTTPException(404, "pedido não encontrado")


# ----------------------------- helpers --------------------------------
def jsonable(rec) -> dict:
    out = {}
    for k, v in dict(rec).items():
        out[k] = str(v) if hasattr(v, "hex") else (v.isoformat() if isinstance(v, datetime) else v)
    return out


def compute_excursao(leituras: List[dict], tmin, tmax, tol_min: int = 10) -> dict:
    """Espelha avaliar_excursao() para leitura/relatório (o banco é a verdade)."""
    if tmin is None or tmax is None:
        return {"excursao": False, "min_fora": 0, "pico": 0.0}
    fora = [r for r in leituras if r["temp_c"] < float(tmin) or r["temp_c"] > float(tmax)]
    seg, pico, prev = 0, 0.0, None
    for r in fora:
        t = r["lido_em"]
        if prev:
            seg += (t - prev).total_seconds()
        prev = t
        pico = max(pico, max(float(tmin) - r["temp_c"], r["temp_c"] - float(tmax)))
    return {"excursao": seg >= tol_min * 60, "min_fora": round(seg / 60), "pico": round(pico, 1)}


def proximos_slots(n_dias: int = 1) -> List[dict]:
    """Slots padrão de reagendamento (amanhã 8–12 e 14–18, fuso -03:00)."""
    tz = timezone(timedelta(hours=-3))
    base = (datetime.now(tz) + timedelta(days=n_dias)).replace(second=0, microsecond=0)
    d = base.date()
    mk = lambda h: datetime(d.year, d.month, d.day, h, 0, tzinfo=tz)
    return [
        {"inicio": mk(8).isoformat(),  "fim": mk(12).isoformat()},
        {"inicio": mk(14).isoformat(), "fim": mk(18).isoformat()},
    ]


# ----------------------------- modelos --------------------------------
class DestinatarioIn(BaseModel):
    nome: str
    telefone: Optional[str] = None
    documento: Optional[str] = None
    endereco_raw: Optional[str] = None
    cep: Optional[str] = None


class PedidoIn(BaseModel):
    destinatario: DestinatarioIn
    ref_externa: Optional[str] = None
    valor_declarado: Optional[float] = None
    termolabil: bool = False
    faixa: str = "ambiente"
    temp_min: Optional[float] = None
    temp_max: Optional[float] = None
    janela_inicio: Optional[datetime] = None
    janela_fim: Optional[datetime] = None


class EntregaIn(BaseModel):
    motorista_id: Optional[str] = None
    veiculo_id: Optional[str] = None
    logger_id: Optional[str] = None
    distancia_km: Optional[float] = None


class EventoIn(BaseModel):
    tipo: str
    autor: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    detalhe: dict = {}


class LeituraIn(BaseModel):
    lido_em: datetime
    temp_c: float
    umidade: Optional[float] = None


class LeiturasBatch(BaseModel):
    logger_id: Optional[str] = None
    leituras: List[LeituraIn]


class PodIn(BaseModel):
    recebedor_nome: str
    recebedor_doc: Optional[str] = None
    foto_url: Optional[str] = None
    assinatura_url: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class Mensagem(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class AgenteIn(BaseModel):
    entrega_id: str
    mensagens: List[Mensagem]


# ----------------------------- rotas ----------------------------------
@app.get("/health")
async def health():
    """Público — precisa responder pra healthcheck do Render/Vercel."""
    async with pool.acquire() as c:
        await c.fetchval("select 1")
    return {"ok": True}


@app.post("/pedidos", status_code=201)
async def criar_pedido(p: PedidoIn, user: dict = Depends(current_user)):
    if user["role"] == "service":
        raise HTTPException(403, "criação de pedido exige JWT de cliente autenticado")
    async with pool.acquire() as c, c.transaction():
        dest_id = await c.fetchval(
            """insert into destinatarios (cliente_id, nome, telefone, documento, endereco_raw, cep)
               values ($1,$2,$3,$4,$5,$6) returning id""",
            user["cliente_id"], p.destinatario.nome, p.destinatario.telefone,
            p.destinatario.documento, p.destinatario.endereco_raw, p.destinatario.cep,
        )
        ped_id = await c.fetchval(
            """insert into pedidos (cliente_id, destinatario_id, ref_externa, valor_declarado,
                                    termolabil, faixa, temp_min, temp_max, janela_inicio, janela_fim)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id""",
            user["cliente_id"], dest_id, p.ref_externa, p.valor_declarado, p.termolabil,
            p.faixa, p.temp_min, p.temp_max, p.janela_inicio, p.janela_fim,
        )
    return {"pedido_id": str(ped_id), "destinatario_id": str(dest_id)}


@app.post("/pedidos/{pedido_id}/entregas", status_code=201)
async def criar_entrega(pedido_id: str, e: EntregaIn, user: dict = Depends(current_user)):
    async with pool.acquire() as c, c.transaction():
        await ensure_owns_pedido(c, user, pedido_id)
        ent_id = await c.fetchval(
            """insert into entregas (pedido_id, motorista_id, veiculo_id, logger_id, distancia_km)
               values ($1,$2,$3,$4,$5) returning id""",
            pedido_id, e.motorista_id, e.veiculo_id, e.logger_id, e.distancia_km,
        )
        await c.execute(
            "insert into eventos (entrega_id, tipo, autor) values ($1,'criada','sistema')", ent_id,
        )
    return {"entrega_id": str(ent_id)}


@app.get("/entregas")
async def listar_entregas(user: dict = Depends(current_user)):
    async with pool.acquire() as c:
        if user["role"] == "service":
            rows = await c.fetch(
                "select * from vw_entrega_resumo order by coletada_em desc nulls last")
        else:
            rows = await c.fetch(
                """select r.* from vw_entrega_resumo r
                   join entregas e on e.id = r.entrega_id
                   join pedidos p on p.id = e.pedido_id
                   where p.cliente_id = $1
                   order by r.coletada_em desc nulls last""",
                user["cliente_id"])
    return [jsonable(r) for r in rows]


@app.get("/painel/entregas")
async def listar_painel(user: dict = Depends(current_user)):
    """Lista enriquecida para o front: campos do painel + flag de excursão."""
    where_cli = "" if user["role"] == "service" else "where p.cliente_id = $1"
    params = [] if user["role"] == "service" else [user["cliente_id"]]
    async with pool.acquire() as c:
        rows = await c.fetch(
            f"""
            select e.id, e.status, e.tentativas, e.coletada_em, e.entregue_em,
                   e.sla_cumprido, e.logger_id, e.distancia_km,
                   p.ref_externa, p.faixa, p.temp_min, p.temp_max, p.termolabil,
                   p.valor_declarado, p.janela_inicio, p.janela_fim,
                   cli.razao_social as cliente,
                   d.nome as destinatario,
                   coalesce(d.endereco_norm, d.endereco_raw) as endereco,
                   mo.nome as motorista,
                   ve.modelo || ' (' || coalesce(ve.placa, '') || ')' as veiculo,
                   exists (
                     select 1 from eventos ev
                     where ev.entrega_id = e.id and ev.tipo = 'excursao_termica'
                   ) as houve_excursao
            from entregas e
            join pedidos p on p.id = e.pedido_id
            join clientes cli on cli.id = p.cliente_id
            join destinatarios d on d.id = p.destinatario_id
            left join motoristas mo on mo.id = e.motorista_id
            left join veiculos ve on ve.id = e.veiculo_id
            {where_cli}
            order by e.criado_em desc
            """, *params)
    return [jsonable(r) for r in rows]


@app.get("/entregas/{entrega_id}")
async def detalhe_entrega(entrega_id: str, user: dict = Depends(current_user)):
    async with pool.acquire() as c:
        await ensure_owns_entrega(c, user, entrega_id)
        ent = await c.fetchrow(
            """select e.*, p.faixa, p.temp_min, p.temp_max, p.ref_externa, p.valor_declarado,
                      p.janela_inicio, p.janela_fim, cli.razao_social as cliente, d.nome as destinatario
               from entregas e
               join pedidos p on p.id = e.pedido_id
               join clientes cli on cli.id = p.cliente_id
               join destinatarios d on d.id = p.destinatario_id
               where e.id = $1""", entrega_id)
        if not ent:
            raise HTTPException(404, "entrega não encontrada")
        eventos = await c.fetch("select * from eventos where entrega_id=$1 order by ocorrido_em", entrega_id)
        leituras = await c.fetch("select lido_em, temp_c, umidade from leituras_temperatura where entrega_id=$1 order by lido_em", entrega_id)
        pod = await c.fetchrow("select * from pods where entrega_id=$1 order by registrado_em desc limit 1", entrega_id)

    lt = [{"lido_em": r["lido_em"], "temp_c": float(r["temp_c"]), "umidade": r["umidade"]} for r in leituras]
    exc = compute_excursao(lt, ent["temp_min"], ent["temp_max"])
    return {
        "entrega": jsonable(ent),
        "eventos": [jsonable(r) for r in eventos],
        "leituras": [jsonable(r) for r in leituras],
        "pod": jsonable(pod) if pod else None,
        "excursao": exc,
    }


@app.post("/entregas/{entrega_id}/eventos", status_code=201)
async def add_evento(entrega_id: str, ev: EventoIn, user: dict = Depends(current_user)):
    async with pool.acquire() as c:
        await ensure_owns_entrega(c, user, entrega_id)
        ev_id = await c.fetchval(
            """insert into eventos (entrega_id, tipo, autor, lat, lng, detalhe)
               values ($1,$2,$3,$4,$5,$6) returning id""",
            entrega_id, ev.tipo, ev.autor, ev.lat, ev.lng, json.dumps(ev.detalhe),
        )
    return {"evento_id": str(ev_id)}


@app.post("/entregas/{entrega_id}/leituras", status_code=201)
async def ingerir_leituras(entrega_id: str, body: LeiturasBatch, user: dict = Depends(current_user)):
    """Upsert idempotente do lote do data logger + avaliação de excursão no banco."""
    if not body.leituras:
        raise HTTPException(400, "lote vazio")
    rows = [(entrega_id, l.lido_em, l.temp_c, l.umidade, body.logger_id) for l in body.leituras]
    async with pool.acquire() as c, c.transaction():
        await ensure_owns_entrega(c, user, entrega_id)
        await c.executemany(
            """insert into leituras_temperatura (entrega_id, lido_em, temp_c, umidade, logger_id)
               values ($1,$2,$3,$4,$5) on conflict (entrega_id, lido_em) do nothing""", rows)
        await c.execute("select avaliar_excursao($1)", entrega_id)  # função do schema
        resumo = await c.fetchrow("select houve_excursao from vw_entrega_resumo where entrega_id=$1", entrega_id)
    return {"recebidas": len(rows), "houve_excursao": bool(resumo and resumo["houve_excursao"])}


@app.post("/entregas/{entrega_id}/pod", status_code=201)
async def registrar_pod(entrega_id: str, pod: PodIn, user: dict = Depends(current_user)):
    async with pool.acquire() as c, c.transaction():
        await ensure_owns_entrega(c, user, entrega_id)
        pod_id = await c.fetchval(
            """insert into pods (entrega_id, foto_url, assinatura_url, recebedor_nome, recebedor_doc, lat, lng)
               values ($1,$2,$3,$4,$5,$6,$7) returning id""",
            entrega_id, pod.foto_url, pod.assinatura_url, pod.recebedor_nome, pod.recebedor_doc, pod.lat, pod.lng)
        await c.execute(
            "update entregas set status='entregue', entregue_em=now() where id=$1", entrega_id)
        await c.execute(
            """insert into eventos (entrega_id, tipo, autor, lat, lng)
               values ($1,'entregue','motorista',$2,$3)""", entrega_id, pod.lat, pod.lng)
    return {"pod_id": str(pod_id)}


@app.get("/entregas/{entrega_id}/dossie")
async def gerar_dossie(entrega_id: str, user: dict = Depends(current_user)):
    det = await detalhe_entrega(entrega_id, user)
    ent, exc = det["entrega"], det["excursao"]
    km = ent.get("distancia_km")
    co2 = round(float(km) * CO2_KG_POR_KM, 1) if km else None
    return {
        "pedido": ent.get("ref_externa"),
        "cliente": ent.get("cliente"),
        "faixa": ent.get("faixa"),
        "sla_cumprido": ent.get("sla_cumprido"),
        "integridade_termica": (
            f"Excursão: {exc['min_fora']} min fora da faixa, pico {exc['pico']}°C"
            if exc["excursao"] else "Sem excursão"),
        "eventos_registrados": len(det["eventos"]),
        "pod": "Anexado" if det["pod"] else "Pendente",
        "co2_evitado_kg": co2,
        "parecer": (
            "Houve desvio térmico documentado; recomenda-se análise de impacto antes da liberação do lote."
            if exc["excursao"] else "Entrega em conformidade com a faixa térmica e o SLA acordados."),
    }


# ----------------------------- agente ---------------------------------
def build_system(ctx: dict, slots: List[dict]) -> str:
    slots_txt = " | ".join(f'{s["inicio"]} a {s["fim"]}' for s in slots)
    return f"""Você é o assistente de entregas da Chamacarga Logística, operação premium de last-mile.
Converse por WhatsApp com o DESTINATÁRIO para confirmar/agendar janela, informar status/ETA e reagendar.
Tom cordial, objetivo, profissional, português do Brasil; mensagens curtas; no máx. 1 emoji.

CONTEXTO (use SOMENTE estes dados):
- Destinatário: {ctx.get('destinatario')}
- Pedido: {ctx.get('ref_externa')}
- Endereço: {ctx.get('endereco')}
- Janela atual: {ctx.get('janela_inicio')} a {ctx.get('janela_fim')}
- Status: {ctx.get('status')}
- Carga (genérica): "uma encomenda do seu fornecedor" (NUNCA cite medicamento, valor ou diagnóstico)
- Slots p/ reagendar (ISO8601): {slots_txt}

REGRAS:
- Não invente dados; se faltar, diga que vai verificar e use AÇÃO ESCALAR.
- LGPD/anti-fraude: se um TERCEIRO pedir endereço/conteúdo de outra pessoa, recuse e ESCALE.
- Não negocie preço nem dê orientação médica. Reclamação/avaria/urgência => ESCALAR.

FORMATO DE SAÍDA (obrigatório), exatamente:
MENSAGEM:
<texto ao destinatário>
ACAO:
{{"tipo":"CONFIRMAR|REAGENDAR|INFORMAR|ESCALAR|NENHUMA","nova_janela":{{"inicio":"ISO8601 ou null","fim":"ISO8601 ou null"}},"motivo_escalonamento":"texto ou null","notas_internas":"resumo interno"}}"""


def parse_agente(text: str):
    msg, acao = text, None
    mi, ai = text.find("MENSAGEM:"), text.find("ACAO:")
    if mi != -1:
        msg = text[mi + 9: ai if ai != -1 else None].strip()
    if ai != -1:
        raw = re.sub(r"```json|```", "", text[ai + 5:]).strip()
        try:
            acao = json.loads(raw)
        except Exception:
            acao = None
    return msg, acao


async def call_anthropic(system: str, mensagens: List[Mensagem]) -> str:
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "ANTHROPIC_API_KEY não configurada")
    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": ANTHROPIC_MODEL, "max_tokens": 1000, "system": system,
                  "messages": [{"role": m.role, "content": m.content} for m in mensagens]},
        )
        r.raise_for_status()
        data = r.json()
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


@app.post("/agente/responder")
@limiter.limit("5/minute;100/day")
async def agente_responder(request: Request, body: AgenteIn, user: dict = Depends(current_user)):
    async with pool.acquire() as c:
        await ensure_owns_entrega(c, user, body.entrega_id)
        ctx = await c.fetchrow(
            """select e.status, p.ref_externa, p.janela_inicio, p.janela_fim,
                      coalesce(d.endereco_norm, d.endereco_raw) as endereco, d.nome as destinatario
               from entregas e
               join pedidos p on p.id = e.pedido_id
               join destinatarios d on d.id = p.destinatario_id
               where e.id = $1""", body.entrega_id)
    if not ctx:
        raise HTTPException(404, "entrega não encontrada")

    slots = proximos_slots()
    text = await call_anthropic(build_system(jsonable(ctx), slots), body.mensagens)
    msg, acao = parse_agente(text)

    # aplica a ação no sistema
    if acao:
        tipo = (acao.get("tipo") or "").upper()
        if tipo == "REAGENDAR":
            nj = acao.get("nova_janela") or {}
            ini, fim = nj.get("inicio"), nj.get("fim")
            if ini and fim and ini != "null":
                async with pool.acquire() as c, c.transaction():
                    await c.execute(
                        """update pedidos set janela_inicio=$1, janela_fim=$2
                           where id=(select pedido_id from entregas where id=$3)""",
                        datetime.fromisoformat(ini), datetime.fromisoformat(fim), body.entrega_id)
                    await c.execute(
                        """insert into eventos (entrega_id, tipo, autor, detalhe)
                           values ($1,'reagendada','agente_whatsapp',$2)""",
                        body.entrega_id, json.dumps({"nova_janela": nj}))
        elif tipo == "ESCALAR":
            async with pool.acquire() as c:
                await c.execute(
                    """insert into alertas (entrega_id, tipo, severidade, mensagem)
                       values ($1,'escalonamento','media',$2)""",
                    body.entrega_id, acao.get("motivo_escalonamento") or "Escalonamento solicitado pelo agente")
    return {"mensagem": msg, "acao": acao}


# =====================================================================
# ROTAS PÚBLICAS — sem JWT (Sprint 3)
# Token opaco na URL faz autenticação: o 3PL gera o link, manda por
# WhatsApp/SMS, destinatário/embarcador abre. Anônimo mas rastreado.
# =====================================================================

def _gerar_token_curto() -> str:
    """4 letras + '-' + 4 letras minúsculas. Ex.: 'a7f3-b2c1'."""
    raw = secrets.token_urlsafe(6).replace("_", "a").replace("-", "b").lower()
    return raw[:4] + "-" + raw[4:8]


def _nota_slot(inicio_dt: datetime) -> str:
    h = inicio_dt.hour
    if h < 9:  return "manhã cedo · antes de abrir a farmácia"
    if h < 12: return "meio da manhã · pico do movimento"
    if h < 15: return "início da tarde · almoço acabou"
    if h < 18: return "tarde · pouca disponibilidade"
    return "final de tarde"


async def resolver_token(conn, token: str, tipo: str) -> str:
    row = await conn.fetchrow(
        """select entrega_id from tokens_publicos
           where token=$1 and tipo=$2 and expira_em > now()""",
        token, tipo,
    )
    if not row:
        raise HTTPException(404, "link expirado ou inválido")
    return str(row["entrega_id"])


class JanelaIn(BaseModel):
    inicio: datetime
    fim: datetime
    capacidade: int = 1


class ReservaIn(BaseModel):
    slot_id: str


@app.post("/entregas/{entrega_id}/janelas", status_code=201)
async def criar_janela(entrega_id: str, body: JanelaIn, user: dict = Depends(current_user)):
    """3PL cadastra uma opção de janela que o destinatário poderá escolher."""
    if body.fim <= body.inicio:
        raise HTTPException(400, "fim deve ser posterior a inicio")
    async with pool.acquire() as c:
        await ensure_owns_entrega(c, user, entrega_id)
        jid = await c.fetchval(
            """insert into janelas_ofertadas (entrega_id, inicio, fim, capacidade)
               values ($1,$2,$3,$4) returning id""",
            entrega_id, body.inicio, body.fim, body.capacidade,
        )
    return {"janela_id": str(jid)}


@app.post("/entregas/{entrega_id}/tokens", status_code=201)
async def gerar_token_publico(
    entrega_id: str,
    tipo: str,
    dias: int = 7,
    user: dict = Depends(current_user),
):
    """Gera link público /r/:token (reserva) ou /d/:token (dossiê)."""
    if tipo not in ("r", "d"):
        raise HTTPException(400, "tipo deve ser 'r' ou 'd'")
    async with pool.acquire() as c:
        await ensure_owns_entrega(c, user, entrega_id)
        # tenta 3 vezes se colidir (colisão em 8 chars é ~1 em 10^7)
        for _ in range(3):
            token_str = _gerar_token_curto()
            try:
                await c.execute(
                    """insert into tokens_publicos (token, entrega_id, tipo, expira_em)
                       values ($1,$2,$3, now() + make_interval(days => $4))""",
                    token_str, entrega_id, tipo, dias,
                )
                break
            except asyncpg.UniqueViolationError:
                continue
        else:
            raise HTTPException(500, "não foi possível gerar token único")
    return {"token": token_str, "tipo": tipo, "url": f"/{tipo}/{token_str}"}


@app.get("/r/{token}")
async def receber_info_publico(token: str):
    """Tela do destinatário — mostra transportador e slots. Sem JWT."""
    async with pool.acquire() as c:
        ent_id = await resolver_token(c, token, "r")
        ctx = await c.fetchrow(
            """select cli.razao_social as embarcador,
                      p.temp_min, p.temp_max, p.janela_inicio, p.janela_fim,
                      e.status, mo.nome as motorista_nome
               from entregas e
               join pedidos p on p.id = e.pedido_id
               join clientes cli on cli.id = p.cliente_id
               left join motoristas mo on mo.id = e.motorista_id
               where e.id = $1""", ent_id)
        janelas = await c.fetch(
            """select j.id, j.inicio, j.fim, j.capacidade,
                      (j.capacidade
                       - coalesce((select count(*) from reservas r where r.janela_id = j.id), 0)
                      )::int as vagas_livres
               from janelas_ofertadas j
               where j.entrega_id = $1 and j.fim > now()
               order by j.inicio""", ent_id)
    if not ctx:
        raise HTTPException(404, "entrega não encontrada")

    motorista_nome = ctx["motorista_nome"] or "A definir"
    iniciais = "".join(p[:1] for p in motorista_nome.split()[:2]).upper() or "?"

    faixa_txt = (f"encomenda refrigerada ({ctx['temp_min']}–{ctx['temp_max']} °C)"
                 if ctx["temp_min"] is not None else "encomenda")
    data_txt = (ctx["janela_inicio"].strftime("%d/%m") if ctx["janela_inicio"] else "próximos dias")

    return {
        "entrega": {
            "cliente": ctx["embarcador"],
            "cargo": faixa_txt,
            "data_prevista": data_txt,
            "reservado_ate": "24 h",
            "transportador": {
                "iniciais": iniciais,
                "nome": motorista_nome,
                "empresa": "3PH Medicamentos",  # TODO: puxar de clientes/3PL
                "rating": 4.9,                  # TODO: sistema de rating futuro
                "entregas": 312,                # TODO: histórico do motorista
                "rbc_valido": True,             # TODO: campo em motoristas
            },
        },
        "slots": [
            {
                "id": str(j["id"]),
                "inicio": j["inicio"].astimezone().strftime("%H:%M"),
                "fim":    j["fim"].astimezone().strftime("%H:%M"),
                "vagas_livres": max(0, j["vagas_livres"]),
                "nota": _nota_slot(j["inicio"].astimezone()),
            } for j in janelas
        ],
    }


@app.post("/r/{token}/reservar", status_code=201)
async def reservar_janela_publico(token: str, body: ReservaIn, request: Request):
    """Destinatário confirma janela. Anônimo — token é o auth."""
    ip = request.client.host if request.client else "?"
    ip_h = hashlib.sha256(ip.encode()).hexdigest()[:16]
    async with pool.acquire() as c, c.transaction():
        ent_id = await resolver_token(c, token, "r")
        janela = await c.fetchrow(
            """select id, capacidade from janelas_ofertadas
               where id = $1 and entrega_id = $2""",
            body.slot_id, ent_id,
        )
        if not janela:
            raise HTTPException(404, "janela indisponível")
        usadas = await c.fetchval(
            "select count(*) from reservas where janela_id = $1", janela["id"],
        )
        if usadas >= janela["capacidade"]:
            raise HTTPException(409, "janela sem vagas")
        try:
            r_id = await c.fetchval(
                """insert into reservas (entrega_id, janela_id, expira_em, ip_hash)
                   values ($1, $2, now() + interval '30 days', $3) returning id""",
                ent_id, janela["id"], ip_h,
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "esta janela já foi reservada para a entrega")
        await c.execute(
            "update tokens_publicos set usado_em = now() where token = $1 and tipo = 'r'",
            token,
        )
        # Evento auditável (entra no hash-chain automaticamente pelo trigger)
        await c.execute(
            """insert into eventos (entrega_id, tipo, autor, detalhe)
               values ($1, 'reagendada', 'destinatario', $2)""",
            ent_id,
            json.dumps({"reserva_id": str(r_id), "slot_id": body.slot_id, "ip_hash": ip_h}),
        )
    return {"reserva_id": str(r_id)}


def _hhmm(dt) -> str:
    return dt.astimezone().strftime("%H:%M") if dt else "—"


def _fmt_data(dt) -> str:
    return dt.astimezone().strftime("%d/%m · %H:%M") if dt else "—"


def _dur(a, b) -> str:
    if not a or not b: return "—"
    delta = b - a
    h = int(delta.total_seconds() // 3600)
    m = int((delta.total_seconds() % 3600) // 60)
    return f"{h} h {m:02d} min"


def _evento_tone(ev: dict) -> Optional[str]:
    t = ev.get("tipo")
    if t in ("excursao_termica", "avaria", "falha"): return "crit"
    if t == "entregue": return "ok"
    return None


def _evento_txt(ev: dict) -> str:
    mapa = {
        "criada": "Pedido criado",
        "coletada": "Coleta confirmada",
        "saiu_para_entrega": "Saiu para entrega",
        "tentativa": "Tentativa de entrega",
        "entregue": "Entrega concluída · POD assinado",
        "falha": "Falha na entrega",
        "reagendada": "Janela reagendada",
        "avaria": "Avaria registrada",
        "excursao_termica": "Excursão térmica registrada",
        "observacao": ev.get("detalhe", {}).get("nota") or "Observação registrada",
    }
    return mapa.get(ev.get("tipo"), ev.get("tipo", "Evento"))


@app.get("/d/{token}")
async def dossie_publico(token: str):
    """Dossiê ANVISA-ready público. Formato de laudo para o embarcador."""
    async with pool.acquire() as c:
        ent_id = await resolver_token(c, token, "d")
        ent = await c.fetchrow(
            """select e.*, p.faixa, p.temp_min, p.temp_max, p.ref_externa,
                      cli.razao_social as cliente
               from entregas e
               join pedidos p on p.id = e.pedido_id
               join clientes cli on cli.id = p.cliente_id
               where e.id = $1""", ent_id)
        if not ent:
            raise HTTPException(404, "entrega não encontrada")
        eventos = await c.fetch(
            "select * from eventos where entrega_id=$1 order by ocorrido_em, id", ent_id,
        )
        leituras = await c.fetch(
            "select lido_em, temp_c from leituras_temperatura where entrega_id=$1 order by lido_em",
            ent_id,
        )
        pod = await c.fetchrow(
            "select recebedor_nome from pods where entrega_id=$1 order by registrado_em desc limit 1",
            ent_id,
        )
        last = await c.fetchrow(
            """select hash_atual from eventos where entrega_id=$1
               order by ocorrido_em desc, id desc limit 1""", ent_id,
        )

    lt = [{"lido_em": r["lido_em"], "temp_c": float(r["temp_c"])} for r in leituras]
    exc = compute_excursao(lt, ent["temp_min"], ent["temp_max"])
    conforme = not exc["excursao"]

    hash_curto = "—"
    if last and last["hash_atual"]:
        h = last["hash_atual"]
        hash_curto = f"{h[:4]}…{h[-4:]}"

    return {
        "id_curto": (ent["ref_externa"] or str(ent["id"])[:8]).upper(),
        "emitido_em": datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y · %H:%M BRT"),
        "hash": hash_curto,
        "titulo": ent["ref_externa"] or (ent["cliente"] or "Entrega"),
        "veredito": ("entrega concluída em conformidade"
                     if conforme else "entrega concluída em conformidade parcial"),
        "resumo": ("Custódia térmica registrada de ponta a ponta."
                   + ("" if conforme
                      else f" Excursão de {exc['min_fora']} min documentada, pico {exc['pico']} °C.")),
        "campos": [
            {"k": "Embarcador", "v": ent["cliente"] or "—", "plain": True},
            {"k": "Transportador", "v": "3PH Medicamentos", "plain": True},  # TODO
            {"k": "Faixa contratada",
             "v": (f"{ent['temp_min']} – {ent['temp_max']} °C"
                   if ent["temp_min"] is not None else "—")},
            {"k": "Recebedor",
             "v": (pod["recebedor_nome"] if pod else "—"), "plain": True},
            {"k": "Coleta", "v": _fmt_data(ent["coletada_em"])},
            {"k": "Entrega", "v": _fmt_data(ent["entregue_em"]),
             "ok": ent["entregue_em"] is not None},
            {"k": "Duração", "v": _dur(ent["coletada_em"], ent["entregue_em"])},
            {"k": "Sensor · nº", "v": ent["logger_id"] or "—"},
        ],
        "excursao": {"pico": f"{exc['pico']} °C", "min_fora": exc["min_fora"]},
        "eventos": [
            {"t": _hhmm(ev["ocorrido_em"]),
             "txt": _evento_txt(dict(ev)),
             "tone": _evento_tone(dict(ev))}
            for ev in eventos
        ],
    }
