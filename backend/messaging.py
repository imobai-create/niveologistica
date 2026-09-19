"""
Envio de mensagens ao destinatário — WhatsApp Business Cloud API (Meta)
com fallback pra SMS (Zenvia). Ambos são opt-in por env; quando um
canal não está configurado, `send_link` cai automaticamente pro outro,
e retorna {"canal": "nenhum"} se nem um está pronto (nada quebra).

Uso típico:
    from messaging import send_link
    r = await send_link(destinatario_telefone, link_url, contexto="Aché")

Config (env):
    WHATSAPP_TOKEN                       — Meta access token
    WHATSAPP_PHONE_ID                    — ID do número emissor
    WHATSAPP_TEMPLATE_NAME               — template pré-aprovado (obrig.
                                            fora da janela de 24 h)
    WHATSAPP_TEMPLATE_LANG               — default 'pt_BR'
    SMS_PROVIDER                         — 'zenvia' ou vazio
    SMS_API_KEY                          — token da Zenvia (X-API-TOKEN)
    SMS_FROM                             — nome/número emissor (Zenvia)
"""
import os
from typing import Optional

import httpx


WHATSAPP_TOKEN         = os.environ.get("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_ID      = os.environ.get("WHATSAPP_PHONE_ID", "")
WHATSAPP_TEMPLATE_NAME = os.environ.get("WHATSAPP_TEMPLATE_NAME", "")
WHATSAPP_TEMPLATE_LANG = os.environ.get("WHATSAPP_TEMPLATE_LANG", "pt_BR")

SMS_PROVIDER = os.environ.get("SMS_PROVIDER", "").lower()  # 'zenvia' ou ''
SMS_API_KEY  = os.environ.get("SMS_API_KEY", "")
SMS_FROM     = os.environ.get("SMS_FROM", "Chamacarga")


def _normalizar_telefone(tel: str) -> str:
    """Deixa só dígitos; se começar com 0 ou faltar 55, força E.164 BR."""
    digitos = "".join(c for c in tel if c.isdigit())
    if not digitos:
        return ""
    # remove leading zeros
    digitos = digitos.lstrip("0")
    # Se já tem código do país (55 + 10/11 dígitos), retorna
    if digitos.startswith("55") and len(digitos) in (12, 13):
        return digitos
    # Se tem 10 ou 11 dígitos (DDD + número), assume BR
    if len(digitos) in (10, 11):
        return "55" + digitos
    return digitos


def whatsapp_configurado() -> bool:
    return bool(WHATSAPP_TOKEN and WHATSAPP_PHONE_ID and WHATSAPP_TEMPLATE_NAME)


def sms_configurado() -> bool:
    return SMS_PROVIDER == "zenvia" and bool(SMS_API_KEY)


async def send_whatsapp(to: str, url: str, contexto: str = "") -> dict:
    """Envia mensagem template com o link. Retorna {ok, id_provedor, ...}.
    Assume que o template tem UMA variável no body (o link)."""
    if not whatsapp_configurado():
        return {"ok": False, "canal": "whatsapp", "erro": "não configurado"}
    tel = _normalizar_telefone(to)
    if not tel:
        return {"ok": False, "canal": "whatsapp", "erro": "telefone inválido"}
    body = {
        "messaging_product": "whatsapp",
        "to": tel,
        "type": "template",
        "template": {
            "name": WHATSAPP_TEMPLATE_NAME,
            "language": {"code": WHATSAPP_TEMPLATE_LANG},
            "components": [{
                "type": "body",
                "parameters": [{"type": "text", "text": url}],
            }],
        },
    }
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(
            f"https://graph.facebook.com/v20.0/{WHATSAPP_PHONE_ID}/messages",
            headers={"Authorization": f"Bearer {WHATSAPP_TOKEN}",
                     "Content-Type": "application/json"},
            json=body,
        )
    if r.status_code >= 400:
        return {"ok": False, "canal": "whatsapp",
                "erro": f"{r.status_code}: {r.text[:200]}"}
    data = r.json()
    msg_id = (data.get("messages") or [{}])[0].get("id")
    return {"ok": True, "canal": "whatsapp", "id_provedor": msg_id}


async def send_sms(to: str, texto: str) -> dict:
    """Envio via Zenvia SMS (única provedora suportada hoje)."""
    if not sms_configurado():
        return {"ok": False, "canal": "sms", "erro": "não configurado"}
    tel = _normalizar_telefone(to)
    if not tel:
        return {"ok": False, "canal": "sms", "erro": "telefone inválido"}
    body = {
        "from": SMS_FROM,
        "to": tel,
        "contents": [{"type": "text", "text": texto}],
    }
    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.post(
            "https://api.zenvia.com/v2/channels/sms/messages",
            headers={"X-API-TOKEN": SMS_API_KEY,
                     "Content-Type": "application/json"},
            json=body,
        )
    if r.status_code >= 400:
        return {"ok": False, "canal": "sms",
                "erro": f"{r.status_code}: {r.text[:200]}"}
    data = r.json()
    return {"ok": True, "canal": "sms", "id_provedor": data.get("id")}


async def send_link(to: str, url: str, contexto: str = "") -> dict:
    """Tenta WhatsApp primeiro; cai pra SMS se falhar ou não configurado.
    Se nenhum canal está pronto, retorna {"canal": "nenhum", "ok": False}."""
    if whatsapp_configurado():
        r = await send_whatsapp(to, url, contexto)
        if r.get("ok"):
            return r
        # Se WhatsApp falhou (número não tem WhatsApp, template rejeitado etc)
        # cai pra SMS.
    if sms_configurado():
        texto = (f"{contexto}: " if contexto else "") + \
                f"escolha sua janela de entrega: {url} (link válido 12h)"
        return await send_sms(to, texto)
    return {"ok": False, "canal": "nenhum",
            "erro": "nenhum canal configurado (WHATSAPP_TOKEN ou SMS_API_KEY)"}
