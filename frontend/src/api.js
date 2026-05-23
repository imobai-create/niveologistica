// Cliente da API Rastro. Mapeia o shape do backend para o shape que o painel consome.
// Não há chave de API no front: o /agente/responder vive no backend.

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.status === 204 ? null : r.json();
}

// Lista para a barra lateral. Retorna o shape leve (sem leituras/eventos/pod).
export async function listarPainel() {
  const rows = await req("/painel/entregas");
  return rows.map((r) => ({
    id: r.id,
    cliente: r.cliente,
    ref: r.ref_externa,
    faixa: r.faixa,
    temp_min: r.temp_min != null ? Number(r.temp_min) : null,
    temp_max: r.temp_max != null ? Number(r.temp_max) : null,
    termolabil: r.termolabil,
    status: r.status,
    valor: r.valor_declarado != null ? Number(r.valor_declarado) : 0,
    destinatario: r.destinatario,
    endereco: r.endereco,
    motorista: r.motorista || "—",
    veiculo: r.veiculo || "—",
    logger: r.logger_id || "—",
    km: r.distancia_km != null ? Number(r.distancia_km) : 0,
    janela_i: r.janela_inicio,
    janela_f: r.janela_fim,
    houve_excursao: r.houve_excursao,
    eventos: [],
    leituras: [],
    pod: null,
    _hidratado: false,
  }));
}

// Detalhe (eventos + leituras + POD). Chamado quando o usuário seleciona uma entrega.
export async function detalheEntrega(id) {
  const d = await req(`/entregas/${id}`);
  return {
    eventos: (d.eventos || []).map((e) => ({
      tipo: e.tipo,
      ocorrido_em: e.ocorrido_em,
      autor: e.autor,
      detalhe: typeof e.detalhe === "string" ? e.detalhe : JSON.stringify(e.detalhe || {}),
    })),
    leituras: (d.leituras || []).map((l) => ({
      lido_em: l.lido_em,
      temp_c: Number(l.temp_c),
    })),
    pod: d.pod
      ? {
          recebedor: d.pod.recebedor_nome,
          doc: d.pod.recebedor_doc,
          registrado_em: d.pod.registrado_em,
        }
      : null,
  };
}

// Conversa com o agente — o backend chama a Anthropic e aplica a ação no banco.
export async function agenteResponder(entregaId, mensagens) {
  return req("/agente/responder", {
    method: "POST",
    body: JSON.stringify({ entrega_id: entregaId, mensagens }),
  });
}
