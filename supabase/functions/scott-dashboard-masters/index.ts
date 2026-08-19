// Deploy: supabase functions deploy scott-dashboard-masters
// Secrets (npx supabase secrets set K=V — staging project first):
//   SCOTT_AUTH_EMAIL              required  Scott login email (production + default for any host)
//   SCOTT_AUTH_PASSWORD           required  Scott login password
//   SCOTT_STAGING_AUTH_EMAIL      optional  staging login email; falls back to SCOTT_AUTH_EMAIL
//   SCOTT_STAGING_AUTH_PASSWORD   optional  staging login password; unset => staging reuses the default pair
//   SCOTT_STAGING_HOSTS           optional  comma-separated staging hostnames (default: 64.227.186.227)
//   SCOTT_API_BASE_URL            optional  fallback base URL when the client sends none / a non-allowlisted one
//   SCOTT_API_BASE_URL_ALLOWLIST  optional  comma-separated allowed client base URLs
//                                           (default: http://64.227.186.227, https://leaderboard.sagarfab.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the hosted platform.
//
// Proxies the Scott International dashboard REST API server-side — the browser cannot call it
// directly (no CORS) and the Scott service-account credentials must never reach the client.
//
// Scott hosts most "dashboard masters" under /api/v1/{resource}; the Postman-documented
// /api/dashboard/v1/... namespace is not mounted for every resource (it 404s), hence the routing
// table in resolveScottUpstream() plus the runtime 404 dashboard -> v1 fallback below.
//
// Every proxied call answers HTTP 200 with { ok, upstreamStatus, upstreamUrl, body }; only
// edge-level failures (401 / 403 / 400 / 500) use real HTTP status codes with { error, reqId }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

type ScottMethod = "GET" | "POST" | "PATCH" | "DELETE";

type ScottQueryValue = string | number | boolean | string[] | undefined;

type ScottQuery = Record<string, ScottQueryValue>;

/** Sentinel the client wraps around an uploaded file (base64 in, multipart out). */
interface ScottFilePayload {
  __base64File: true;
  data: string;
  filename: string;
}

interface ScottProxyPayload {
  resource?: string;
  method?: ScottMethod;
  pathSuffix?: string;
  query?: ScottQuery;
  body?: Record<string, unknown> | null;
  settingsAction?: "airtable_sync";
  baseUrl?: string;
}

/**
 * Resource allowlist. NOTE: this list is duplicated in the browser transport module —
 * adding a resource means editing both places and redeploying this function.
 */
const ALLOWED = new Set<string>([
  "colors",
  "profit_margins",
  "authorized_brands",
  "asset_infos",
  "size_types",
  "base_product_types",
  "promotions",
  "settings",
  "sc_sizes",
  "parts",
  "add_ons",
  "fabrics",
  "base_products",
  "promotional_banners",
  "base_product_asset_infos",
  "rmp_colors",
  "rmp_sizes",
  "rmp_brands",
  "rmp_classes",
  "rmp_skus",
  "rmp_categories",
  "rmp_prices",
  "rmp_price_types",
  "order_reports",
  "rmp_order_reports",
  "tailor_reports",
  "orders",
  "customers",
  "inventory_reports",
  "ready_made_products"
]);

/** Masters that live under /api/v1/ instead of the dashboard namespace. */
const V1_MASTERS = new Set<string>(["profit_margins", "promotions", "size_types"]);

const DEFAULT_BASE_URL_ALLOWLIST = ["http://64.227.186.227", "https://leaderboard.sagarfab.com"];
const DEFAULT_STAGING_HOSTS = ["64.227.186.227"];

/** Nested report routes that have no /api/v1/ twin — never retried on a 404. */
const NO_V1_FALLBACK = ["/rmp_skus/inventory", "/inventory_reports", "/ready_made_products/"];

// ---------------------------------------------------------------------------
// Base URL resolution
// ---------------------------------------------------------------------------

function stripTrailingSlash(value: unknown): string {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function baseUrlAllowlist(): string[] {
  const raw = (Deno.env.get("SCOTT_API_BASE_URL_ALLOWLIST") ?? "").trim();
  const list = raw ? raw.split(",") : DEFAULT_BASE_URL_ALLOWLIST;
  return list.map(stripTrailingSlash).filter(Boolean);
}

/** Client-supplied baseUrl is honored only on an exact allowlist match (after trim + slash strip). */
function allowlistedBaseUrl(requested: unknown): string | null {
  const candidate = stripTrailingSlash(requested);
  if (!candidate) return null;
  return baseUrlAllowlist().includes(candidate) ? candidate : null;
}

function safeHost(value: string): string {
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).host;
  } catch {
    return "(invalid-base-url)";
  }
}

