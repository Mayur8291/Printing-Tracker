// Runtime environment selection (admin header toggle) + browser-saved integration settings.
// Anon keys are public by design (already shipped in the JS bundle); the service role
// key and webhook secret never leave Supabase Edge Function secrets.

import { PRODUCTION_SUPABASE_REF, getSupabaseProjectRef } from "./deployEnvironmentUtils";

const ENV_OVERRIDE_KEY = "scott-dashboard-env-override"; // "staging" | "production"
const SCOTT_REST_BASE_URL_KEY = "scott-rest-base-url";

const ENV_PAIRS = {
  staging: {
    url: String(import.meta.env.VITE_SUPABASE_URL_STAGING ?? "").trim() ||
      "https://scvojtvgnkmbupvyslmb.supabase.co",
    anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY_STAGING ?? "").trim() ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjdm9qdHZnbmttYnVwdnlzbG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0ODc5MTEsImV4cCI6MjA5NjA2MzkxMX0.KZnx-YcQwK6VRiHmeNcWa90jeeZxmZNSO48W5O__MNA"
  },
  production: {
    url: String(import.meta.env.VITE_SUPABASE_URL_PRODUCTION ?? "").trim() ||
      "https://levwrmvqdntngeasrtnb.supabase.co",
    anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY_PRODUCTION ?? "").trim() ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxldndybXZxZG50bmdlYXNydG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzc2MTksImV4cCI6MjA4OTkxMzYxOX0.XL-pWvr9Pv3MivWj20BzbzqcQULhucWJ2diBj3fHgTk"
  }
};

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — override simply won't persist */
  }
}

/** Environment of the build itself (from .env files), before any override. */
export function getBuildEnvironment() {
  const ref = getSupabaseProjectRef(import.meta.env.VITE_SUPABASE_URL ?? "");
  return ref === PRODUCTION_SUPABASE_REF ? "production" : "staging";
}

export function getEnvironmentOverride() {
  const raw = safeLocalStorageGet(ENV_OVERRIDE_KEY);
  return raw === "staging" || raw === "production" ? raw : null;
}

/**
 * Set (or clear with null) the environment override. Caller must reload the page —
 * the Supabase client is created once at module load.
 */
export function setEnvironmentOverride(env) {
  safeLocalStorageSet(ENV_OVERRIDE_KEY, env);
}

/**
 * Active Supabase target after applying the browser override.
 * An explicit admin override may select production even in dev (the header
 * toggle confirms first); the build-env misconfig guard stays in supabaseClient.
 */
export function getRuntimeEnv() {
  const buildEnv = getBuildEnvironment();
  const override = getEnvironmentOverride();

  if (override === "production" && import.meta.env.DEV) {
    console.warn(
      "[Scott Dashboard] DEV is connected to PRODUCTION via the admin header toggle. " +
        "Changes affect live users. Switch back to staging when done."
    );
  }

  const env = override ?? buildEnv;
  const pair = ENV_PAIRS[env];
  return {
    env,
    url: pair.url,
    anonKey: pair.anonKey,
    isOverride: override != null && override !== buildEnv,
    buildEnv
  };
}

export function getScottRestBaseUrl() {
  return String(safeLocalStorageGet(SCOTT_REST_BASE_URL_KEY) ?? "").trim();
}

export function setScottRestBaseUrl(url) {
  const cleaned = String(url ?? "").trim().replace(/\/+$/, "");
  safeLocalStorageSet(SCOTT_REST_BASE_URL_KEY, cleaned || null);
  return cleaned;
}
