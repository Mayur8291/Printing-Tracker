import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, getSupabaseProjectRef } from "./deployEnvironmentUtils";
import { getRuntimeEnv } from "./runtimeEnv";

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase env vars. Check .env configuration.");
}

// May differ from build env when an admin flipped the header Staging/Production toggle.
const { url: supabaseUrl, anonKey: supabaseAnonKey } = getRuntimeEnv();

export const activeSupabaseRef = getSupabaseProjectRef(supabaseUrl);

const allowProdInDev = import.meta.env.VITE_ALLOW_PROD_IN_DEV === "true";

// Guard the BUILD env only: .env.development must never default to production.
// An explicit admin header toggle (runtime override) is allowed and warned in runtimeEnv.
const buildSupabaseRef = getSupabaseProjectRef(import.meta.env.VITE_SUPABASE_URL);

if (import.meta.env.DEV && buildSupabaseRef === PRODUCTION_SUPABASE_REF && !allowProdInDev) {
  throw new Error(
    "[Scott Dashboard] DEV blocked: production Supabase is configured in .env. " +
      "Use npm run dev with .env.development (staging) or set VITE_ALLOW_PROD_IN_DEV=true to override."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
