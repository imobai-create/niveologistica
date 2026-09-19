import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase, authConfigured } from "./supabase";

const Ctx = createContext({
  session: null,
  loading: true,
  configured: false,
  signOut: async () => {},
});

/**
 * Provider que escuta a sessão do Supabase e disponibiliza pra árvore.
 * Se authConfigured=false (env vars faltando), degrada pra "sessão nula
 * e loading=false" — o app segue funcionando via fallback de token
 * legacy (localStorage.chamacarga_token) até o Supabase ser configurado.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (vivo) { setSession(data.session); setLoading(false); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (vivo) setSession(sess);
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ session, loading, configured: authConfigured, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}

/** Envolve rotas que exigem sessão. Redireciona pra /login preservando destino. */
export function RequireAuth({ children }) {
  const { session, loading, configured } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
                           color: "var(--ink-3)", fontSize: 14 }}>Carregando…</div>;
  }
  // Se não há Supabase configurado, deixa passar — o api.js cai no legacy token.
  // Isso preserva o modo de desenvolvimento em máquinas sem env do Supabase.
  if (!configured) return children;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}
