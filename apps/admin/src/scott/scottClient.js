// Single entry point for every Scott REST call.
//
// Browser -> supabase.functions.invoke("scott-dashboard-masters") -> Scott REST API.
// The browser never talks to Scott directly (no CORS, and the upstream credentials
// live only in Supabase Edge Function secrets).
//
// Three layers of failure must be checked on every call — see `callScottDashboard`:
//   1. transport / invoke error   (edge responded non-2xx, or was unreachable)
//   2. envelope `ok === false`    (edge reached Scott, Scott answered non-2xx)
//   3. HTTP-200 application error (Scott answered 200 with { success: false })

import { supabase } from "../supabaseClient";
import { getEffectiveScottApiBaseUrl } from "./scottRuntime";

export const SCOTT_EDGE_FUNCTION = "scott-dashboard-masters";

/**
 * Resources the edge function will route. The edge keeps its own copy of this list
 * (an `ALLOWED` Set); adding a resource means editing BOTH and redeploying the edge fn.
 */
export const SCOTT_RESOURCES = Object.freeze([
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

/** Create/show responses may carry `<resource>_id` instead of `id`. */
export const SCOTT_ALT_ID_KEYS = Object.freeze([
  "authorized_brand_id",
  "profit_margin_id",
  "color_id",
  "fabric_id",
  "part_id",
  "add_on_id",
  "base_product_id",
  "asset_info_id",
  "promotion_id",
  "size_type_id",
  "sc_size_id",
  "base_product_type_id",
  "base_product_asset_info_id",
  "promotional_banner_id",
  "rmp_color_id",
  "rmp_size_id",
  "rmp_brand_id",
  "rmp_class_id",
  "rmp_sku_id",
  "rmp_category_id",
  "rmp_price_id",
  "rmp_price_type_id",
  "customer_id"
]);

/** Pagy conventions: `items` is the page size. */
export const SCOTT_DEFAULT_PAGE_SIZE = 20;
export const SCOTT_MAX_PAGE_SIZE = 10000;

/**
 * @typedef {"colors"|"profit_margins"|"authorized_brands"|"asset_infos"|"size_types"
 *   |"base_product_types"|"promotions"|"settings"|"sc_sizes"|"parts"|"add_ons"|"fabrics"
 *   |"base_products"|"promotional_banners"|"base_product_asset_infos"|"rmp_colors"
 *   |"rmp_sizes"|"rmp_brands"|"rmp_classes"|"rmp_skus"|"rmp_categories"|"rmp_prices"
 *   |"rmp_price_types"|"order_reports"|"rmp_order_reports"|"tailor_reports"|"orders"
 *   |"customers"|"inventory_reports"|"ready_made_products"} ScottResource
 */

/**
 * @typedef {Object} ScottFilePayload
 * @property {true} __base64File   sentinel the edge looks for
 * @property {string} data         base64, no `data:` prefix
 * @property {string} filename
 */

/**
 * @typedef {Object} ScottProxyPayload
 * @property {ScottResource} resource
 * @property {"GET"|"POST"|"PATCH"|"DELETE"} method
 * @property {string} [pathSuffix]   e.g. "123", "bulk_delete", "get_inventory"
 * @property {Record<string, string|number|boolean|string[]|undefined>} [query]
 * @property {Record<string, unknown>|null} [body]  plain fields + ScottFilePayload values
 * @property {"airtable_sync"} [settingsAction]     required when resource === "settings"
 * @property {string} [baseUrl]     explicit Scott base; must be in the edge allowlist
 */

/**
 * @typedef {Object} ScottPageParams
 * @property {number} page
 * @property {number} items  page size
 */

/**
 * @typedef {Object} ScottPaginatedMeta
 * @property {number} page
 * @property {number} pageSize
 * @property {number} totalCount
 * @property {number} totalPages
 * @property {boolean} totalCountIsExact  false => totals are lower bounds (no pagy in body)
 */

export function isScottResource(value) {
  return SCOTT_RESOURCES.includes(String(value ?? ""));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Error helpers (the three layers)
// ---------------------------------------------------------------------------

/**
 * Read the edge function's `{ error, reqId }` body off a non-2xx `Response`.
 *
 * The edge answers EVERY failure of its own (401 / 403 / 400 / 500) with real HTTP status
 * codes and that JSON body — `"Invalid credentials (Scott host: leaderboard.sagarfab.com).
 * Set Supabase Edge secrets …"` for an upstream auth failure, for instance. Without this the
 * user sees a bare `FunctionsHttpError: Edge Function returned a non-2xx status code` and the
 * only readable reason is in the DevTools network tab.
 *
 * Deliberately parses the text rather than trusting `content-type`: the message is worth
 * more than the header, and a body that is not JSON is still surfaced (trimmed) instead of
 * discarded.
 *
 * @param {unknown} res a `Response`
 * @returns {Promise<{message: string, reqId: string}|null>}
 */
async function readScottEdgeErrorBody(res) {
  if (!res || typeof res.text !== "function") return null;
  try {
    const source = typeof res.clone === "function" ? res.clone() : res;
    const raw = String((await source.text()) ?? "").trim();
    if (!raw) return null;

    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      // Not JSON (an HTML gateway page, a plain string): use it only if it is short enough
      // to be a message rather than a document.
      return raw.length <= 300 && !raw.startsWith("<") ? { message: raw, reqId: "" } : null;
    }

    if (!isPlainObject(body)) return null;
    const message = String(body.error ?? body.message ?? "").trim();
    if (!message) return null;
    return { message, reqId: String(body.reqId ?? "").trim() };
  } catch {
    return null;
  }
}

/** `"<message> (ref: <reqId>)"`, or just the message. */
function withReqId(message, reqId) {
  const text = String(message ?? "").trim();
  const ref = String(reqId ?? "").trim();
  return ref ? `${text} (ref: ${ref})` : text;
}

/**
 * Layer 1. supabase-js throws a `FunctionsHttpError` carrying the raw `Response`
 * on `error.context`. Duck-typed rather than importing `FunctionsHttpError` from
 * `@supabase/functions-js` — that package is only a transitive dependency here,
 * and `src/edgeFunctionUtils.js` already reads `error.context` the same way.
 *
 * @returns {Promise<{message: string, status: number|null, reqId: string}>}
 */
async function formatScottEdgeInvokeError(error) {
  const base = error?.message || "Edge function request failed";
  const res = error?.context;
  const status = Number.isFinite(res?.status) ? Number(res.status) : null;

  const parsed = await readScottEdgeErrorBody(res);
  if (!parsed) {
    // No readable body: still say what the status was, so "non-2xx" is at least a number.
    return { message: status ? `${base} (HTTP ${status})` : base, status, reqId: "" };
  }
  return { message: withReqId(parsed.message, parsed.reqId), status, reqId: parsed.reqId };
}

/**
 * The Error the UI ends up rendering — message plus the machine-readable bits, so a caller
 * that wants the request id does not have to re-parse the string.
 */
function scottError(message, { status = null, reqId = "" } = {}) {
  const err = new Error(String(message ?? "").trim() || "Scott request failed");
  if (status !== null) err.status = status;
  if (reqId) err.reqId = reqId;
  return err;
}

/**
 * Layer 3 detector. Scott signals validation/business failures with HTTP 200 and
 * `{ success: false, message }` — and `success` may be the *string* "false".
 * @returns {string|null} the failure message, or null when the body is fine
 */
function applicationFailureFromBody(candidate) {
  if (!isPlainObject(candidate)) return null;
  if (candidate.success !== false && candidate.success !== "false") return null;

  const message = String(candidate.message ?? "").trim();
  if (message) return message;
  const error = String(candidate.error ?? "").trim();
  if (error) return error;
  if (typeof candidate.status_code === "number") {
    return `Scott API error (${candidate.status_code})`;
  }
  return "Request failed";
}

/** Checks the top level, then one nested level (`body.data`). */
function throwIfScottApplicationErrorBody(body, upstreamUrl) {
  if (!isPlainObject(body)) return;

  const failure = applicationFailureFromBody(body) ?? applicationFailureFromBody(body.data);
  if (!failure) return;

  const url = String(upstreamUrl ?? "").trim();
  throw new Error(url ? `${failure} (${url})` : failure);
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * Proxy one Scott REST request through the edge function.
 *
 * @param {ScottProxyPayload} payload
 * @returns {Promise<{ upstreamStatus: number, body: unknown }>}
 * @throws {Error} on any of the three failure layers
 */
export async function callScottDashboard(payload) {
  const resource = payload?.resource;
  if (!isScottResource(resource)) {
    throw new Error(
      `Unknown Scott resource "${String(resource ?? "")}". ` +
        `Add it to SCOTT_RESOURCES in src/scott/scottClient.js and to the ALLOWED set in the ${SCOTT_EDGE_FUNCTION} edge function.`
    );
  }

  // Runtime default first so an explicit payload.baseUrl overrides it.
  const payloadWithBaseUrl = { baseUrl: getEffectiveScottApiBaseUrl(), ...payload };

  const { data, error } = await supabase.functions.invoke(SCOTT_EDGE_FUNCTION, {
    body: payloadWithBaseUrl
  });

  // --- Layer 1: transport / invoke ---
  // A non-2xx from the edge (auth failure, unallowlisted host, unhandled throw) arrives here
  // as a `FunctionsHttpError`; its `{ error, reqId }` body is the ONLY readable explanation,
  // so it is unwrapped onto the thrown message and reaches the list/report error card and
  // toast unchanged.
  if (error) {
    const { message, status, reqId } = await formatScottEdgeInvokeError(error);
    throw scottError(message, { status, reqId });
  }
  if (!isPlainObject(data)) {
    throw new Error(`Invalid response from ${SCOTT_EDGE_FUNCTION}`);
  }
  // A 200 that still carries `{ error, reqId }` (the edge's own soft failures).
  if (data.error) {
    throw scottError(withReqId(String(data.error), data.reqId), { reqId: String(data.reqId ?? "") });
  }

  // --- Layer 2: envelope ok === false (upstream answered non-2xx) ---
  if (data.ok === false) {
    const upstreamBody = data.body;
    const bodyMessage =
      isPlainObject(upstreamBody) && typeof upstreamBody.message === "string"
        ? upstreamBody.message.trim()
        : "";
    let message = bodyMessage || `Scott API error (${data.upstreamStatus ?? "unknown"})`;
    const upstreamUrl = typeof data.upstreamUrl === "string" ? data.upstreamUrl.trim() : "";
    if (upstreamUrl) message += ` (${upstreamUrl})`;
    throw new Error(message);
  }

  // --- Layer 3: HTTP 200 with { success: false } ---
  throwIfScottApplicationErrorBody(data.body, data.upstreamUrl);

  return { upstreamStatus: data.upstreamStatus ?? 200, body: data.body };
}

/**
 * One DELETE to `/{resource}/bulk_delete` with repeated `ids[]` form fields.
 *
 * The `ids[]` key name matters: the edge repeats array values under the literal key,
 * so Rails sees `ids[]=1&ids[]=2`.
 *
 * Caveat: the edge's `base_product_types` branch never attaches a DELETE body, so
 * `ids[]` would be silently dropped there — do not use this for that resource.
 *
 * @param {ScottResource} resource
 * @param {string[]} ids
 */
export async function callScottBulkDelete(resource, ids) {
  const list = (ids ?? []).map(normalizeId).filter(Boolean);
  if (list.length === 0) return;
  await callScottDashboard({
    resource,
    method: "DELETE",
    pathSuffix: "bulk_delete",
    body: { "ids[]": list }
  });
}

// ---------------------------------------------------------------------------
// File upload payload builders
// ---------------------------------------------------------------------------

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Wrap a File for the edge, which turns the sentinel back into a multipart Blob.
 * Base64 grows the payload ~33% — fine for images, avoid for large files.
 * @param {File} file
 * @returns {Promise<ScottFilePayload>}
 */
export async function fileToScottPayload(file) {
  const buffer = await file.arrayBuffer();
  return {
    __base64File: true,
    data: bytesToBase64(new Uint8Array(buffer)),
    filename: file.name
  };
}

/**
 * Same, but sourced from a URL the browser can read (e.g. a Supabase public URL).
 * The source must be CORS-readable — this fetch runs in the browser, not the edge.
 * @param {string} url
 * @param {string} [filename]
 * @returns {Promise<ScottFilePayload>}
 */
export async function urlToScottFile(url, filename = "upload.png") {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load image for upload");
  const buffer = await res.arrayBuffer();
  return {
    __base64File: true,
    data: bytesToBase64(new Uint8Array(buffer)),
    filename
  };
}

// ---------------------------------------------------------------------------
// Response-shape extraction
// ---------------------------------------------------------------------------

/** "" for null/undefined, else String(id). */
export function normalizeId(id) {
  return id === null || id === undefined ? "" : String(id);
}

function hasUsableValue(value) {
  return value !== null && value !== undefined && String(value) !== "";
}

/** A plain object with a usable `id` or any alternate primary key. */
export function looksLikeScottRecord(value) {
  if (!isPlainObject(value)) return false;
  if (hasUsableValue(value.id)) return true;
  return SCOTT_ALT_ID_KEYS.some((key) => hasUsableValue(value[key]));
}

/**
 * Copy an alternate primary key into `id` so downstream normalizers can rely on it.
 * @returns {Record<string, unknown>|null}
 */
export function withCanonicalPrimaryKey(row) {
  if (!isPlainObject(row)) return null;
  if (hasUsableValue(row.id)) return row;
  const altKey = SCOTT_ALT_ID_KEYS.find((key) => hasUsableValue(row[key]));
  return altKey ? { ...row, id: row[altKey] } : row;
}

/**
 * Pull a list out of any of the Rails-ish envelopes Scott returns.
 * Order matters — the first match wins.
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
export function extractRecords(raw) {
  // 1. Already a list.
  if (Array.isArray(raw)) return raw;
  if (!isPlainObject(raw)) return [];

  const data = raw.data;

  // 2. { data: { ... } }
  if (isPlainObject(data)) {
    // POST /api/v1/ready_made_products/get_inventory -> { data: { inventory: [...] } }
    if (Array.isArray(data.inventory)) return data.inventory;

    // Dashboard: { data: { colors: { data: [...], pagy: {...} } } }
    // v1:        { data: { profit_margins: [...] } }
    // First matching key wins; key order is insertion order.
    for (const value of Object.values(data)) {
      if (isPlainObject(value) && Array.isArray(value.data)) return value.data;
      if (Array.isArray(value)) return value;
    }
  }

  // 3. { data: [...] }
  if (Array.isArray(data)) return data;

  // 4. Belt-and-braces — the loop in step 2 already covers these key names.
  if (isPlainObject(data)) {
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.records)) return data.records;
  }

  // 5. { records: [...] }
  if (Array.isArray(raw.records)) return raw.records;

  return [];
}

const MAX_ENTITY_DEPTH = 14;

/** Depth-first search for the first record-shaped object. */
function deepExtractScottEntity(value, depth = 0) {
  if (depth > MAX_ENTITY_DEPTH) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepExtractScottEntity(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (!isPlainObject(value)) return null;
  if (looksLikeScottRecord(value)) return value;

  for (const child of Object.values(value)) {
    const found = deepExtractScottEntity(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Pull one entity out of a create/update/show response, canonicalizing its primary key.
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
export function extractScottEntity(body) {
  // 1. First row of any list shape.
  const [firstRecord] = extractRecords(body);
  if (looksLikeScottRecord(firstRecord)) return withCanonicalPrimaryKey(firstRecord);

  // 2. The body itself.
  if (looksLikeScottRecord(body)) return withCanonicalPrimaryKey(body);

  // 3. body.data, then a scan of its values.
  if (isPlainObject(body) && isPlainObject(body.data)) {
    const data = body.data;
    if (looksLikeScottRecord(data)) return withCanonicalPrimaryKey(data);

    for (const value of Object.values(data)) {
      if (looksLikeScottRecord(value)) return withCanonicalPrimaryKey(value);
      if (isPlainObject(value) && Array.isArray(value.data) && looksLikeScottRecord(value.data[0])) {
        return withCanonicalPrimaryKey(value.data[0]);
      }
    }

    const nested = deepExtractScottEntity(data);
    if (nested) return withCanonicalPrimaryKey(nested);
  }

  // 4. Deep scan of the whole body.
  const found = deepExtractScottEntity(body);
  return found ? withCanonicalPrimaryKey(found) : null;
}

// ---------------------------------------------------------------------------
// Pagy (Rails pagination) extraction & meta building
// ---------------------------------------------------------------------------

const MAX_PAGY_DEPTH = 20;

/**
 * Deep-search the body for the first Pagy object: `{ count, page, pages }` all numeric,
 * with `items` / `limit` captured when numeric. Objects only — arrays are skipped.
 *
 * Caveat: a body embedding an unrelated object with those three keys would be misread.
 *
 * @param {unknown} body
 * @returns {{count:number,page:number,pages:number,items?:number,limit?:number}|null}
 */
export function extractScottPagy(body, depth = 0) {
  if (depth > MAX_PAGY_DEPTH || !isPlainObject(body)) return null;

  if (
    typeof body.count === "number" &&
    typeof body.page === "number" &&
    typeof body.pages === "number"
  ) {
    const pagy = { count: body.count, page: body.page, pages: body.pages };
    if (typeof body.items === "number") pagy.items = body.items;
    if (typeof body.limit === "number") pagy.limit = body.limit;
    return pagy;
  }

  for (const value of Object.values(body)) {
    const found = extractScottPagy(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Clamp caller-supplied paging params.
 * @param {{page?:number, items?:number}} [overrides]
 * @returns {ScottPageParams}
 */
export function normalizeScottPageParams(overrides) {
  const rawItems = Number(overrides?.items ?? SCOTT_DEFAULT_PAGE_SIZE);
  const items = Number.isFinite(rawItems)
    ? Math.min(Math.max(Math.trunc(rawItems), 1), SCOTT_MAX_PAGE_SIZE)
    : SCOTT_DEFAULT_PAGE_SIZE;

  const rawPage = Number(overrides?.page ?? 1);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;

  return { page, items };
}

/**
 * Build pagination meta for one page of results.
 *
 * 1. Pagy present            -> exact totals straight from the body.
 * 2. No pagy, short page     -> this is the last page; totals are exact.
 * 3. No pagy, full page      -> lower bounds only; `totalCountIsExact` is false.
 *
 * @param {unknown} body      raw response body
 * @param {ScottPageParams} requested
 * @param {number} rowCount   rows actually returned for this page
 * @returns {ScottPaginatedMeta}
 */
export function buildScottPaginatedMeta(body, requested, rowCount) {
  const params = normalizeScottPageParams(requested);
  const pagy = extractScottPagy(body);

  if (pagy && typeof pagy.count === "number" && typeof pagy.pages === "number") {
    const pageSize = pagy.items ?? pagy.limit ?? params.items;
    return {
      page: pagy.page ?? params.page,
      pageSize,
      totalCount: pagy.count,
      totalPages: Math.max(1, pagy.pages),
      totalCountIsExact: true
    };
  }

  const rows = Number(rowCount) || 0;

  if (rows < params.items) {
    return {
      page: params.page,
      pageSize: params.items,
      totalCount: (params.page - 1) * params.items + rows,
      totalPages: Math.max(1, params.page),
      totalCountIsExact: true
    };
  }

  return {
    page: params.page,
    pageSize: params.items,
    totalCount: params.page * params.items,
    totalPages: params.page + 1,
    totalCountIsExact: false
  };
}

/**
 * @param {ScottPaginatedMeta & { data: unknown[] }} result
 * @returns {boolean}
 */
export function hasNextScottPage(result) {
  if (!result) return false;
  if (result.totalCountIsExact) return result.page < result.totalPages;
  return (result.data?.length ?? 0) === result.pageSize;
}
