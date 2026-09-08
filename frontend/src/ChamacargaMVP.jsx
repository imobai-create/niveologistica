import React, { useEffect, useMemo, useState } from "react";
import {
  Home, Package, Truck, FileText, Users, ShieldCheck,
  ArrowRight, Phone, ExternalLink, RotateCcw, AlertTriangle,
} from "lucide-react";
import { listarPainel } from "./api";

/* --------- seed local (fallback se backend cai) --------- */
function seedEntregas() {
  return [
    {
      id: "seed-1",
      cliente: "Aché · Enoxaparina 40 mg",
      ref: "PED-8842",
      faixa: "refrigerado_2_8", temp_min: 2, temp_max: 8,
      status: "em_rota", motorista: "Rafael Silva", logger: "BLE-CX-041",
      janela_i: null, janela_f: null,
      houve_excursao: true,
      _tag: "crit", _msg: "excursão 8,4 °C · 18 min fora",
      _sla_min: null, _rota: "Barueri → Osasco",
    },
    {
      id: "seed-2",
      cliente: "EMS · Insulina glargina",
      ref: "PED-8851",
      faixa: "refrigerado_2_8", temp_min: 2, temp_max: 8,
      status: "criada", motorista: null, logger: null,
      janela_i: null, janela_f: null,
      houve_excursao: false,
      _tag: "warn", _msg: "SLA fecha em 47 min",
      _sla_min: 47, _rota: "CD Guarulhos → Alphaville",
    },
    {
      id: "seed-3",
      cliente: "Sanofi · Vacina influenza",
      ref: "PED-8837",
      faixa: "refrigerado_2_8", temp_min: 2, temp_max: 8,
      status: "em_rota", motorista: "João Ramos", logger: "BLE-CX-041",
      janela_i: null, janela_f: null,
      houve_excursao: false,
      _tag: "crit", _msg: "sensor mudo há 12 min",
      _sla_min: null, _rota: "Distribuidor → Hospital Sírio",
    },
  ];
}

/* --------- derivar prioridade + msg a partir do shape real --------- */
function classificar(e) {
  if (e._tag) return e; // já classificado (seed)
  let tag = null, msg = "em rota";
  if (e.houve_excursao) { tag = "crit"; msg = "excursão térmica registrada"; }
  else if (!e.motorista || e.motorista === "—") { tag = "warn"; msg = "sem motorista"; }
  else if (e.status === "em_rota") { tag = "rota"; msg = "em rota"; }
  return { ...e, _tag: tag, _msg: msg };
}

/* --------- data helpers --------- */
const hojeStr = () => new Date().toLocaleDateString("pt-BR", {
  weekday: "long", day: "numeric", month: "long",
});
const agoraStr = () => new Date().toLocaleTimeString("pt-BR", {
  hour: "2-digit", minute: "2-digit",
});

/* --------- componentes --------- */

function Kpi({ label, valor, sub, tone = "ok", children }) {
  const stripe = { ok: "var(--accent)", warn: "var(--amber)", crit: "var(--crit)" }[tone];
  const border = tone === "ok" ? "var(--line)"
    : `color-mix(in oklab, ${stripe} 45%, var(--line))`;
  return (
    <div style={{ position: "relative", background: "var(--surface)", border: `1px solid ${border}`,
                  borderRadius: "var(--radius)", padding: 16 }}>
      <div style={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 3,
                    background: stripe, borderRadius: 3 }} />
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em",
                    color: "var(--ink-3)", fontWeight: 500, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 32,
                    lineHeight: 1, letterSpacing: "-0.02em" }}>
        {valor}
        {sub && <small style={{ fontSize: 15, color: "var(--ink-3)", fontWeight: 400,
                                marginLeft: 4 }}>{sub}</small>}
      </div>
      {children && <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8 }}>{children}</div>}
    </div>
  );
}

function Pill({ tone = "calm", children }) {
  const palette = {
    crit: { bg: "var(--crit-soft)", fg: "var(--crit)" },
    warn: { bg: "var(--amber-soft)", fg: "var(--amber)" },
    rota: { bg: "var(--ok-soft)", fg: "var(--ok)" },
    calm: { bg: "var(--surface-2)", fg: "var(--ink-2)" },
  }[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5,
                   fontSize: 11, padding: "2px 8px", borderRadius: 100,
                   fontWeight: 500, letterSpacing: ".02em",
                   background: palette.bg, color: palette.fg,
                   border: tone === "calm" ? "1px solid var(--line-2)" : "none" }}>
      {tone !== "calm" && <span style={{ width: 6, height: 6, borderRadius: 999,
                                          background: "currentColor", display: "inline-block" }} />}
      {children}
    </span>
  );
}