function stagingHosts(): string[] {
  const raw = (Deno.env.get("SCOTT_STAGING_HOSTS") ?? "").trim();
  const list = raw ? raw.split(",") : DEFAULT_STAGING_HOSTS;
  return list.map((host) => host.trim()).filter(Boolean);
}

function isStagingHost(hostKey: string): boolean {
  return stagingHosts().includes(safeHost(hostKey));
}

// ---------------------------------------------------------------------------
// Scott upstream authentication (login + per-host token cache)
// ---------------------------------------------------------------------------

/** Module-level cache; survives warm invocations of this isolate only. */
const cachedScottByHost = new Map<string, { token: string; exp: number }>();

function decodeJwtExp(token: string): number {
  try {
    const segment = token.split(".")[1] ?? "";
    if (!segment) return 0;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

interface ScottLoginCredentials {
  email: string;
  password: string;
  staging: boolean;
  stagingPasswordSet: boolean;
}

function resolveScottLoginCredentials(hostKey: string): ScottLoginCredentials {
  const email = (Deno.env.get("SCOTT_AUTH_EMAIL") ?? "").trim();
  const password = Deno.env.get("SCOTT_AUTH_PASSWORD") ?? "";
  if (!email || !password) {
    throw new Error(
      "Scott credentials not configured. Set SCOTT_AUTH_EMAIL and SCOTT_AUTH_PASSWORD in Supabase Edge Function secrets."
    );
  }

  const staging = isStagingHost(hostKey);
  const stagingPassword = (Deno.env.get("SCOTT_STAGING_AUTH_PASSWORD") ?? "").trim();
  const stagingPasswordSet = staging && Boolean(stagingPassword);

  if (stagingPasswordSet) {
    return {
      email: (Deno.env.get("SCOTT_STAGING_AUTH_EMAIL") ?? "").trim() || email,
      password: stagingPassword,
      staging,
      stagingPasswordSet
    };
  }

  return { email, password, staging, stagingPasswordSet };
}

function loginFailureHint(creds: ScottLoginCredentials): string {
  if (!creds.staging) {
    return " Set Supabase Edge secrets SCOTT_AUTH_EMAIL and SCOTT_AUTH_PASSWORD for this host.";
  }
  if (creds.stagingPasswordSet) {
    return " Staging: check SCOTT_STAGING_AUTH_PASSWORD is correct; if staging uses another user, set SCOTT_STAGING_AUTH_EMAIL.";
  }
  return " Staging: set Supabase secret SCOTT_STAGING_AUTH_PASSWORD (must differ from production when using both).";
}

async function getScottAuthToken(baseUrl: string, reqId: string): Promise<string> {
  const hostKey = stripTrailingSlash(baseUrl);
  const now = Math.floor(Date.now() / 1000);

  // 120 s early-refresh margin so a token never expires mid-flight.
  const cached = cachedScottByHost.get(hostKey);
  if (cached && cached.exp > now + 120) return cached.token;

  const creds = resolveScottLoginCredentials(hostKey);
  const loginRes = await fetch(`${hostKey}/api/v1/auth/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: creds.email, password: creds.password }).toString()
  });

  const loginJson = (await loginRes.json().catch(() => ({}))) as {
    success?: unknown;
    message?: unknown;
    data?: { user?: { auth_token?: unknown } };
  };
  const token = loginJson?.data?.user?.auth_token;

  if (!loginJson?.success || !token) {
    const host = safeHost(hostKey);
    const message = (typeof loginJson?.message === "string" && loginJson.message) || "Scott authentication failed";
    console.error(
      JSON.stringify({
        msg: "scott-dashboard-masters login failed",
        reqId,
        host,
        upstreamStatus: loginRes.status
      })
    );
    throw new Error(`${message} (Scott host: ${host}).${loginFailureHint(creds)}`);
  }

  const scottToken = String(token);
  const exp = decodeJwtExp(scottToken) || now + 3600;
  cachedScottByHost.set(hostKey, { token: scottToken, exp });
  return scottToken;
}

// ---------------------------------------------------------------------------
// Query-string & FormData builders
// ---------------------------------------------------------------------------

/** Arrays become repeated PLAIN keys (k=a&k=b), not k[]=a — diverges from the form-data convention. */
function buildQueryString(query?: ScottQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function isScottFilePayload(value: unknown): value is ScottFilePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScottFilePayload>;
  return candidate.__base64File === true && typeof candidate.data === "string";
}

function base64ToBlob(payload: ScottFilePayload): Blob {
  const binary = atob(payload.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

/**
 * Every non-GET upstream request is multipart/form-data — this function never sends JSON to Scott.
 * Rails-style flattening: arrays repeat their key verbatim, so a caller naming a key 'ids[]'
 * produces ids[]=1&ids[]=2. Nested plain objects cannot be encoded and are dropped silently.
 */
function bodyToFormData(body: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(body ?? {})) {
    if (value === undefined || value === null) continue;
    if (isScottFilePayload(value)) {
      fd.append(key, base64ToBlob(value), value.filename);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) fd.append(key, String(item));
      continue;
    }
    if (typeof value === "object") continue;
    fd.append(key, String(value));
  }
  return fd;
}

/** Scalars only — used for the base_product_types list POST. */
function queryToFormData(query?: ScottQuery): FormData {
  const fd = new FormData();
  if (!query) return fd;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) continue;
    fd.append(key, String(value));
  }
  return fd;
}

// ---------------------------------------------------------------------------
// Upstream URL routing
// ---------------------------------------------------------------------------

interface ResolvedUpstream {
  url: string;
  fetchMethod: ScottMethod;
  fetchBody?: FormData;
}

function resolveScottUpstream(
  baseUrl: string,
  resource: string,
  method: ScottMethod,
  pathSuffix: string | undefined,
  query: ScottQuery | undefined,
  body: Record<string, unknown> | null | undefined,
  settingsAction: string | undefined
): ResolvedUpstream {
  const suffix = pathSuffix ? `/${String(pathSuffix).replace(/^\//, "")}` : "";
  const qs = buildQueryString(query);
  const hasBody = Boolean(body) && typeof body === "object" && Object.keys(body as Record<string, unknown>).length > 0;
  // This is how bulk_delete ships its ids[] — a DELETE that legitimately carries a body.
  const needsBodyOnDelete = method === "DELETE" && hasBody;
  const writeBody = (): FormData => bodyToFormData(body ?? {});

  // settings — forced PATCH on the airtable_sync endpoint regardless of the client's method.
  if (resource === "settings") {
    if (settingsAction !== "airtable_sync") {
      throw new Error("settings resource requires settingsAction: airtable_sync");
    }
    return {
      url: `${baseUrl}/api/dashboard/v1/settings/airtable_sync${qs}`,
      fetchMethod: "PATCH",
      fetchBody: writeBody()
    };
  }

  // ready_made_products and its inventory_reports alias — always POST to
  // /api/v1/ready_made_products/{action}, with the query merged INTO the form body (not the URL).
  if (resource === "ready_made_products" || resource === "inventory_reports") {
    const action = pathSuffix ? String(pathSuffix).replace(/^\//, "") : "get_inventory";
    return {
      url: `${baseUrl}/api/v1/ready_made_products/${action}`,
      fetchMethod: "POST",
      fetchBody: bodyToFormData({ ...(body ?? {}), ...(query ?? {}) })
    };
  }

  if (resource === "base_product_types") {
    // The list has no GET upstream — it is a POST under the products namespace.
    if (!suffix && method === "GET") {
      return {
        url: `${baseUrl}/api/v1/products/base_product_types`,
        fetchMethod: "POST",
        fetchBody: queryToFormData(query)
      };
    }
    // Create (no suffix) and show/update/delete (with suffix) both live in the dashboard namespace.
    // Documented quirk, preserved deliberately: this branch attaches a body for writes only
    // (PATCH/POST), so a DELETE /base_product_types/bulk_delete silently drops its ids[] payload.
    // Latent — the app never bulk-deletes base_product_types; do not rely on it working here.
    return {
      url: `${baseUrl}/api/dashboard/v1/base_product_types${suffix}${qs}`,
      fetchMethod: method,
      fetchBody: method === "PATCH" || method === "POST" ? writeBody() : undefined
    };
  }

  if (V1_MASTERS.has(resource)) {
    // bulk_delete exists only in the dashboard namespace, even for these v1-routed masters.
    const url =
      pathSuffix === "bulk_delete"
        ? `${baseUrl}/api/dashboard/v1/${resource}${suffix}${qs}`
        : `${baseUrl}/api/v1/${resource}${suffix}${qs}`;
    return {
      url,
      fetchMethod: method,
      fetchBody: method === "POST" || method === "PATCH" || needsBodyOnDelete ? writeBody() : undefined
    };
  }

  // Default: the dashboard namespace, with the 404 -> /api/v1/ fallback as a safety net.
  return {
    url: `${baseUrl}/api/dashboard/v1/${resource}${suffix}${qs}`,
    fetchMethod: method,
    fetchBody: method === "POST" || method === "PATCH" || needsBodyOnDelete ? writeBody() : undefined
  };
}

function fallbackUrlIfDashboard404(url: string): string | null {
  if (NO_V1_FALLBACK.some((fragment) => url.includes(fragment))) return null;
  if (!url.includes("/api/dashboard/v1/")) return null;
  return url.replace("/api/dashboard/v1/", "/api/v1/");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function newReqId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return String(Date.now());
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const reqId = newReqId();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Server misconfiguration: missing Supabase env");
    }

    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!jwt) {
      return jsonResponse({ error: "Unauthorized: sign in and try again", reqId }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const {
      data: { user },
      error: userErr
    } = await adminClient.auth.getUser(jwt);
    if (userErr || !user) {
      const detail = userErr?.message ?? "Invalid or expired session";
      return jsonResponse({ error: `Unauthorized: ${detail}`, reqId }, 401);
    }

    const { data: prof } = await adminClient
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    const emailForAdminCheck = (user.email ?? prof?.email ?? "").trim().toLowerCase();
    let listedAsAdmin = false;
    if (emailForAdminCheck) {
      const { data: adminRow } = await adminClient
        .from("admin_emails")
        .select("email")
        .ilike("email", emailForAdminCheck)
        .maybeSingle();
      listedAsAdmin = Boolean(adminRow);
    }

    const isAdmin = prof?.role === "admin" || listedAsAdmin;
    if (!isAdmin) {
      return jsonResponse(
        {
          error:
            "Forbidden: only admins can call the Scott API. Add your email to admin_emails or set profiles.role to admin.",
          reqId
        },
        403
      );
    }

    const payload = (await req.json()) as ScottProxyPayload;
    const {
      resource,
      pathSuffix,
      query,
      body,
      settingsAction,
      baseUrl: requestedBaseUrl
    } = payload;
    const method: ScottMethod = payload.method ?? "GET";

    if (!resource || !ALLOWED.has(resource)) {
      return jsonResponse({ error: "Invalid resource" }, 400);
    }

    const baseUrl = allowlistedBaseUrl(requestedBaseUrl) ?? stripTrailingSlash(Deno.env.get("SCOTT_API_BASE_URL"));
    if (!baseUrl) {
      return jsonResponse(
        { error: "SCOTT_API_BASE_URL not configured or client baseUrl not allowlisted", reqId },
        500
      );
    }

    console.log(
      JSON.stringify({
        msg: "scott-dashboard-masters proxy",
        reqId,
        userId: user.id,
        resource,
        method,
        host: safeHost(baseUrl)
      })
    );

    const scottToken = await getScottAuthToken(baseUrl, reqId);
    const resolved = resolveScottUpstream(baseUrl, resource, method, pathSuffix, query, body, settingsAction);

    // Scott expects the RAW JWT here — adding a "Bearer " prefix breaks upstream auth.
    // No other headers: FormData sets its own multipart Content-Type with the boundary.
    const headers: Record<string, string> = { Authorization: scottToken };

    const fetchUpstream = (url: string): Promise<Response> => {
      if (resolved.fetchMethod === "GET") {
        return fetch(url, { method: "GET", headers });
      }
      if (resolved.fetchMethod === "DELETE" && !resolved.fetchBody) {
        return fetch(url, { method: "DELETE", headers });
      }
      return fetch(url, {
        method: resolved.fetchMethod,
        headers,
        body: resolved.fetchBody ?? bodyToFormData(body ?? {})
      });
    };

    let upstreamUrl = resolved.url;
    let scottRes = await fetchUpstream(upstreamUrl);

    if (scottRes.status === 404) {
      const fallbackUrl = fallbackUrlIfDashboard404(upstreamUrl);
      if (fallbackUrl) {
        upstreamUrl = fallbackUrl;
        scottRes = await fetchUpstream(upstreamUrl);
      }
    }

    const text = await scottRes.text();
    let parsedBody: unknown = null;
    if (text) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = { raw: text };
      }
    }

    // Always HTTP 200 — upstream failures are signalled by ok:false inside the envelope.
    return jsonResponse({
      ok: scottRes.ok,
      upstreamStatus: scottRes.status,
      upstreamUrl,
      body: parsedBody
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "scott-dashboard-masters unhandled", reqId, error: message }));
    return jsonResponse({ error: message, reqId }, 500);
  }
});
