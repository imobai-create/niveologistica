import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, RefreshCw } from "lucide-react";
import { dossiePublico } from "./api";

/* ---------- Mock enquanto backend não tem GET /d/:token (Sprint 3) ---------- */
function mockDossie() {
  return {
    id_curto: "PED-8842-A7F3",
    emitido_em: "27 ago 2026 · 09:14 BRT",
    hash: "b3a1…9e0c",
    titulo: "Enoxaparina 40 mg",
    veredito: "entrega concluída em conformidade parcial",
    resumo: "Custódia térmica registrada de ponta a ponta. Uma excursão documentada, detalhada abaixo, dentro do gatilho de análise do lote.",
    campos: [
      { k: "Embarcador", v: "Aché Laboratórios", plain: true },
      { k: "Transportador", v: "3PH Medicamentos", plain: true },
      { k: "Faixa contratada", v: "2,0 – 8,0 °C" },
      { k: "Recebedor", v: "M. Andrade", plain: true },
      { k: "Coleta", v: "27/08 · 06:22" },
      { k: "Entrega", v: "27/08 · 08:47", ok: true },
      { k: "Duração", v: "2 h 25 min" },
      { k: "Sensor · nº", v: "CX-041 · RBC até 03/27" },
    ],
    excursao: { pico: "8,4 °C", min_fora: 18 },
    eventos: [
      { t: "06:22", txt: "Coleta confirmada · CD Aché Guarulhos", tone: null },
      { t: "08:04", txt: "Início de excursão · porta aberta em cliente anterior", tone: "crit" },
      { t: "08:22", txt: "Retorno à faixa · 8,4 °C pico · 18 min fora", tone: null },
      { t: "08:47", txt: "Entrega concluída · POD assinado por M. Andrade", tone: "ok" },
    ],
  };
}

