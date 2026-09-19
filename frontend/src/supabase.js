import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase singleton do frontend.
 * Precisa de VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY no ambiente
 * (Vercel → Environment Variables, ou .env.local em dev).
 *
 * Se as vars não vierem, exporta null e o app usa fallback de token
 * legacy (localStorage.chamacarga_token) até serem preenchidas.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (url && anon)
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,   // callback de magic link
      },
    })
  : null;

export const authConfigured = Boolean(supabase);
