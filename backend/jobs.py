"""
CHAMACARGA — jobs internos (cron)

Scripts autocontidos que o Render Cron (ou qualquer scheduler) executa
periodicamente. Sem HTTP: conectam direto no DATABASE_URL, fazem o
trabalho, saem. Idempotentes.

Uso local:
    DATABASE_URL=postgres://... python jobs.py detectar-sensor-mudo
    DATABASE_URL=postgres://... python jobs.py expirar-tokens

Render (ver render.yaml):
    startCommand: python jobs.py detectar-sensor-mudo
    schedule: "*/5 * * * *"
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import asyncpg


# --------------------------------------------------------------------
# Sensor mudo — para cada entrega em_rota com temp_min setado (farma),
# se a última leitura foi há mais de LIMITE_MIN minutos, cria um alerta
# de severidade alta e um evento 'observacao' auditável (entra no
# hash-chain via trigger). Idempotente: só cria se ainda não houver
# alerta 'sensor_mudo' aberto para a entrega.
# --------------------------------------------------------------------
LIMITE_SENSOR_MUDO_MIN = int(os.environ.get("SENSOR_MUDO_LIMITE_MIN", "10"))


async def detectar_sensor_mudo(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch(
        """
        with ultima as (
          select entrega_id, max(lido_em) as lido_em
            from leituras_temperatura
            group by entrega_id
        ),
        alvo as (
          select e.id as entrega_id, u.lido_em, p.temp_min, p.temp_max
            from entregas e
            join pedidos p on p.id = e.pedido_id
            left join ultima u on u.entrega_id = e.id
            where e.status = 'em_rota'
              and p.temp_min is not null
        )
        select entrega_id, lido_em
          from alvo
          where lido_em is null
             or lido_em < now() - make_interval(mins => $1)
        """,
        LIMITE_SENSOR_MUDO_MIN,
    )
    criados = 0
    for r in rows:
        # idempotência: pula se já existe alerta aberto
        existe = await conn.fetchval(
            """select 1 from alertas
                where entrega_id = $1
                  and tipo = 'sensor_mudo'
                  and resolvido = false""",
            r["entrega_id"],
        )
        if existe:
            continue
        min_atras = (
            "sem leituras" if r["lido_em"] is None
            else f"{int((datetime.now(timezone.utc) - r['lido_em']).total_seconds() // 60)} min"
        )
        async with conn.transaction():
            await conn.execute(
                """insert into alertas (entrega_id, tipo, severidade, mensagem)
                   values ($1, 'sensor_mudo', 'alta', $2)""",
                r["entrega_id"],
                f"Sensor sem transmitir há {min_atras}. Verifique o logger na caixa.",
            )
            await conn.execute(
                """insert into eventos (entrega_id, tipo, autor, detalhe)
                   values ($1, 'observacao', 'sistema', $2)""",
                r["entrega_id"],
                json.dumps({"motivo": "sensor_mudo", "ultima_leitura": (
                    r["lido_em"].isoformat() if r["lido_em"] else None)}),
            )
        criados += 1
    return criados


# --------------------------------------------------------------------
# Expirar tokens públicos — housekeeping. Deleta tokens já expirados
# há mais de RETENCAO_DIAS. Log fica em stdout pro Render capturar.
# --------------------------------------------------------------------
RETENCAO_TOKENS_DIAS = int(os.environ.get("TOKENS_RETENCAO_DIAS", "7"))


async def expirar_tokens(conn: asyncpg.Connection) -> int:
    n = await conn.fetchval(
        """with del as (
             delete from tokens_publicos
              where expira_em < now() - make_interval(days => $1)
             returning 1
           )
           select count(*) from del""",
        RETENCAO_TOKENS_DIAS,
    )
    return int(n or 0)


# --------------------------------------------------------------------
# Mascaramento LGPD — para destinatários criados há mais de
# LGPD_RETENCAO_MESES (default 18), apaga dados pessoais mantendo só
# o nome como "[apagado]". Preserva o registro (não é DELETE) pra não
# quebrar as FKs de pedidos/eventos/dossiê antigos.
# Idempotente: usa `documento is not null` como marcador (após
# mascarar, ele fica NULL).
# Base legal: LGPD Art. 15 (fim do tratamento pela expiração do
# vínculo contratual). Retenção pode ser regulada por normativos
# fiscais (5 anos) e ANVISA (RDC 430/653 exige dados por ciclo do
# lote) — ajuste LGPD_RETENCAO_MESES conforme o cliente.
# --------------------------------------------------------------------
LGPD_RETENCAO_MESES = int(os.environ.get("LGPD_RETENCAO_MESES", "18"))


async def mascarar_lgpd(conn: asyncpg.Connection) -> int:
    """Retorna o número de linhas mascaradas nesta execução."""
    n = await conn.fetchval(
        """with upd as (
             update destinatarios
                set nome          = '[apagado]',
                    telefone      = null,
                    documento     = null,
                    endereco_raw  = null,
                    endereco_norm = null,
                    cep           = null,
                    lat           = null,
                    lng           = null,
                    geocode_score = null
              where criado_em < now() - make_interval(months => $1)
                and documento is not null
             returning 1
           )
           select count(*) from upd""",
        LGPD_RETENCAO_MESES,
    )
    return int(n or 0)


# --------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------
JOBS = {
    "detectar-sensor-mudo": detectar_sensor_mudo,
    "expirar-tokens": expirar_tokens,
    "mascarar-lgpd": mascarar_lgpd,
}


async def _run(nome: str) -> int:
    if nome not in JOBS:
        print(f"job desconhecido: {nome}. disponíveis: {', '.join(JOBS)}", file=sys.stderr)
        return 2
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        n = await JOBS[nome](conn)
        print(f"{nome}: {n} ação(ões) executada(s)")
        return 0
    finally:
        await conn.close()


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: python jobs.py <nome-do-job>", file=sys.stderr)
        print(f"jobs: {', '.join(JOBS)}", file=sys.stderr)
        return 2
    return asyncio.run(_run(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
