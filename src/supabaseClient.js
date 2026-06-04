import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, getSupabaseProjectRef } from "./deployEnvironmentUtils";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase env vars. Check .env configuration.");
}

export const activeSupabaseRef = getSupabaseProjectRef(supabaseUrl);

if (import.meta.env.DEV && activeSupabaseRef === PRODUCTION_SUPABASE_REF) {
  console.warn(
    "[Scott Dashboard] DEV is connected to PRODUCTION Supabase (%s). " +
      "Use npm run dev (.env.development) or npm run dev:staging (.env.staging).",
    activeSupabaseRef
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
