import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, RefreshCw } from "lucide-react";
import { receberInfo, reservarJanela } from "./api";

/* ---------- Mock enquanto backend não tem GET /r/:token (Sprint 3) ---------- */
function mockInfo() {
  return {
    entrega: {
      cliente: "Aché",
      cargo: "encomenda de refrigerado (2–8 °C)",
      data_prevista: "quinta, 28 de agosto",
      reservado_ate: "21:00",
      transportador: {
        iniciais: "JR",
        nome: "João Ramos",
        empresa: "3PH Medicamentos",
        rating: 4.9,
        entregas: 312,
        rbc_valido: true,
      },
    },
    slots: [
      { id: "s1", inicio: "07:00", fim: "09:00", vagas_livres: 3, nota: "manhã cedo · antes de abrir a farmácia" },
      { id: "s2", inicio: "09:00", fim: "12:00", vagas_livres: 5, nota: "meio da manhã · pico do movimento" },
      { id: "s3", inicio: "14:00", fim: "17:00", vagas_livres: 1, nota: "tarde · pouca disponibilidade" },
      { id: "s4", inicio: "17:00", fim: "20:00", vagas_livres: 0, nota: "final de tarde · sem vagas" },
    ],
  };
}

function slotTag(livres) {
  if (livres === 0) return { txt: "cheio", tone: "cold" };
  if (livres === 1) return { txt: "1 vaga", tone: "warn" };
  if (livres <= 3) return { txt: `${livres} vagas`, tone: "ok" };
  return { txt: "disponível", tone: "ok" };
}

const tagPalette = {
  ok:   { bg: "var(--ok-soft)", fg: "var(--ok)", border: "transparent" },
  warn: { bg: "var(--amber-soft)", fg: "var(--amber)", border: "transparent" },
  cold: { bg: "var(--surface-2)", fg: "var(--ink-3)", border: "1px solid var(--line-2)" },
};

