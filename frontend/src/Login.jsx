import React, { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export default function Login() {
  const { session, configured } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const destino = loc.state?.from || "/";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [modo, setModo] = useState("senha");   // "senha" | "magic"
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [erro, setErro] = useState(null);

  if (!configured) {
    return (
      <PageWrapper>
        <h2 style={h2}>Login indisponível</h2>
        <p style={p}>
          O frontend não tem <code>VITE_SUPABASE_URL</code> ou
          <code> VITE_SUPABASE_ANON_KEY</code> configurados.
          Enquanto isso, cole um JWT em <code>localStorage.chamacarga_token</code>
          no console do navegador (fluxo legacy do Sprint 1).
        </p>
      </PageWrapper>
    );
  }
  if (session) return <Navigate to={destino} replace />;

  async function entrar(e) {
    e.preventDefault();
    setErro(null); setMsg(null); setSalvando(true);
    try {
      if (modo === "senha") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        nav(destino, { replace: true });
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + destino },
        });
        if (error) throw error;
        setMsg(`Link mágico enviado pra ${email}. Confira sua caixa.`);
      }
    } catch (e) {
      setErro(e.message || "Falha no login");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <PageWrapper>
      <h2 style={h2}>
        Entrar no <span style={{ color: "var(--accent)" }}>chamacarga</span>
      </h2>
      <p style={p}>
        Acesse o painel do 3PL. Cada usuário está vinculado a um cliente
        pelo claim <code>cliente_id</code> do JWT.
      </p>

      <form onSubmit={entrar} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        <label style={label}>
          Email
          <input type="email" required autoComplete="username"
                 value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
        </label>

        {modo === "senha" && (
          <label style={label}>
            Senha
            <input type="password" required autoComplete="current-password"
                   value={senha} onChange={(e) => setSenha(e.target.value)} style={input} />
          </label>
        )}

        {erro && (
          <div style={{
            background: "var(--crit-soft)", color: "var(--crit)",
            border: "1px solid color-mix(in oklab, var(--crit) 40%, var(--line))",
            padding: "8px 12px", borderRadius: 8, fontSize: 13,
          }}>{erro}</div>
        )}

        {msg && (
          <div style={{
            background: "var(--ok-soft)", color: "var(--ok)",
            border: "1px solid color-mix(in oklab, var(--ok) 40%, var(--line))",
            padding: "8px 12px", borderRadius: 8, fontSize: 13,
          }}>{msg}</div>
        )}

        <button type="submit" disabled={salvando || !email} style={{
          padding: 12, borderRadius: "var(--radius)",
          background: email ? "var(--ink)" : "var(--surface-2)",
          color: email ? "var(--bg)" : "var(--ink-3)",
          border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600,
          cursor: email ? "pointer" : "not-allowed", marginTop: 4,
        }}>
          {salvando
            ? "Entrando…"
            : modo === "senha" ? "Entrar" : "Enviar link mágico"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => { setModo(modo === "senha" ? "magic" : "senha"); setMsg(null); setErro(null); }}
        style={{
          background: "transparent", border: "none", color: "var(--ink-3)",
          fontFamily: "inherit", fontSize: 12, cursor: "pointer", marginTop: 14,
          textDecoration: "underline",
        }}>
        {modo === "senha" ? "Prefiro receber link mágico por email" : "Prefiro entrar com senha"}
      </button>
    </PageWrapper>
  );
}

const h2 = {
  fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26,
  letterSpacing: "-0.02em", margin: "0 0 8px", textWrap: "balance",
};
const p = { color: "var(--ink-2)", fontSize: 14, margin: 0 };
const label = {
  display: "flex", flexDirection: "column", gap: 4,
  fontSize: 12, color: "var(--ink-2)", letterSpacing: ".04em",
  textTransform: "uppercase", fontWeight: 500,
};
const input = {
  padding: "10px 12px", border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)", background: "var(--surface)",
  fontFamily: "var(--font-body)", fontSize: 15, color: "var(--ink)",
  textTransform: "none", letterSpacing: 0,
};

function PageWrapper({ children }) {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      display: "grid", placeItems: "center", padding: 20,
    }}>
      <div style={{
        maxWidth: 420, width: "100%",
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: 16, boxShadow: "var(--shadow)",
        padding: "36px 32px",
      }}>
        {children}
      </div>
    </div>
  );
}
