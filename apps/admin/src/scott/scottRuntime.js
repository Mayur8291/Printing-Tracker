// Scott REST API runtime target (staging <-> production), saved per browser.
//
// The browser only *chooses* the environment; the `scott-dashboard-masters` edge
// function re-checks the chosen base URL against its own allowlist before proxying,
// so a tampered localStorage value can never redirect traffic off these two hosts.
//
// NOTE: `src/runtimeEnv.js` already owns a separate, older localStorage key
// ("scott-rest-base-url", written by `src/components/EnvironmentSwitcherPopover.jsx`)
// that lets an admin type a free-text Scott REST base URL. This module deliberately
// does NOT read that key — the two settings are independent today. Wire them together
// in the UI layer if the popover should drive this transport.

/** @typedef {"staging" | "production"} ScottApiRuntimeTarget */

export const SCOTT_STAGING_BASE_URL = "http://64.227.186.227";
export const SCOTT_PRODUCTION_BASE_URL = "https://leaderboard.sagarfab.com";

/** localStorage key holding the chosen target. Values: "staging" | "production". */
export const SCOTT_API_TARGET_STORAGE_KEY = "scottone:scott-api-target";

/**
 * Same-tab change notification. The native `storage` event only fires in *other*
 * tabs, so a custom event is dispatched for the tab that made the change.
 */
export const SCOTT_API_RUNTIME_CHANGE_EVENT = "scottone:scott-api-runtime-change";

/** Build-time override (highest priority default when no target is stored). */
const BUILD_SCOTT_API_BASE_URL = String(import.meta.env.VITE_SCOTT_API_BASE_URL ?? "").trim();

/** Trim and strip one trailing slash so comparisons and the edge allowlist line up. */
export function normalizeScottBaseUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/$/, "");
}

/**
 * Base URLs the edge function will proxy to.
 * Keep in sync with the `SCOTT_API_BASE_URL_ALLOWLIST` edge secret.
 */
export const SCOTT_ALLOWED_API_BASE_URLS = Object.freeze([
  SCOTT_STAGING_BASE_URL,
  SCOTT_PRODUCTION_BASE_URL
]);

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Hostnames of the allowed base URLs — also the image-proxy allowlist. */
export const SCOTT_ALLOWED_API_HOSTS = Object.freeze(
  (() => {
    const hosts = SCOTT_ALLOWED_API_BASE_URLS.map(hostnameOf).filter(Boolean);
    const unique = Array.from(new Set(hosts));
    return unique.length > 0 ? unique : ["64.227.186.227", "leaderboard.sagarfab.com"];
  })()
);

export function isAllowedScottBaseUrl(url) {
  const normalized = normalizeScottBaseUrl(url);
  if (!normalized) return false;
  return SCOTT_ALLOWED_API_BASE_URLS.some((allowed) => normalizeScottBaseUrl(allowed) === normalized);
}

function safeLocalStorageGet(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the choice simply won't persist */
  }
}

/**
 * The target saved in this browser, or null when nothing valid is stored.
 * @returns {ScottApiRuntimeTarget | null}
 */
export function getStoredScottApiTarget() {
  const raw = safeLocalStorageGet(SCOTT_API_TARGET_STORAGE_KEY);
  return raw === "staging" || raw === "production" ? raw : null;
}

/**
 * Persist the target (pass null to clear) and notify this tab.
 * Callers should reload the page afterwards so cached list data is discarded.
 * @param {ScottApiRuntimeTarget | null} target
 */
export function setStoredScottApiTarget(target) {
  const next = target === "staging" || target === "production" ? target : null;
  safeLocalStorageSet(SCOTT_API_TARGET_STORAGE_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SCOTT_API_RUNTIME_CHANGE_EVENT));
  }
}

/**
 * Base URL every Scott call should use right now.
 * Priority: stored target -> VITE_SCOTT_API_BASE_URL -> staging.
 * @returns {string} normalized (no trailing slash)
 */
export function getEffectiveScottApiBaseUrl() {
  const stored = getStoredScottApiTarget();
  if (stored === "staging") return normalizeScottBaseUrl(SCOTT_STAGING_BASE_URL);
  if (stored === "production") return normalizeScottBaseUrl(SCOTT_PRODUCTION_BASE_URL);
  return normalizeScottBaseUrl(BUILD_SCOTT_API_BASE_URL || SCOTT_STAGING_BASE_URL);
}

/**
 * Which environment the effective base URL actually resolves to.
 * @returns {ScottApiRuntimeTarget}
 */
export function getResolvedScottApiTarget() {
  const effective = getEffectiveScottApiBaseUrl();
  return effective === normalizeScottBaseUrl(SCOTT_PRODUCTION_BASE_URL) ? "production" : "staging";
}

/**
 * Subscribe to target changes (same tab + other tabs). Returns an unsubscribe fn.
 * Shaped for `useSyncExternalStore(subscribeScottApiRuntime, getEffectiveScottApiBaseUrl, ...)`.
 * @param {() => void} onChange
 * @returns {() => void}
 */
export function subscribeScottApiRuntime(onChange) {
  if (typeof window === "undefined" || typeof onChange !== "function") {
    return () => {};
  }
  const handler = () => onChange();
  window.addEventListener(SCOTT_API_RUNTIME_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SCOTT_API_RUNTIME_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
