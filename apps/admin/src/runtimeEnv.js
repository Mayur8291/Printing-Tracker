// Runtime environment selection (all-persona header toggle) + browser-saved integration settings.
// Anon keys are public by design (already shipped in the JS bundle); the service role
// key and webhook secret never leave Supabase Edge Function secrets.

import { PRODUCTION_SUPABASE_REF, getSupabaseProjectRef } from "./deployEnvironmentUtils";

const ENV_OVERRIDE_KEY = "scott-dashboard-env-override"; // retired sticky choice; cleared on read
const ENV_SESSION_KEY = "scott-dashboard-env-session"; // "staging" | "production" for this tab only
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

export function getEnvironmentConfig(environment) {
  if (environment !== "staging" && environment !== "production") throw new Error("Unknown environment");
  return { ...ENV_PAIRS[environment] };
}

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

function safeSessionGet(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key, value) {
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable — this tab stays on production */
  }
}

/** Environment of the build itself (from .env files), before any override. */
export function getBuildEnvironment() {
  const ref = getSupabaseProjectRef(import.meta.env.VITE_SUPABASE_URL ?? "");
  return ref === PRODUCTION_SUPABASE_REF ? "production" : "staging";
}

export function getEnvironmentOverride() {
  // A saved localStorage choice must not decide the next login.
  safeLocalStorageSet(ENV_OVERRIDE_KEY, null);
  const raw = safeSessionGet(ENV_SESSION_KEY);
  return raw === "staging" || raw === "production" ? raw : null;
}

/**
 * Remember staging or production for this tab only. Caller must reload —
 * the Supabase client is created once at module load.
 */
export function setEnvironmentOverride(env) {
  safeLocalStorageSet(ENV_OVERRIDE_KEY, null);
  safeSessionSet(ENV_SESSION_KEY, env === "staging" || env === "production" ? env : null);
}

/** Next open of the link, including the login screen, uses production. */
export function clearEnvironmentOverride() {
  setEnvironmentOverride(null);
}

/**
 * Opening the link uses production credentials. Staging applies only after an
 * admin switches to it in this tab. The build-env guard stays in supabaseClient.
 */
export function getRuntimeEnv() {
  const buildEnv = getBuildEnvironment();
  const override = getEnvironmentOverride();
  const env = override === "staging" ? "staging" : "production";

  if (env === "production" && import.meta.env.DEV) {
    console.warn(
      "[Scott Dashboard] This tab is using PRODUCTION credentials. " +
        "Live data is in use. An admin can switch this tab to staging."
    );
  }

  const pair = ENV_PAIRS[env];
  return {
    env,
    url: pair.url,
    anonKey: pair.anonKey,
    isOverride: env !== buildEnv,
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