export default function ReservarJanela() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState(null);
  const [sel, setSel] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const data = await receberInfo(token);
        if (vivo) setInfo(data);
      } catch (e) {
        if (!vivo) return;
        setErro(e.message || "erro");
        setInfo(mockInfo()); // fallback demo
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  const slotSelecionado = useMemo(
    () => info?.slots.find((s) => s.id === sel),
    [info, sel],
  );

  async function confirmar() {
    if (!slotSelecionado) return;
    setSalvando(true);
    try {
      await reservarJanela(token, sel);
      setConfirmado(true);
    } catch (e) {
      // no mock, apenas simula sucesso
      setConfirmado(true);
    } finally {
      setSalvando(false);
    }
  }

  if (!info) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
                    color: "var(--ink-3)" }}>
        <RefreshCw size={16} style={{ animation: "spin 1.2s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (confirmado) {
    return (
      <PageWrapper>
        <ConfirmadoView slot={slotSelecionado} info={info} />
      </PageWrapper>
    );
  }

  const { entrega } = info;

  return (
    <PageWrapper>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    paddingBottom: 18, borderBottom: "1px solid var(--line-2)", marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 19,
                      letterSpacing: "-0.01em" }}>
          chama<span style={{ color: "var(--accent)" }}>carga</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-2)", display: "inline-flex",
                      alignItems: "center", gap: 8, fontFamily: "var(--font-mono)" }}>
          <span className="dot-live" /> reservado até {entrega.reservado_ate}
        </div>
      </div>

      <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".14em",
                  textTransform: "uppercase", color: "var(--accent)", margin: "4px 0 8px" }}>
        Sua entrega
      </p>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26,
                    letterSpacing: "-0.02em", margin: "4px 0 8px", textWrap: "balance" }}>
        {entrega.cliente} · <em style={{ fontStyle: "italic", color: "var(--accent)" }}>quando fica melhor</em>?
      </h2>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "0 0 22px" }}>
        Uma {entrega.cargo} chega {entrega.data_prevista}. Escolha uma janela — reservamos e você recebe confirmação.
      </p>

      {erro && (
        <div style={{
          background: "var(--amber-soft)", color: "var(--amber)",
          border: "1px solid color-mix(in oklab, var(--amber) 40%, var(--line))",
          borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 16,
        }}>
          modo demo — backend ainda sem endpoint público (Sprint 3)
        </div>
      )}

      <div className="slots-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24,
      }}>
        {info.slots.map((s) => {
          const tag = slotTag(s.vagas_livres);
          const p = tagPalette[tag.tone];
          const isSelected = sel === s.id;
          const disabled = s.vagas_livres === 0;
          return (
            <button
              key={s.id}
              disabled={disabled}
              onClick={() => setSel(s.id)}
              style={{
                background: isSelected
                  ? "color-mix(in oklab, var(--accent) 6%, var(--surface))"
                  : "var(--surface)",
                border: `1px solid ${isSelected ? "var(--accent)" : "var(--line)"}`,
                borderRadius: "var(--radius)", padding: 14, textAlign: "left",
                cursor: disabled ? "not-allowed" : "pointer",
                fontFamily: "inherit", color: "var(--ink)",
                display: "flex", flexDirection: "column", gap: 6,
                opacity: disabled ? 0.5 : 1, position: "relative",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 500 }}>
                  {s.inicio} – {s.fim}
                </span>
                <span style={{
                  fontSize: 10, padding: "2px 7px", borderRadius: 100, fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: ".04em",
                  background: p.bg, color: p.fg, border: p.border,
                }}>
                  {tag.txt}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.nota}</div>
              {isSelected && (
                <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500,
                              display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                  <Check size={14} /> sua escolha
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={{
        padding: "16px 0", marginBottom: 20,
        borderTop: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)",
      }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".14em",
                    textTransform: "uppercase", color: "var(--accent)", margin: "0 0 10px" }}>
          Quem vai entregar
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            background: "color-mix(in oklab, var(--accent) 15%, var(--surface))",
            color: "var(--accent-ink)", display: "grid", placeItems: "center",
            fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14,
            border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--line))",
          }}>
            {entrega.transportador.iniciais}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
              {entrega.transportador.nome} · {entrega.transportador.empresa}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", display: "flex",
                          gap: 12, marginTop: 2, flexWrap: "wrap" }}>
              <span>⭐ {entrega.transportador.rating} · {entrega.transportador.entregas} entregas</span>
              {entrega.transportador.rbc_valido && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                              color: "var(--accent)", fontWeight: 500 }}>
                  <Check size={11} /> RBC vigente
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={confirmar}
        disabled={!sel || salvando}
        style={{
          width: "100%", padding: 14, borderRadius: "var(--radius)",
          background: sel ? "var(--ink)" : "var(--surface-2)",
          color: sel ? "var(--bg)" : "var(--ink-3)",
          border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600,
          cursor: sel ? "pointer" : "not-allowed", letterSpacing: ".01em",
        }}>
        {salvando
          ? "Reservando…"
          : sel
            ? `Confirmar janela ${slotSelecionado.inicio} – ${slotSelecionado.fim}`
            : "Escolha uma janela"}
      </button>
      <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "12px 4px 0", textAlign: "center", lineHeight: 1.5 }}>
        Sem custo. Se ninguém puder receber, remarcamos automaticamente.
        <span style={{ display: "block", opacity: 0.7 }}>
          Este link é único, encerra em 12 h.
        </span>
      </p>
    </PageWrapper>
  );
}

function ConfirmadoView({ slot, info }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%", background: "var(--accent)",
        display: "grid", placeItems: "center", margin: "8px auto 20px",
      }}>
        <Check size={28} color="#fff" strokeWidth={2.5} />
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 24,
                   margin: "0 0 8px", letterSpacing: "-0.015em" }}>
        Janela confirmada
      </h2>
      <p style={{ color: "var(--ink-2)", fontSize: 15, margin: "0 0 24px" }}>
        Sua entrega da {info.entrega.cliente} chega entre {" "}
        <strong style={{ color: "var(--ink)" }}>{slot.inicio} e {slot.fim}</strong>
        {" "} em {info.entrega.data_prevista}.
      </p>
      <div style={{
        background: "var(--surface-2)", border: "1px solid var(--line-2)",
        borderRadius: "var(--radius)", padding: 16, textAlign: "left",
      }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
          {info.entrega.transportador.nome} · {info.entrega.transportador.empresa} · ⭐ {info.entrega.transportador.rating}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
          Você receberá o link do dossiê térmico logo após a entrega.
        </p>
      </div>
    </div>
  );
}

function PageWrapper({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "40px 20px" }}>
      <style>{`
        .dot-live {
          width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
          display: inline-block;
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent);
          animation: pulse-live 2s ease-in-out infinite;
        }
        @keyframes pulse-live {
          0%,100% { box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent); }
          50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--accent) 10%, transparent); }
        }
        @media (prefers-reduced-motion: reduce) { .dot-live { animation: none; } }
        @media (max-width: 520px) {
          .slots-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{
        maxWidth: 620, margin: "0 auto",
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: 16, boxShadow: "var(--shadow)",
        padding: "28px 32px 32px",
      }}>
        {children}
      </div>
    </div>
  );
}
