import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, getSupabaseProjectRef } from "./deployEnvironmentUtils";
import { getRuntimeEnv } from "./runtimeEnv";

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase env vars. Check .env configuration.");
}

// Production unless an admin has switched this tab to staging.
const { url: supabaseUrl, anonKey: supabaseAnonKey } = getRuntimeEnv();

export const activeSupabaseRef = getSupabaseProjectRef(supabaseUrl);

const allowProdInDev = import.meta.env.VITE_ALLOW_PROD_IN_DEV === "true";

// Guard the BUILD env only: .env.development must never list the production ref.
// Login still uses production credentials unless this tab was switched to staging.
const buildSupabaseRef = getSupabaseProjectRef(import.meta.env.VITE_SUPABASE_URL);

if (import.meta.env.DEV && buildSupabaseRef === PRODUCTION_SUPABASE_REF && !allowProdInDev) {
  throw new Error(
    "[Scott Dashboard] DEV blocked: production Supabase is configured in .env. " +
      "Use npm run dev with .env.development (staging) or set VITE_ALLOW_PROD_IN_DEV=true to override."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
