/** Production Supabase project ref (live data). */
export const PRODUCTION_SUPABASE_REF = "levwrmvqdntngeasrtnb";

export const DEFAULT_PRODUCTION_SITE_URL = "https://printingtracker.netlify.app";
/** Placeholder until a successful Netlify branch deploy exists — often 404 until then. */
export const DEFAULT_STAGING_SITE_URL = "https://develop--printingtracker.netlify.app";
export const DEFAULT_LOCAL_STAGING_DEV_URL = "http://127.0.0.1:5173/";
export const NETLIFY_SITE_SLUG = "printingtracker";
export const NETLIFY_DEPLOYS_URL = `https://app.netlify.com/sites/${NETLIFY_SITE_SLUG}/deploys`;

export const GITHUB_REPO_URL = "https://github.com/Mayur8291/Printing-Tracker";

export const PRODUCTION_RELEASE_COMMANDS = `cd "/Users/mayurmule/Downloads/Scott Dashboard"
git checkout develop
git pull origin develop
git checkout main
git pull origin main
git merge develop
git push origin main

# If you changed Supabase schema or edge functions (production project):
npx supabase link --project-ref levwrmvqdntngeasrtnb
npx supabase db push
npx supabase functions deploy admin-create-user
npx supabase functions deploy admin-delete-user
npx supabase functions deploy admin-reset-password`;

export function getSupabaseProjectRef(supabaseUrl) {
  const raw = String(supabaseUrl ?? "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname;
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

export function getDeployEnvironment() {
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  const ref = getSupabaseProjectRef(url);
  if (!ref) {
    return { kind: "unknown", ref: "", label: "Unknown backend", isProduction: false };
  }
  if (ref === PRODUCTION_SUPABASE_REF) {
    return { kind: "production", ref, label: "Production database", isProduction: true };
  }
  return { kind: "staging", ref, label: "Staging / test database", isProduction: false };
}

/** True when the app is opened on the live production Netlify URL (not branch/preview). */
export function isProductionSiteHost(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  let prodHost = "printingtracker.netlify.app";
  try {
    prodHost = new URL(getProductionSiteUrl()).hostname.toLowerCase();
  } catch {
    /* use default */
  }
  return host === prodHost;
}

/**
 * Admin → Test & deploy: staging branch deploy + local dev only.
 * Hidden on live production site and when local dev points at production DB.
 */
export function shouldShowAdminDeployTools() {
  const appEnv = String(import.meta.env.VITE_APP_ENV ?? "").trim().toLowerCase();
  if (appEnv === "production") return false;

  if (typeof window !== "undefined" && isProductionSiteHost(window.location.hostname)) {
    return false;
  }

  if (import.meta.env.DEV) {
    return !getDeployEnvironment().isProduction;
  }

  return true;
}

export function hasCustomStagingSiteUrl() {
  return Boolean(String(import.meta.env.VITE_STAGING_SITE_URL ?? "").trim());
}

export function getStagingSiteUrl() {
  const custom = String(import.meta.env.VITE_STAGING_SITE_URL ?? "").trim();
  return custom || DEFAULT_STAGING_SITE_URL;
}

export function getLocalStagingDevUrl() {
  const custom = String(import.meta.env.VITE_LOCAL_DEV_URL ?? "").trim();
  return custom || DEFAULT_LOCAL_STAGING_DEV_URL;
}

export function getProductionSiteUrl() {
  const custom = String(import.meta.env.VITE_PRODUCTION_SITE_URL ?? "").trim();
  return custom || DEFAULT_PRODUCTION_SITE_URL;
}
