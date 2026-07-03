import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, getSupabaseProjectRef } from "./deployEnvironmentUtils";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase env vars. Check .env configuration.");
}

export const activeSupabaseRef = getSupabaseProjectRef(supabaseUrl);

const allowProdInDev = import.meta.env.VITE_ALLOW_PROD_IN_DEV === "true";

if (import.meta.env.DEV && activeSupabaseRef === PRODUCTION_SUPABASE_REF && !allowProdInDev) {
  throw new Error(
    "[Scott Dashboard] DEV blocked: production Supabase is configured. " +
      "Use npm run dev with .env.development (staging) or set VITE_ALLOW_PROD_IN_DEV=true to override."
  );
}

if (import.meta.env.DEV && activeSupabaseRef === PRODUCTION_SUPABASE_REF && allowProdInDev) {
  console.warn(
    "[Scott Dashboard] DEV is connected to PRODUCTION Supabase (%s). Changes affect live users.",
    activeSupabaseRef
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
