// Scott image URL handling.
//
// Why this exists: Scott staging serves images over HTTP only. On an https page the
// browser blocks mixed-content `<img src="http://...">`, so those URLs are rewritten
// through a same-origin proxy. Dev builds and http pages render the direct URL.
//
// ---------------------------------------------------------------------------
// DEPLOYMENT: THE PROXY ROUTE DOES NOT EXIST YET
// ---------------------------------------------------------------------------
// The upstream ScottOne project served this from a Vercel serverless function
// (`api/scott-image-proxy.ts`). This app deploys on NETLIFY, which has no
// file-based `api/` routing, so `SCOTT_IMAGE_PROXY_PATH` currently resolves to a
// 404 until someone adds:
//
//   1. `netlify/functions/scott-image-proxy.js` — reads `?url=`, rejects hosts
//      outside SCOTT_ALLOWED_API_HOSTS (403) and non-http(s) protocols (400),
//      fetches with `Accept: image/*,*/*;q=0.8` and no auth header (Scott images
//      are public), passes `Content-Type` through, and sets
//      `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`.
//   2. A redirect in `netlify.toml`:
//        [[redirects]]
//          from = "/api/scott-image-proxy"
//          to   = "/.netlify/functions/scott-image-proxy"
//          status = 200
//   3. A matching `server.proxy` entry in `vite.config.js` for local dev, alongside
//      the existing `/api/picklist` entry (only needed if you test PROD behavior locally).
//
// Change `SCOTT_IMAGE_PROXY_PATH` below if the route lands somewhere else — it is the
// only place the path is written.
//
// Security note: the proxy is unauthenticated by design. The host allowlist is the
// only guard, and it is what makes it SSRF-safe.

import { SCOTT_ALLOWED_API_HOSTS, getEffectiveScottApiBaseUrl } from "./scottRuntime";

/** Same-origin path the rewriter points at. See the deployment note above. */
export const SCOTT_IMAGE_PROXY_PATH = "/api/scott-image-proxy";

/** Hosts whose images may be relayed. Mirrors the Scott API base-URL allowlist. */
export const SCOTT_IMAGE_ALLOWED_HOSTS = SCOTT_ALLOWED_API_HOSTS;

/** Build the proxy URL for an already-absolute image URL. */
export function buildScottImageProxyUrl(absoluteUrl) {
  return `${SCOTT_IMAGE_PROXY_PATH}?url=${encodeURIComponent(absoluteUrl)}`;
}

/**
 * Resolve a possibly-relative Scott image path against the active Scott base URL.
 * @param {string} trimmedUrl already trimmed, non-empty
 * @returns {string|null} absolute URL, or null when it cannot be parsed
 */
function absolutizeScottImageUrl(trimmedUrl) {
  if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl;
  const base = getEffectiveScottApiBaseUrl();
  const path = trimmedUrl.startsWith("/") ? trimmedUrl : `/${trimmedUrl}`;
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

/**
 * Rewrite a Scott image URL through the same-origin proxy when the browser would
 * otherwise block it as mixed content.
 *
 * Returns the absolute URL untouched when ANY of these hold:
 *   - not a production build (`import.meta.env.PROD` is false)
 *   - no `window` (SSR / non-browser)
 *   - the page is not served over https
 *   - the target is not `http:`
 *   - the target hostname is not in the allowlist
 *
 * Falls back to the trimmed input (not the original string) when the URL cannot be parsed.
 *
 * @param {string|undefined} url absolute URL, or a path relative to the Scott base
 * @returns {string|undefined}
 */
export function proxifyScottImageUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return undefined;
  if (/^(data|blob):/i.test(trimmed)) return trimmed;

  const absolute = absolutizeScottImageUrl(trimmed);
  if (!absolute) return trimmed;

  if (!import.meta.env.PROD) return absolute;
  if (typeof window === "undefined") return absolute;
  if (window.location?.protocol !== "https:") return absolute;

  let target;
  try {
    target = new URL(absolute);
  } catch {
    return trimmed;
  }

  if (target.protocol !== "http:") return absolute;
  if (!SCOTT_IMAGE_ALLOWED_HOSTS.includes(target.hostname)) return absolute;

  return buildScottImageProxyUrl(absolute);
}
