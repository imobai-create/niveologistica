"""
RASTRO API — backend MVP (FastAPI + Postgres/Supabase)
Liga o painel ao schema: ingestão de leituras, criação de entrega, custódia,
POD, dossiê e o agente de WhatsApp (chamada real à API da Anthropic).

Reaproveita a função SQL avaliar_excursao() — a lógica de excursão vive no banco.

Env:  DATABASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opcional)
Rodar: uvicorn main:app --reload
"""
import os, json, re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import asyncpg, httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATABASE_URL      = os.environ["DATABASE_URL"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL   = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
CO2_KG_POR_KM     = 0.25  # emissão evitada vs. van diesel
CORS_ORIGINS      = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

pool: Optional[asyncpg.Pool] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    yield
    await pool.close()


app = FastAPI(title="Rastro API", version="0.1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
)


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
    cliente_id: str
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
    async with pool.acquire() as c:
        await c.fetchval("select 1")
    return {"ok": True}


@app.post("/pedidos", status_code=201)
async def criar_pedido(p: PedidoIn):
    async with pool.acquire() as c, c.transaction():
        dest_id = await c.fetchval(
            """insert into destinatarios (cliente_id, nome, telefone, documento, endereco_raw, cep)
               values ($1,$2,$3,$4,$5,$6) returning id""",
            p.cliente_id, p.destinatario.nome, p.destinatario.telefone,
            p.destinatario.documento, p.destinatario.endereco_raw, p.destinatario.cep,
        )
        ped_id = await c.fetchval(
            """insert into pedidos (cliente_id, destinatario_id, ref_externa, valor_declarado,
                                    termolabil, faixa, temp_min, temp_max, janela_inicio, janela_fim)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id""",
            p.cliente_id, dest_id, p.ref_externa, p.valor_declarado, p.termolabil,
            p.faixa, p.temp_min, p.temp_max, p.janela_inicio, p.janela_fim,
        )
    return {"pedido_id": str(ped_id), "destinatario_id": str(dest_id)}


@app.post("/pedidos/{pedido_id}/entregas", status_code=201)
async def criar_entrega(pedido_id: str, e: EntregaIn):
    async with pool.acquire() as c, c.transaction():
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
async def listar_entregas():
    async with pool.acquire() as c:
        rows = await c.fetch("select * from vw_entrega_resumo order by coletada_em desc nulls last")
    return [jsonable(r) for r in rows]


@app.get("/painel/entregas")
async def listar_painel():
    """Lista enriquecida para o front: campos do painel + flag de excursão."""
    async with pool.acquire() as c:
        rows = await c.fetch(
            """
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
            order by e.criado_em desc
            """)
    return [jsonable(r) for r in rows]


@app.get("/entregas/{entrega_id}")
async def detalhe_entrega(entrega_id: str):
    async with pool.acquire() as c:
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
async def add_evento(entrega_id: str, ev: EventoIn):
    async with pool.acquire() as c:
        ev_id = await c.fetchval(
            """insert into eventos (entrega_id, tipo, autor, lat, lng, detalhe)
               values ($1,$2,$3,$4,$5,$6) returning id""",
            entrega_id, ev.tipo, ev.autor, ev.lat, ev.lng, json.dumps(ev.detalhe),
        )
    return {"evento_id": str(ev_id)}


@app.post("/entregas/{entrega_id}/leituras", status_code=201)
async def ingerir_leituras(entrega_id: str, body: LeiturasBatch):
    """Upsert idempotente do lote do data logger + avaliação de excursão no banco."""
    if not body.leituras:
        raise HTTPException(400, "lote vazio")
    rows = [(entrega_id, l.lido_em, l.temp_c, l.umidade, body.logger_id) for l in body.leituras]
    async with pool.acquire() as c, c.transaction():
        await c.executemany(
            """insert into leituras_temperatura (entrega_id, lido_em, temp_c, umidade, logger_id)
               values ($1,$2,$3,$4,$5) on conflict (entrega_id, lido_em) do nothing""", rows)
        await c.execute("select avaliar_excursao($1)", entrega_id)  # função do schema
        resumo = await c.fetchrow("select houve_excursao from vw_entrega_resumo where entrega_id=$1", entrega_id)
    return {"recebidas": len(rows), "houve_excursao": bool(resumo and resumo["houve_excursao"])}


@app.post("/entregas/{entrega_id}/pod", status_code=201)
async def registrar_pod(entrega_id: str, pod: PodIn):
    async with pool.acquire() as c, c.transaction():
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
async def gerar_dossie(entrega_id: str):
    det = await detalhe_entrega(entrega_id)
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
    return f"""Você é o assistente de entregas da Rastro Logística, operação premium de last-mile.
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
async def agente_responder(body: AgenteIn):
    async with pool.acquire() as c:
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
