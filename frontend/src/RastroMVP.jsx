import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer,
} from "recharts";
import {
  Truck, Snowflake, AlertTriangle, CheckCircle2, MapPin, FileText, Clock, Package,
  Camera, Send, Leaf, ShieldCheck, Activity, Bot, RotateCcw, X, Thermometer, User,
} from "lucide-react";
import { listarPainel, detalheEntrega, agenteResponder } from "./api";

/* ----------------------------- Brand ----------------------------- */
const C = {
  bg: "#0E2A26", bg2: "#13352F", green: "#1E5F4F", mint: "#2FBF93", paper: "#F4F8F6",
  card: "#FFFFFF", ink: "#16241F", mute: "#5C6F69", line: "#E0E8E4", amber: "#E08A3C",
  red: "#D2544B", blue: "#2E7DA8",
};
const serif = "Georgia, 'Times New Roman', serif";
const sans = "'Segoe UI', Helvetica, Arial, sans-serif";

/* ----------------------------- Helpers ---------------------------- */
const TZ = "-03:00";
const iso = (d, h, m) => `2026-05-20T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${TZ}`;
const fmtT = (s) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDT = (s) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function buildReadings(startH, startM, temps) {
  return temps.map((t, i) => {
    const total = startM + i * 10;
    return { lido_em: iso(20, startH + Math.floor(total / 60), total % 60), temp_c: t };
  });
}

// Mirrors avaliar_excursao(): seconds out of range (sum of gaps between consecutive
// out-of-range readings) + peak deviation. Alert if beyond tolerance minutes.
function computeExcursion(leituras, min, max, tolMin = 10) {
  if (min == null || max == null) return { excursao: false, segFora: 0, pico: 0 };
  const out = leituras.filter((r) => r.temp_c < min || r.temp_c > max);
  let segFora = 0, pico = 0, prev = null;
  for (const r of out) {
    if (prev) segFora += (new Date(r.lido_em) - new Date(prev)) / 1000;
    prev = r.lido_em;
    pico = Math.max(pico, Math.max(min - r.temp_c, r.temp_c - max));
  }
  return { excursao: segFora >= tolMin * 60, segFora, pico: Math.round(pico * 10) / 10 };
}

/* ----------------------------- Seed ------------------------------- */
function seedEntregas() {
  return [
    {
      id: "e1", cliente: "3PH Medicamentos", ref: "3PH-48217", faixa: "refrigerado_2_8",
      temp_min: 2, temp_max: 8, termolabil: true, status: "entregue", valor: 4200,
      destinatario: "Farmácia São Lucas", endereco: "R. dos Inconfidentes, 1200 — Funcionários, BH",
      motorista: "Carla M.", veiculo: "BYD eT3 (PYZ-2E04)", logger: "LG-0098", km: 13,
      janela_i: iso(20, 8, 0), janela_f: iso(20, 12, 0),
      eventos: [
        { tipo: "criada", ocorrido_em: iso(20, 7, 10), autor: "sistema" },
        { tipo: "coletada", ocorrido_em: iso(20, 7, 48), autor: "Carla M." },
        { tipo: "saiu_para_entrega", ocorrido_em: iso(20, 8, 5), autor: "Carla M." },
        { tipo: "excursao_termica", ocorrido_em: iso(20, 9, 5), autor: "sistema", detalhe: "pico +3,2°C" },
        { tipo: "entregue", ocorrido_em: iso(20, 9, 40), autor: "Carla M." },
      ],
      leituras: buildReadings(8, 0, [5.2, 4.8, 5.0, 5.6, 6.4, 8.9, 10.4, 11.2, 10.8, 9.1, 6.2, 5.0, 4.9]),
      pod: { recebedor: "J. Pereira", doc: "***.456.***-**", registrado_em: iso(20, 9, 40) },
    },
    {
      id: "e2", cliente: "Hera Medicamentos", ref: "HERA-90455", faixa: "controlado_15_30",
      temp_min: 15, temp_max: 30, termolabil: true, status: "em_rota", valor: 1850,
      destinatario: "Clínica Vida Plena", endereco: "Av. do Contorno, 6000 — Savassi, BH",
      motorista: "Rafael S.", veiculo: "BYD eT3 (PYZ-2E04)", logger: "LG-0101", km: 9,
      janela_i: iso(20, 13, 0), janela_f: iso(20, 17, 0),
      eventos: [
        { tipo: "criada", ocorrido_em: iso(20, 11, 20), autor: "sistema" },
        { tipo: "coletada", ocorrido_em: iso(20, 12, 30), autor: "Rafael S." },
        { tipo: "saiu_para_entrega", ocorrido_em: iso(20, 13, 5), autor: "Rafael S." },
      ],
      leituras: buildReadings(13, 0, [22.1, 23.0, 22.6, 21.9, 23.4, 22.8]),
      pod: null,
    },
    {
      id: "e3", cliente: "Centrali Pharma", ref: "CEN-11023", faixa: "refrigerado_2_8",
      temp_min: 2, temp_max: 8, termolabil: true, status: "entregue", valor: 6900,
      destinatario: "Drogaria Central", endereco: "R. Rio de Janeiro, 450 — Centro, BH",
      motorista: "Carla M.", veiculo: "BYD eT3 (PYZ-2E04)", logger: "LG-0098", km: 7,
      janela_i: iso(20, 8, 0), janela_f: iso(20, 11, 0),
      eventos: [
        { tipo: "criada", ocorrido_em: iso(20, 7, 5), autor: "sistema" },
        { tipo: "coletada", ocorrido_em: iso(20, 7, 50), autor: "Carla M." },
        { tipo: "saiu_para_entrega", ocorrido_em: iso(20, 8, 6), autor: "Carla M." },
        { tipo: "entregue", ocorrido_em: iso(20, 8, 52), autor: "Carla M." },
      ],
      leituras: buildReadings(8, 0, [4.5, 5.0, 5.2, 4.8, 5.5, 5.1, 4.9]),
      pod: { recebedor: "M. Souza", doc: "***.781.***-**", registrado_em: iso(20, 8, 52) },
    },
  ];
}

