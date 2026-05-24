#!/usr/bin/env python3
"""
Simulador de logger BLE — Rastro
================================

Gera leituras de temperatura/umidade e (opcionalmente) eventos de GPS / choque
para uma entrega real do banco, postando no backend FastAPI via HTTP. Útil
para validar o pipeline de custódia (`avaliar_excursao()`, alertas, dossiê)
antes de o hardware chegar.

Sem dependências externas — só stdlib.

Exemplos:
  # Backfill 60 min de leituras dentro da faixa, sem GPS:
  python scripts/simulador_logger.py --entrega <uuid> --modo backfill --minutos 60

  # Live, batch a cada 30s, com excursão térmica no meio:
  python scripts/simulador_logger.py --entrega <uuid> --modo live \\
      --intervalo 30 --cenario excursao --gps

  # Lista entregas em rota e pergunta qual usar:
  python scripts/simulador_logger.py --listar --api http://localhost:8000
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable


# ----------------------------- HTTP helpers ----------------------------

def _req(method: str, url: str, body: dict | None = None) -> dict | list | None:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"HTTP {e.code} em {method} {url}: {detail}") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"Falha de rede em {url}: {e.reason}") from None


# ----------------------------- modelo do sinal -------------------------

@dataclass
class Faixa:
    tmin: float
    tmax: float

    @property
    def alvo(self) -> float:
        return (self.tmin + self.tmax) / 2

    @property
    def largura(self) -> float:
        return self.tmax - self.tmin


def faixa_da_entrega(ent: dict) -> Faixa:
    """Usa temp_min/temp_max da entrega; cai num padrão refrigerado se não vier."""
    tmin = ent.get("temp_min")
    tmax = ent.get("temp_max")
    if tmin is None or tmax is None:
        return Faixa(2.0, 8.0)
    return Faixa(float(tmin), float(tmax))


def gerar_temperatura(t_idx: int, total: int, faixa: Faixa, cenario: str, seed: int) -> float:
    """Curva determinística por seed — mesmo cenário gera o mesmo sinal."""
    rnd = random.Random(seed * 1000 + t_idx)
    base = faixa.alvo + math.sin(t_idx / max(total, 1) * 2 * math.pi) * (faixa.largura * 0.2)
    ruido = rnd.gauss(0, faixa.largura * 0.06)
    temp = base + ruido

    progresso = t_idx / max(total - 1, 1)
    if cenario == "excursao":
        # rampa acima do tmax entre 40% e 70% do trajeto, pico +4°C
        if 0.4 <= progresso <= 0.7:
            curva = math.sin((progresso - 0.4) / 0.3 * math.pi)
            temp = faixa.tmax + 1.5 + curva * 4.0
    elif cenario == "porta-aberta":
        # 3 picos rápidos em momentos diferentes
        for centro in (0.25, 0.55, 0.8):
            if abs(progresso - centro) < 0.02:
                temp += 5.0 * (1 - abs(progresso - centro) / 0.02)
    # cenario == "normal" ou "choque": só a curva base
    return round(temp, 2)


def gerar_umidade(t_idx: int, seed: int) -> float:
    rnd = random.Random(seed * 7 + t_idx)
    return round(55 + rnd.gauss(0, 3), 1)


# ----------------------------- GPS pseudo-caminhada --------------------

def interpolar_gps(origem: tuple[float, float], destino: tuple[float, float],
                   progresso: float, jitter: float = 0.0003) -> tuple[float, float]:
    lat = origem[0] + (destino[0] - origem[0]) * progresso + random.uniform(-jitter, jitter)
    lng = origem[1] + (destino[1] - origem[1]) * progresso + random.uniform(-jitter, jitter)
    return round(lat, 6), round(lng, 6)


# ----------------------------- batches ---------------------------------

def montar_leituras(
    inicio: datetime, intervalo_s: int, total: int,
    faixa: Faixa, cenario: str, seed: int,
) -> list[dict]:
    out = []
    for i in range(total):
        lido_em = inicio + timedelta(seconds=i * intervalo_s)
        out.append({
            "lido_em": lido_em.isoformat(),
            "temp_c": gerar_temperatura(i, total, faixa, cenario, seed),
            "umidade": gerar_umidade(i, seed),
        })
    return out


def chunks(seq: list, n: int) -> Iterable[list]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ----------------------------- comandos --------------------------------

def listar_entregas(api: str) -> list[dict]:
    data = _req("GET", f"{api}/painel/entregas") or []
    return [e for e in data if e.get("status") not in ("entregue", "cancelada", "devolvida")]


def cmd_listar(api: str) -> int:
    rows = listar_entregas(api)
    if not rows:
        print("Nenhuma entrega em aberto.")
        return 0
    print(f"{'ID':38}  {'REF':14}  {'STATUS':16}  CLIENTE")
    for e in rows:
        print(f"{e['id']:38}  {e.get('ref', ''):14}  {e['status']:16}  {e.get('cliente', '')}")
    return 0


def cmd_simular(args: argparse.Namespace) -> int:
    api = args.api.rstrip("/")
    det = _req("GET", f"{api}/entregas/{args.entrega}")
    if not det:
        print("Entrega não encontrada.", file=sys.stderr)
        return 1
    ent = det.get("entrega", det)
    faixa = Faixa(args.tmin, args.tmax) if args.tmin is not None and args.tmax is not None else faixa_da_entrega(ent)
    logger_id = args.logger_id or f"SIM-{uuid.uuid4().hex[:8].upper()}"
    total = max(1, (args.minutos * 60) // args.intervalo)
    seed = args.seed if args.seed is not None else random.randint(1, 10_000)

    print(f"== Simulador BLE — entrega {args.entrega[:8]}…  logger={logger_id}")
    print(f"   faixa {faixa.tmin}–{faixa.tmax}°C  cenário={args.cenario}  "
          f"{total} leituras × {args.intervalo}s  modo={args.modo}  seed={seed}")

    origem = (float(args.gps_origem[0]), float(args.gps_origem[1])) if args.gps and args.gps_origem else None
    destino = (float(args.gps_destino[0]), float(args.gps_destino[1])) if args.gps and args.gps_destino else None

    if args.modo == "backfill":
        agora = datetime.now(timezone.utc).replace(microsecond=0)
        inicio = agora - timedelta(seconds=(total - 1) * args.intervalo)
        leituras = montar_leituras(inicio, args.intervalo, total, faixa, args.cenario, seed)
        for batch in chunks(leituras, 60):
            r = _req("POST", f"{api}/entregas/{args.entrega}/leituras",
                     {"logger_id": logger_id, "leituras": batch})
            print(f"   + {r.get('recebidas')} leituras  excursão={r.get('houve_excursao')}")
        if args.gps and origem and destino:
            postar_gps_backfill(api, args.entrega, logger_id, inicio, args.intervalo, total, origem, destino)
        if args.cenario == "choque":
            postar_choque(api, args.entrega, logger_id, origem)
        print("== concluído (backfill)")
        return 0

    # modo live
    print("   Ctrl+C para parar.")
    for i in range(total):
        ts = datetime.now(timezone.utc).replace(microsecond=0)
        leitura = {
            "lido_em": ts.isoformat(),
            "temp_c": gerar_temperatura(i, total, faixa, args.cenario, seed),
            "umidade": gerar_umidade(i, seed),
        }
        r = _req("POST", f"{api}/entregas/{args.entrega}/leituras",
                 {"logger_id": logger_id, "leituras": [leitura]})
        marca = "!" if r.get("houve_excursao") else " "
        print(f"   {marca} {ts.strftime('%H:%M:%S')}  {leitura['temp_c']:>5.2f}°C  "
              f"u={leitura['umidade']}%  excursão_total={r.get('houve_excursao')}")
        if args.gps and origem and destino and i % 5 == 0:
            lat, lng = interpolar_gps(origem, destino, i / max(total - 1, 1))
            _req("POST", f"{api}/entregas/{args.entrega}/eventos",
                 {"tipo": "ping", "autor": "logger", "lat": lat, "lng": lng,
                  "detalhe": {"logger_id": logger_id}})
        if args.cenario == "choque" and i == total // 2:
            postar_choque(api, args.entrega, logger_id, origem)
        if i < total - 1:
            time.sleep(args.intervalo)
    print("== concluído (live)")
    return 0


def postar_gps_backfill(api: str, entrega_id: str, logger_id: str,
                         inicio: datetime, intervalo_s: int, total: int,
                         origem: tuple, destino: tuple):
    passo = max(1, total // 20)  # ~20 pings ao longo do trajeto
    for i in range(0, total, passo):
        ts = inicio + timedelta(seconds=i * intervalo_s)
        lat, lng = interpolar_gps(origem, destino, i / max(total - 1, 1))
        _req("POST", f"{api}/entregas/{entrega_id}/eventos",
             {"tipo": "ping", "autor": "logger", "lat": lat, "lng": lng,
              "detalhe": {"logger_id": logger_id, "lido_em": ts.isoformat()}})
    print(f"   + GPS pings ({total // passo} pontos)")


def postar_choque(api: str, entrega_id: str, logger_id: str, gps: tuple | None):
    body = {"tipo": "choque", "autor": "logger",
            "detalhe": {"logger_id": logger_id, "g": round(random.uniform(3.5, 6.0), 2)}}
    if gps:
        body["lat"], body["lng"] = gps
    _req("POST", f"{api}/entregas/{entrega_id}/eventos", body)
    print("   ! evento de choque registrado")


# ----------------------------- CLI -------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Simulador de logger BLE para o Rastro")
    p.add_argument("--api", default="http://localhost:8000", help="URL base do backend")
    p.add_argument("--listar", action="store_true", help="Lista entregas em aberto e sai")
    p.add_argument("--entrega", help="UUID da entrega alvo")
    p.add_argument("--logger-id", help="Identificador do logger (default: SIM-XXXX gerado)")
    p.add_argument("--modo", choices=["backfill", "live"], default="backfill")
    p.add_argument("--minutos", type=int, default=60, help="Duração total simulada")
    p.add_argument("--intervalo", type=int, default=30, help="Segundos entre leituras")
    p.add_argument("--cenario", choices=["normal", "excursao", "porta-aberta", "choque"], default="normal")
    p.add_argument("--tmin", type=float, help="Override faixa mínima (°C)")
    p.add_argument("--tmax", type=float, help="Override faixa máxima (°C)")
    p.add_argument("--seed", type=int, help="Seed do RNG para reprodutibilidade")
    p.add_argument("--gps", action="store_true", help="Emite eventos 'ping' com GPS interpolado")
    p.add_argument("--gps-origem", nargs=2, metavar=("LAT", "LNG"),
                   default=["-23.55052", "-46.633308"], help="Origem (default: Sé/SP)")
    p.add_argument("--gps-destino", nargs=2, metavar=("LAT", "LNG"),
                   default=["-23.56168", "-46.65581"], help="Destino (default: Paulista/SP)")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if args.listar:
        return cmd_listar(args.api.rstrip("/"))
    if not args.entrega:
        print("Erro: forneça --entrega <uuid> ou use --listar primeiro.", file=sys.stderr)
        return 2
    return cmd_simular(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrompido.")
        sys.exit(130)