export default function DossiePublico() {
  const { token } = useParams();
  const [dossie, setDossie] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const data = await dossiePublico(token);
        if (vivo) setDossie(data);
      } catch (e) {
        if (!vivo) return;
        setErro(e.message || "erro");
        setDossie(mockDossie()); // fallback
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  if (!dossie) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--ink-3)" }}>
        <RefreshCw size={16} style={{ animation: "spin 1.2s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "40px 20px" }}>
      <style>{`
        @media (max-width: 720px) {
          .d-page { padding: 28px 22px !important; }
          .d-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 16px 20px !important; }
          .d-header { flex-direction: column; align-items: flex-start; gap: 12px; }
        }
        @media (max-width: 420px) {
          .d-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div className="d-page" style={{
        maxWidth: 720, margin: "0 auto",
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: 16, boxShadow: "var(--shadow)", padding: "48px 56px",
      }}>
        {/* header */}
        <div className="d-header" style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          gap: 24, paddingBottom: 20, borderBottom: "1px solid var(--line)", marginBottom: 32,
        }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 22,
                           letterSpacing: "-0.01em" }}>
              chama<span style={{ color: "var(--accent)" }}>carga</span>
            </div>
            <small style={{ display: "block", fontFamily: "var(--font-body)",
                             fontWeight: 400, fontSize: 11, color: "var(--ink-3)",
                             letterSpacing: ".1em", textTransform: "uppercase", marginTop: 4 }}>
              Dossiê de custódia
            </small>
          </div>
          <div style={{ textAlign: "right", fontFamily: "var(--font-mono)",
                        fontSize: 11, color: "var(--ink-3)", lineHeight: 1.6 }}>
            <div><strong style={{ color: "var(--ink)", fontWeight: 500 }}>#{dossie.id_curto}</strong></div>
            <div>emitido {dossie.emitido_em}</div>
            <div>hash · {dossie.hash}</div>
          </div>
        </div>

        {erro && (
          <div style={{
            background: "var(--amber-soft)", color: "var(--amber)",
            border: "1px solid color-mix(in oklab, var(--amber) 40%, var(--line))",
            borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 20,
          }}>
            modo demo — endpoint público ainda em Sprint 3
          </div>
        )}

        {/* title */}
        <h2 style={{
          fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 30,
          letterSpacing: "-0.02em", lineHeight: 1.2, textWrap: "balance", margin: "0 0 10px",
        }}>
          {dossie.titulo} · <em style={{ fontStyle: "italic", color: "var(--accent)" }}>{dossie.veredito}</em>
        </h2>
        <p style={{ color: "var(--ink-2)", margin: "0 0 32px", fontSize: 15 }}>{dossie.resumo}</p>

        {/* grid de campos */}
        <div className="d-grid" style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px 32px",
          padding: "20px 0", borderTop: "1px solid var(--line-2)",
          borderBottom: "1px solid var(--line-2)", marginBottom: 32,
        }}>
          {dossie.campos.map((f) => (
            <div key={f.k}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
                             color: "var(--ink-3)", marginBottom: 4, fontWeight: 500 }}>
                {f.k}
              </div>
              <div style={{
                fontSize: 15, fontWeight: 500,
                color: f.ok ? "var(--ok)" : "var(--ink)",
                fontFamily: f.plain ? "var(--font-body)" : "var(--font-mono)",
              }}>
                {f.v}
              </div>
            </div>
          ))}
        </div>

        {/* curva térmica */}
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 18,
                      margin: "0 0 12px", letterSpacing: "-0.01em" }}>
          Curva térmica
        </h3>
        <div style={{
          background: "var(--surface-2)", border: "1px solid var(--line-2)",
          borderRadius: 10, padding: 20, marginBottom: 32,
        }}>
          <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--ink-2)",
                         marginBottom: 10, flexWrap: "wrap" }}>
            <span>
              <i style={{ display: "inline-block", width: 16, height: 10, verticalAlign: "middle",
                         marginRight: 6, borderRadius: 2, background: "var(--ok)", opacity: 0.35 }} />
              faixa 2–8 °C
            </span>
            <span>
              <i style={{ display: "inline-block", width: 16, height: 2, verticalAlign: "middle",
                         marginRight: 6, borderRadius: 2, background: "var(--accent)" }} />
              leitura (10 s)
            </span>
            <span>
              <i style={{ display: "inline-block", width: 16, height: 2, verticalAlign: "middle",
                         marginRight: 6, borderRadius: 2, background: "var(--crit)" }} />
              excursão · {dossie.excursao.min_fora} min
            </span>
          </div>
          <svg width="100%" height="200" viewBox="0 0 600 200" preserveAspectRatio="none"
               aria-label="Curva térmica ao longo da entrega" style={{ display: "block" }}>
            <g stroke="var(--line-2)" strokeWidth=".8">
              <line x1="0" y1="40" x2="600" y2="40" />
              <line x1="0" y1="80" x2="600" y2="80" />
              <line x1="0" y1="120" x2="600" y2="120" />
              <line x1="0" y1="160" x2="600" y2="160" />
            </g>
            <rect x="0" y="60" width="600" height="80" fill="var(--ok-soft)" />
            <line x1="0" y1="60" x2="600" y2="60" stroke="var(--ok)" strokeWidth=".8" strokeDasharray="3 4" />
            <line x1="0" y1="140" x2="600" y2="140" stroke="var(--ok)" strokeWidth=".8" strokeDasharray="3 4" />
            <g fontFamily="JetBrains Mono" fontSize="10" fill="var(--ink-3)">
              <text x="6" y="60" dy="-2">8 °C</text>
              <text x="6" y="140" dy="-2">2 °C</text>
              <text x="6" y="185">{dossie.eventos[0]?.t}</text>
              <text x="560" y="185">{dossie.eventos.at(-1)?.t}</text>
              <text x="230" y="185">excursão 08:04–08:22</text>
            </g>
            <path d="M0 100 L 30 102 L 60 98 L 90 100 L 120 95 L 150 96 L 180 92 L 210 90 L 240 88 L 270 92 L 300 90 L 320 88"
                  fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M320 88 L 340 70 L 360 55 L 380 42 L 400 38 L 420 44 L 440 55 L 460 68"
                  fill="none" stroke="var(--crit)" strokeWidth="2" strokeLinejoin="round" />
            <path d="M460 68 L 490 78 L 520 90 L 550 95 L 580 96 L 600 95"
                  fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="400" cy="38" r="4" fill="var(--crit)" />
            <text x="408" y="34" fontFamily="JetBrains Mono" fontSize="10" fill="var(--crit)">
              pico {dossie.excursao.pico}
            </text>
          </svg>
        </div>

        {/* eventos */}
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 18,
                      margin: "0 0 12px", letterSpacing: "-0.01em" }}>
          Eventos registrados
        </h3>
        <div style={{
          border: "1px solid var(--line-2)", borderRadius: 10, overflow: "hidden", marginBottom: 32,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {dossie.eventos.map((e, i) => (
                <tr key={i} style={i < dossie.eventos.length - 1
                    ? { borderBottom: "1px solid var(--line-2)" } : {}}>
                  <td style={{
                    padding: "10px 16px", color: "var(--ink-3)",
                    fontFamily: "var(--font-mono)", fontSize: 12, width: 80,
                  }}>
                    {e.t}
                  </td>
                  <td style={{
                    padding: "10px 16px",
                    color: e.tone === "crit" ? "var(--crit)"
                         : e.tone === "ok" ? "var(--ok)" : "var(--ink)",
                  }}>
                    {e.txt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* footer com selo */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 24, paddingTop: 28, borderTop: "1px solid var(--line)",
          color: "var(--ink-2)", fontSize: 12, flexWrap: "wrap",
        }}>
          <div style={{ maxWidth: 380 }}>
            Este dossiê é imutável. Cada linha do log é encadeada por hash e verificável em{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
              chamacarga.app/verify
            </span>.
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            padding: "10px 14px 10px 12px",
            border: "1px solid color-mix(in oklab, var(--accent) 40%, var(--line))",
            borderRadius: 100,
            background: "color-mix(in oklab, var(--accent) 6%, var(--surface))",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "var(--accent)", color: "#fff",
              display: "grid", placeItems: "center",
            }}>
              <Check size={14} strokeWidth={2.4} />
            </div>
            <div style={{
              fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 13,
              color: "var(--accent-ink)", lineHeight: 1.2,
            }}>
              custódia registrada
              <small style={{
                display: "block", fontFamily: "var(--font-body)", fontWeight: 400,
                fontSize: 10, color: "var(--ink-3)", letterSpacing: ".08em",
                textTransform: "uppercase", marginTop: 2,
              }}>
                chamacarga · RDC 430/653
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