const STATUS = {
  criada: { t: "Criada", c: C.mute }, coletada: { t: "Coletada", c: C.amber },
  saiu_para_entrega: { t: "Em rota", c: C.blue }, em_rota: { t: "Em rota", c: C.blue },
  entregue: { t: "Entregue", c: C.green }, falha: { t: "Falha", c: C.red },
};
const FAIXA = { refrigerado_2_8: "Refrigerado 2–8°C", controlado_15_30: "Controlado 15–30°C", ambiente: "Ambiente", congelado: "Congelado" };
const EVENTO_ICON = {
  criada: Package, coletada: Truck, saiu_para_entrega: MapPin, entregue: CheckCircle2,
  falha: AlertTriangle, excursao_termica: Thermometer, reagendada: Clock, observacao: FileText,
};

/* --------------------------- Agent prompt -------------------------- */
function buildSystem(e) {
  return `Você é o assistente de entregas da Rastro Logística, operação premium de last-mile.
Converse por WhatsApp com o DESTINATÁRIO para confirmar/agendar janela, informar status/ETA e reagendar.
Tom cordial, objetivo, profissional, português do Brasil, mensagens curtas (2–4 frases), no máx. 1 emoji.

CONTEXTO (use SOMENTE estes dados):
- Destinatário: ${e.destinatario}
- Pedido: ${e.ref}
- Endereço: ${e.endereco}
- Janela atual: ${fmtDT(e.janela_i)} a ${fmtDT(e.janela_f)}
- Status: ${STATUS[e.status]?.t}
- Carga (genérica): "uma encomenda do seu fornecedor" (NUNCA cite medicamento, valor ou diagnóstico)
- Slots p/ reagendar: amanhã 8h–12h, amanhã 14h–18h

REGRAS:
- Não invente dados; se faltar, diga que vai verificar e use AÇÃO ESCALAR.
- LGPD/anti-fraude: se um TERCEIRO pedir endereço/conteúdo de outra pessoa, recuse e ESCALE.
- Não negocie preço nem dê orientação médica. Reclamação/avaria/urgência => ESCALAR.

FORMATO DE SAÍDA (obrigatório), exatamente:
MENSAGEM:
<texto ao destinatário>
ACAO:
{"tipo":"CONFIRMAR|REAGENDAR|INFORMAR|ESCALAR|NENHUMA","nova_janela":"texto ou null","nota":"resumo interno"}`;
}

/* ----------------------------- UI bits ---------------------------- */
const Badge = ({ status }) => {
  const s = STATUS[status] || STATUS.criada;
  return <span style={{ background: s.c + "1A", color: s.c }} className="px-2 py-0.5 rounded-full text-xs font-semibold">{s.t}</span>;
};