function Sparkline({ tone = "rota" }) {
  const color = { crit: "var(--crit)", warn: "var(--amber)", rota: "var(--accent)" }[tone];
  if (tone === "crit") {
    return (
      <svg width="120" height="42" viewBox="0 0 120 42" aria-hidden="true">
        <rect x="0" y="14" width="120" height="14" fill="var(--ok-soft)" />
        <line x1="0" y1="14" x2="120" y2="14" stroke="var(--ok)" strokeWidth=".5" strokeDasharray="2 3" />
        <line x1="0" y1="28" x2="120" y2="28" stroke="var(--ok)" strokeWidth=".5" strokeDasharray="2 3" />
        <path d="M0 22 L15 21 L30 20 L45 19 L60 18 L72 15 L84 10 L96 6 L108 4 L120 3"
              fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="120" cy="3" r="2.5" fill={color} />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg width="80" height="42" viewBox="0 0 80 42" aria-hidden="true">
        <text x="0" y="14" fontFamily="JetBrains Mono" fontSize="9" fill="var(--ink-3)">janela</text>
        <rect x="0" y="20" width="80" height="8" rx="2" fill="var(--line-2)" />
        <rect x="0" y="20" width="58" height="8" rx="2" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="120" height="42" viewBox="0 0 120 42" aria-hidden="true">
      <rect x="0" y="14" width="120" height="14" fill="var(--ok-soft)" />
      <path d="M0 22 L20 22 L40 21 L60 22 L80 21 L100 22 L120 22"
            fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function DeliveryCard({ e }) {
  const tone = e._tag || "rota";
  const stripe = { crit: "var(--crit)", warn: "var(--amber)", rota: "var(--accent)" }[tone];
  return (
    <article style={{
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: "var(--radius)", padding: "14px 16px 14px 20px",
      display: "grid", gridTemplateColumns: "1fr auto", gap: "14px 20px",
      alignItems: "center", position: "relative",
    }}>
      <div style={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 3,
                    background: stripe, borderRadius: 3 }} />
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
            {e.cliente || "—"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
            #{e.ref || e.id?.slice(0, 6)}
          </span>
          {e._tag && <Pill tone={tone}>{e._msg}</Pill>}
          {(!e.motorista || e.motorista === "—") && e._tag !== "warn" && (
            <Pill tone="calm">sem motorista</Pill>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 4,
                      color: "var(--ink-2)", fontSize: 13 }}>
          {e.motorista && e.motorista !== "—" && (
            <span><span style={{ color: "var(--ink-3)" }}>motorista </span>{e.motorista}</span>
          )}
          {(e._rota || e.endereco) && (
            <span><span style={{ color: "var(--ink-3)" }}>{e._rota ? "rota" : "destino"} </span>
              {e._rota || e.endereco}</span>
          )}
          {e.temp_min != null && e.temp_max != null && (
            <span><span style={{ color: "var(--ink-3)" }}>faixa </span>
              {e.temp_min}–{e.temp_max} °C</span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkline tone={tone} />
      </div>
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        {tone === "warn" && (
          <button className="btn-warn">
            <ArrowRight size={14} /> Chamar reforço (rede)
          </button>
        )}
        {tone === "crit" && e.motorista && (
          <button className="btn-plain">
            <Phone size={14} /> Contatar motorista
          </button>
        )}
        <button className="btn-primary">
          Abrir entrega <ExternalLink size={14} />
        </button>
      </div>
    </article>
  );
}

function Sidebar() {
  const items = [
    { icon: Home, label: "Hoje", active: true },
    { icon: Package, label: "Entregas" },
    { icon: Truck, label: "Frota" },
    { icon: FileText, label: "Dossiês" },
  ];
  const items2 = [
    { icon: Users, label: "Rede de reforço" },
    { icon: ShieldCheck, label: "Compliance" },
  ];
  return (
    <aside style={{
      background: "var(--surface-2)", borderRight: "1px solid var(--line-2)",
      padding: "22px 16px", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 20,
                    color: "var(--ink)", padding: "0 8px 22px 8px", letterSpacing: "-0.01em" }}>
        chama<span style={{ color: "var(--accent)" }}>carga</span>
      </div>
      {items.map((it) => <NavItem key={it.label} {...it} />)}
      <div style={{ height: 1, background: "var(--line-2)", margin: "14px 4px" }} />
      {items2.map((it) => <NavItem key={it.label} {...it} />)}
      <div style={{ marginTop: "auto", padding: "10px 8px", fontSize: 12,
                    color: "var(--ink-3)", borderTop: "1px solid var(--line-2)" }}>
        <strong style={{ display: "block", color: "var(--ink-2)", fontWeight: 500,
                          fontSize: 13, marginBottom: 2 }}>
          3PH Medicamentos
        </strong>
        Ana Ramos · operações
      </div>
    </aside>
  );
}

function NavItem({ icon: Icon, label, active }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", borderRadius: "var(--radius-sm)",
      fontSize: 14, color: active ? "var(--ink)" : "var(--ink-2)",
      background: active ? "var(--surface)" : "transparent",
      fontWeight: active ? 500 : 400, cursor: "default",
    }}>
      <Icon size={16} strokeWidth={1.8} style={{ opacity: 0.85 }} />
      {label}
    </div>
  );
}

/* --------- ChamacargaMVP (painel home) --------- */
export default function ChamacargaMVP() {
  const [entregas, setEntregas] = useState(null);
  const [erro, setErro] = useState(null);
  const [ts, setTs] = useState(agoraStr());

  const carregar = async () => {
    setErro(null);
    try {
      const list = await listarPainel();
      setEntregas(list.map(classificar));
    } catch (e) {
      setErro("backend indisponível — usando dados de demo");
      setEntregas(seedEntregas());
    } finally {
      setTs(agoraStr());
    }
  };
  useEffect(() => { carregar(); }, []);

  const atencaoAgora = useMemo(
    () => (entregas || []).filter((e) => e._tag),
    [entregas],
  );

  const kpiCrit = useMemo(
    () => (entregas || []).filter((e) => e.houve_excursao || (e._tag === "crit")).length,
    [entregas],
  );
  const kpiWarn = useMemo(
    () => (entregas || []).filter((e) => e._tag === "warn").length,
    [entregas],
  );
  const kpiOk = useMemo(
    () => (entregas || []).filter((e) => e.status === "entregue").length,
    [entregas],
  );

  return (
    <>
      <style>{`
        .btn-primary, .btn-warn, .btn-plain {
          font-family: var(--font-body); font-size: 13px; font-weight: 500;
          padding: 8px 14px; border-radius: 8px; cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .btn-primary { background: var(--ink); color: var(--bg); border: 1px solid var(--ink); }
        .btn-primary:hover { background: var(--accent-ink); border-color: var(--accent-ink); }
        .btn-plain { background: var(--surface); color: var(--ink); border: 1px solid var(--line); }
        .btn-plain:hover { border-color: var(--ink-3); }
        .btn-warn {
          background: color-mix(in oklab, var(--amber) 12%, var(--surface));
          border: 1px solid color-mix(in oklab, var(--amber) 45%, var(--line));
          color: var(--amber);
        }
        .btn-warn:hover { border-color: var(--amber); }
        @media (max-width: 900px) {
          .app-shell { grid-template-columns: 1fr !important; }
          .app-side { display: none !important; }
          .kpis { grid-template-columns: 1fr !important; }
          .card-actions { justify-content: flex-start !important; }
          .card-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="app-shell" style={{
        display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh",
        background: "var(--bg)", color: "var(--ink)",
      }}>
        <div className="app-side" style={{ display: "contents" }}>
          <Sidebar />
        </div>

        <main style={{ padding: "28px 32px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400,
                          fontSize: 26, letterSpacing: "-0.015em", margin: 0 }}>
              {hojeStr()}
            </h2>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
              {ts} BRT
            </span>
            <button
              onClick={carregar}
              title="atualizar"
              style={{ marginLeft: "auto", background: "transparent", border: 0,
                        color: "var(--ink-3)", cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <RotateCcw size={13} /> atualizar
            </button>
          </div>

          <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "0 0 24px" }}>
            {entregas?.length ?? 0} entregas na rua.
            {atencaoAgora.length > 0
              ? ` ${atencaoAgora.length} precisa${atencaoAgora.length === 1 ? "" : "m"} de você agora.`
              : " Nenhuma precisa da sua atenção agora."}
          </p>

          {erro && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 14px", marginBottom: 20,
              background: "var(--amber-soft)", color: "var(--amber)",
              border: "1px solid color-mix(in oklab, var(--amber) 40%, var(--line))",
              borderRadius: 8, fontSize: 13,
            }}>
              <AlertTriangle size={14} /> {erro}
            </div>
          )}

          <div className="kpis" style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
            marginBottom: 28,
          }}>
            <Kpi label="Em risco térmico" valor={kpiCrit} sub={`de ${entregas?.length ?? 0}`} tone="crit">
              {kpiCrit === 0 ? "Nenhum sensor fora de faixa." : "Excursão registrada em pelo menos uma entrega ativa."}
            </Kpi>
            <Kpi label="SLA em risco" valor={kpiWarn} sub="entregas" tone="warn">
              {kpiWarn === 0 ? "Todas com motorista atribuído." : "Sem motorista atribuído — considere reforço."}
            </Kpi>
            <Kpi label="Fechadas hoje" valor={kpiOk} sub="com dossiê" tone="ok">
              {kpiOk === 0 ? "Ainda sem entregas concluídas hoje." : "Todas seguiram a faixa térmica."}
            </Kpi>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 17,
                          letterSpacing: "-0.01em", margin: 0 }}>
              Atenção agora
            </h3>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
              {atencaoAgora.length} · por urgência
            </span>
          </div>

          <div className="card-grid" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {atencaoAgora.length === 0 && (
              <div style={{
                padding: "32px 20px", textAlign: "center", color: "var(--ink-3)",
                border: "1px dashed var(--line)", borderRadius: "var(--radius)",
                background: "var(--surface)",
              }}>
                {entregas ? "Nenhuma entrega precisando de ação. Bom trabalho." : "Carregando…"}
              </div>
            )}
            {atencaoAgora.map((e) => <DeliveryCard key={e.id} e={e} />)}
          </div>
        </main>
      </div>
    </>
  );
}