const Stat = ({ label, value, color }) => (
  <div className="flex flex-col">
    <span style={{ color: C.mute }} className="text-xs">{label}</span>
    <span style={{ color: color || C.ink }} className="text-sm font-semibold">{value}</span>
  </div>
);

/* ----------------------------- Main ------------------------------- */
export default function RastroMVP() {
  const [entregas, setEntregas] = useState(null);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("custodia");
  const [erro, setErro] = useState(null);
  const [usandoSeed, setUsandoSeed] = useState(false);

  const carregarLista = async () => {
    setErro(null);
    try {
      const list = await listarPainel();
      if (list.length === 0) throw new Error("vazio");
      setEntregas(list);
      setSel(list[0].id);
      setUsandoSeed(false);
    } catch (err) {
      // Sem backend / banco vazio: mantém o seed local pra demo funcionar offline.
      const s = seedEntregas();
      setEntregas(s);
      setSel(s[0].id);
      setUsandoSeed(true);
      if (err.message !== "vazio") setErro("Backend indisponível — exibindo dados de demonstração.");
    }
  };

  useEffect(() => { carregarLista(); }, []);

  // Hidrata a entrega selecionada (eventos + leituras + POD) na primeira vez que entra em cena.
  useEffect(() => {
    if (!sel || usandoSeed) return;
    const cur = entregas?.find((x) => x.id === sel);
    if (!cur || cur._hidratado) return;
    (async () => {
      try {
        const d = await detalheEntrega(sel);
        setEntregas((prev) =>
          prev.map((x) => (x.id === sel ? { ...x, ...d, _hidratado: true } : x)),
        );
      } catch {
        /* mantém shape leve; o painel degrada graciosamente */
      }
    })();
  }, [sel, usandoSeed]);

  const reset = () => carregarLista();

  if (!entregas) {
    return <div style={{ background: C.paper, color: C.mute, fontFamily: sans }} className="h-screen flex items-center justify-center">Carregando Rastro…</div>;
  }
  const e = entregas.find((x) => x.id === sel) || entregas[0];
  const exc = computeExcursion(e.leituras, e.temp_min, e.temp_max);

  return (
    <div style={{ background: C.paper, fontFamily: sans, color: C.ink }} className="min-h-screen w-full">
      <style>{`@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}} .fade{animation:fade .4s ease both}`}</style>

      {/* Top bar */}
      <div style={{ background: C.bg }} className="px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div style={{ background: C.mint }} className="w-7 h-7 rounded-md flex items-center justify-center">
            <Activity size={18} color={C.bg} />
          </div>
          <div>
            <div style={{ fontFamily: serif, color: "#fff" }} className="text-lg font-bold leading-none">Rastro</div>
            <div style={{ color: "#9DB3AC" }} className="text-xs">Painel de custódia · MVP</div>
          </div>
        </div>
        <button onClick={reset} style={{ color: "#D7E4DF", borderColor: C.green }} className="text-xs flex items-center gap-1 border rounded-md px-2 py-1 hover:opacity-80">
          <RotateCcw size={13} /> {usandoSeed ? "Reiniciar demo" : "Recarregar"}
        </button>
      </div>
      {erro && (
        <div style={{ background: C.amber + "14", color: C.amber }} className="text-xs px-5 py-2">{erro}</div>
      )}

      <div className="flex flex-col md:flex-row">
        {/* List */}
        <div style={{ borderColor: C.line, background: "#fff" }} className="md:w-80 border-r shrink-0">
          <div style={{ color: C.mute }} className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide">Entregas de hoje</div>
          {entregas.map((it) => {
            const ie = it.leituras?.length
              ? computeExcursion(it.leituras, it.temp_min, it.temp_max)
              : { excursao: !!it.houve_excursao };
            const active = it.id === e.id;
            return (
              <button key={it.id} onClick={() => { setSel(it.id); setTab("custodia"); }}
                style={{ background: active ? C.paper : "#fff", borderColor: C.line, borderLeftColor: active ? C.mint : "transparent" }}
                className="w-full text-left px-4 py-3 border-b border-l-4 hover:opacity-95 transition">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{it.cliente}</span>
                  <Badge status={it.status} />
                </div>
                <div style={{ color: C.mute }} className="text-xs mt-1 flex items-center gap-2">
                  <span>{it.ref}</span><span>·</span>
                  <span className="flex items-center gap-1"><Snowflake size={11} />{FAIXA[it.faixa].replace("Refrigerado ", "").replace("Controlado ", "")}</span>
                </div>
                {ie.excursao && (
                  <div style={{ color: C.red }} className="text-xs mt-1 flex items-center gap-1 font-semibold">
                    <AlertTriangle size={11} /> Excursão térmica
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="flex-1 p-5 space-y-4 fade" key={e.id}>
          {/* Header card */}
          <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-4">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <div style={{ fontFamily: serif }} className="text-xl font-bold">{e.cliente}</div>
                <div style={{ color: C.mute }} className="text-sm">{e.ref} · {e.destinatario}</div>
                <div style={{ color: C.mute }} className="text-xs mt-1 flex items-center gap-1"><MapPin size={12} /> {e.endereco}</div>
              </div>
              <Badge status={e.status} />
            </div>
            <div style={{ borderColor: C.line }} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t">
              <Stat label="Faixa exigida" value={FAIXA[e.faixa]} />
              <Stat label="Janela SLA" value={`${fmtT(e.janela_i)}–${fmtT(e.janela_f)}`} />
              <Stat label="Motorista" value={e.motorista} />
              <Stat label="Valor declarado" value={`R$ ${e.valor.toLocaleString("pt-BR")}`} />
            </div>
          </div>

          {/* Excursion banner */}
          {exc.excursao ? (
            <div style={{ background: C.red + "12", borderColor: C.red + "55" }} className="border rounded-xl p-3 flex items-center gap-3">
              <AlertTriangle size={20} color={C.red} />
              <div className="text-sm">
                <span style={{ color: C.red }} className="font-semibold">Excursão térmica detectada.</span>{" "}
                {Math.round(exc.segFora / 60)} min fora da faixa, pico de {exc.pico}°C de desvio. Evento gravado na cadeia de custódia.
              </div>
            </div>
          ) : e.temp_min != null && (
            <div style={{ background: C.green + "10", borderColor: C.green + "44" }} className="border rounded-xl p-3 flex items-center gap-3">
              <ShieldCheck size={20} color={C.green} />
              <div className="text-sm"><span style={{ color: C.green }} className="font-semibold">Cadeia fria íntegra.</span> Nenhuma excursão no transporte.</div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ borderColor: C.line }} className="flex gap-1 border-b">
            {[["custodia", "Custódia"], ["temp", "Temperatura"], ["pod", "Prova de entrega"], ["dossie", "Dossiê"], ["agente", "Agente WhatsApp"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                style={{ color: tab === k ? C.green : C.mute, borderColor: tab === k ? C.mint : "transparent" }}
                className="px-3 py-2 text-sm font-semibold border-b-2 -mb-px">{l}</button>
            ))}
          </div>

          {tab === "custodia" && <Custodia e={e} />}
          {tab === "temp" && <TempView e={e} exc={exc} />}
          {tab === "pod" && <PodView e={e} />}
          {tab === "dossie" && <Dossie e={e} exc={exc} />}
          {tab === "agente" && <Agente e={e} />}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Custódia ----------------------------- */
function Custodia({ e }) {
  return (
    <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-4 fade">
      <div className="space-y-0">
        {e.eventos.map((ev, i) => {
          const Icon = EVENTO_ICON[ev.tipo] || FileText;
          const isExc = ev.tipo === "excursao_termica";
          const col = isExc ? C.red : C.green;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div style={{ background: col + "1A" }} className="w-8 h-8 rounded-full flex items-center justify-center">
                  <Icon size={16} color={col} />
                </div>
                {i < e.eventos.length - 1 && <div style={{ background: C.line }} className="w-px flex-1 my-1" />}
              </div>
              <div className="pb-4">
                <div className="text-sm font-semibold capitalize">{ev.tipo.replace(/_/g, " ")}</div>
                <div style={{ color: C.mute }} className="text-xs">{fmtDT(ev.ocorrido_em)} · {ev.autor}{ev.detalhe ? ` · ${ev.detalhe}` : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------- Temperatura --------------------------- */
function TempView({ e, exc }) {
  const data = useMemo(() => e.leituras.map((r) => ({ t: fmtT(r.lido_em), temp: r.temp_c })), [e]);
  const lo = Math.min(e.temp_min - 2, ...e.leituras.map((r) => r.temp_c)) - 1;
  const hi = Math.max(e.temp_max + 2, ...e.leituras.map((r) => r.temp_c)) + 1;
  return (
    <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-4 fade">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold flex items-center gap-2"><Thermometer size={15} color={C.green} /> Curva de temperatura (logger {e.logger})</div>
        <div style={{ color: C.mute }} className="text-xs">Faixa: {e.temp_min}–{e.temp_max}°C</div>
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <ReferenceArea y1={e.temp_min} y2={e.temp_max} fill={C.green} fillOpacity={0.08} />
            <ReferenceArea y1={e.temp_max} y2={hi} fill={C.red} fillOpacity={0.05} />
            <ReferenceArea y1={lo} y2={e.temp_min} fill={C.red} fillOpacity={0.05} />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: C.mute }} />
            <YAxis domain={[lo, hi]} tick={{ fontSize: 11, fill: C.mute }} />
            <Tooltip formatter={(v) => [`${v}°C`, "Temp"]} />
            <Line type="monotone" dataKey="temp" stroke={C.green} strokeWidth={2.5}
              dot={(p) => {
                const out = p.payload.temp < e.temp_min || p.payload.temp > e.temp_max;
                return <circle key={p.index} cx={p.cx} cy={p.cy} r={out ? 4.5 : 2.5} fill={out ? C.red : C.green} />;
              }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ color: C.mute }} className="text-xs mt-2">
        {exc.excursao
          ? `Resultado: ${Math.round(exc.segFora / 60)} min fora da faixa · pico ${exc.pico}°C · severidade ${exc.pico > 3 ? "alta" : "média"}.`
          : "Resultado: dentro da faixa em toda a rota."}
      </div>
    </div>
  );
}

/* ----------------------------- POD -------------------------------- */
function PodView({ e }) {
  if (!e.pod) return <div style={{ background: "#fff", borderColor: C.line, color: C.mute }} className="border rounded-xl p-6 text-sm fade">Entrega ainda não concluída — sem prova de entrega.</div>;
  return (
    <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-4 fade flex gap-4 flex-wrap">
      <div style={{ background: C.paper, borderColor: C.line }} className="border rounded-lg w-40 h-40 flex flex-col items-center justify-center" >
        <Camera size={30} color={C.mute} />
        <span style={{ color: C.mute }} className="text-xs mt-2">Foto do POD</span>
      </div>
      <div className="space-y-2">
        <Stat label="Recebido por" value={e.pod.recebedor} />
        <Stat label="Documento" value={e.pod.doc} />
        <Stat label="Registrado em" value={fmtDT(e.pod.registrado_em)} />
        <Stat label="Geolocalização" value="-19.9320, -43.9352" />
        <div style={{ color: C.green }} className="text-xs flex items-center gap-1 font-semibold"><CheckCircle2 size={13} /> POD verificado e anexado à custódia</div>
      </div>
    </div>
  );
}

/* ---------------------------- Dossiê ------------------------------ */
function Dossie({ e, exc }) {
  const co2 = (e.km * 0.25).toFixed(1); // kg CO2 evitado vs van diesel (~0,25 kg/km)
  return (
    <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-5 fade">
      <div className="flex items-center gap-2 mb-3"><FileText size={16} color={C.green} /><span className="font-semibold">Dossiê de conformidade & ESG</span></div>
      <div style={{ color: C.mute }} className="text-sm mb-4">Gerado automaticamente a partir da cadeia de custódia — pronto para auditoria do cliente (RDC 430).</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          ["Pedido", e.ref], ["Cliente", e.cliente], ["Faixa exigida", FAIXA[e.faixa]],
          ["SLA cumprido", e.status === "entregue" ? "Sim" : "Em andamento"],
          ["Integridade térmica", exc.excursao ? `Excursão (${Math.round(exc.segFora / 60)} min, pico ${exc.pico}°C)` : "Sem excursão"],
          ["Eventos registrados", `${e.eventos.length} (imutáveis)`],
          ["POD", e.pod ? "Anexado" : "Pendente"],
          ["CO₂ evitado (frota elétrica)", `${co2} kg neste trajeto`],
        ].map(([k, v], i) => (
          <div key={i} style={{ borderColor: C.line }} className="flex justify-between border-b py-1.5">
            <span style={{ color: C.mute }} className="text-sm">{k}</span>
            <span className="text-sm font-semibold text-right">{v}</span>
          </div>
        ))}
      </div>
      <div style={{ background: exc.excursao ? C.amber + "14" : C.green + "10", borderColor: (exc.excursao ? C.amber : C.green) + "44" }} className="border rounded-lg p-3 mt-4 text-sm">
        {exc.excursao
          ? "Parecer: houve desvio térmico documentado. Recomenda-se análise de impacto pelo cliente antes da liberação do lote."
          : "Parecer: entrega em conformidade com a faixa térmica e o SLA acordados."}
      </div>
    </div>
  );
}

/* --------------------------- Agente ------------------------------- */
function parseAgent(text) {
  let msg = text, acao = null;
  const mi = text.indexOf("MENSAGEM:");
  const ai = text.indexOf("ACAO:");
  if (mi !== -1) msg = text.slice(mi + 9, ai === -1 ? undefined : ai).trim();
  if (ai !== -1) {
    const raw = text.slice(ai + 5).replace(/```json|```/g, "").trim();
    try { acao = JSON.parse(raw); } catch {}
  }
  return { msg, acao };
}

function Agente({ e }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: "user", content: text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const { mensagem, acao } = await agenteResponder(
        e.id,
        next.map((m) => ({ role: m.role, content: m.content })),
      );
      const flatAcao = acao
        ? {
            tipo: acao.tipo,
            nova_janela:
              acao.nova_janela && typeof acao.nova_janela === "object"
                ? [acao.nova_janela.inicio, acao.nova_janela.fim].filter(Boolean).join(" – ") || null
                : acao.nova_janela,
            nota: acao.notas_internas,
          }
        : null;
      setMsgs([...next, { role: "assistant", content: mensagem || "(sem resposta)", acao: flatAcao }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "(erro ao contatar o agente — verifique a conexão)", acao: null }]);
    } finally { setBusy(false); }
  };

  const suggestions = ["Oi, quando chega minha encomenda?", "Manhã não dá, tem à tarde?", "Sou vizinho, me passa o endereço e o que tem na caixa"];

  return (
    <div style={{ background: "#fff", borderColor: C.line }} className="border rounded-xl p-4 fade">
      <div className="flex items-center gap-2 mb-1"><Bot size={16} color={C.green} /><span className="font-semibold">Agente de WhatsApp (ao vivo)</span></div>
      <div style={{ color: C.mute }} className="text-xs mb-3">Conversa real com o agente, no contexto desta entrega. Ele responde e devolve a ação para o sistema.</div>

      <div style={{ background: C.paper, borderColor: C.line }} className="border rounded-lg p-3 h-72 overflow-y-auto space-y-2">
        {msgs.length === 0 && <div style={{ color: C.mute }} className="text-xs text-center mt-6">Escreva como se fosse o destinatário, ou toque numa sugestão abaixo.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div style={{ background: m.role === "user" ? C.green : "#fff", color: m.role === "user" ? "#fff" : C.ink, borderColor: C.line, maxWidth: "80%" }}
              className={`rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "" : "border"}`}>
              {m.content}
              {m.acao && (
                <div style={{ borderColor: C.line }} className="mt-2 pt-2 border-t flex items-center gap-1 flex-wrap">
                  <span style={{ background: (m.acao.tipo === "ESCALAR" ? C.red : C.mint) + "22", color: m.acao.tipo === "ESCALAR" ? C.red : C.green }} className="text-xs font-bold px-2 py-0.5 rounded-full">
                    AÇÃO: {m.acao.tipo}
                  </span>
                  {m.acao.nova_janela && m.acao.nova_janela !== "null" && <span style={{ color: C.mute }} className="text-xs">{m.acao.nova_janela}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div style={{ color: C.mute }} className="text-xs">Agente digitando…</div>}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap gap-1 mt-2">
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => setInput(s)} style={{ borderColor: C.line, color: C.mute }} className="text-xs border rounded-full px-2 py-1 hover:opacity-80">{s}</button>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input value={input} onChange={(e2) => setInput(e2.target.value)} onKeyDown={(e2) => e2.key === "Enter" && send()}
          placeholder="Mensagem do destinatário…" style={{ borderColor: C.line }} className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none" />
        <button onClick={send} disabled={busy} style={{ background: C.green }} className="text-white rounded-lg px-4 flex items-center gap-1 text-sm font-semibold disabled:opacity-50">
          <Send size={15} /> Enviar
        </button>
      </div>
    </div>
  );
}
