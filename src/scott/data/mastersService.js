// Generic CRUD factory for every Scott "master" entity.
//
// One config in -> one service out. The config owns everything entity-specific
// (exact wire field names, string coercions, soft-delete semantics, image fields,
// relation sub-endpoints); this file owns the request/response plumbing that every
// master shares. See `masterConfigs.core.js` (§1–§14) and `masterConfigs.rmp.js`
// (§15–§22) for the configs, `masterConfigs.js` for the merged registry.
//
// ---------------------------------------------------------------------------
// CONFIG CONTRACT (both config files follow it)
// ---------------------------------------------------------------------------
//  key, resource, label, group, idField='id', altIdField?, pageSize=20
//  listParams        static base query (e.g. `{is_deleted:false}`)
//  buildListQuery({page, items, search, filters})   AUTHORITATIVE when present —
//                    it is the only way to express dynamic params (includeInactive,
//                    rmp_sku_id, …). `listParams` is just the static fallback.
//  searchMode        'server' (default) | 'server+client' | 'client' | 'none'
//  clientSearch(rows, search)   extra client pass (rmp_skus: the API ignores `search`)
//  detail.extract(body) / pickShowRecord(body)   unwrap a show response
//  getByIdMode       'show' (default) | 'find' (no show endpoint upstream)
//  normalize(row)                       API row  -> UI row
//  toCreatePayload(form)                ASYNC — UI form -> multipart body
//  toUpdatePayload(form, prev)          ASYNC — partial body, or the FULL merged body
//                                       when `readMergeWrite` is set
//  readMergeWrite    fetch the current row and merge before PATCHing (never partial)
//  createRecovery / onCreateResponse    create-response recovery + soft-delete reactivation
//  deleteMode        'delete' (default) | 'patch'   (+ deletePatchBody)
//  fetchAll          {pageSize, maxPages, concurrency, onErrorReturnEmpty, forImport}
//  relations[]       write sub-endpoints (`action`) and/or descriptive `kind` entries
//  supportsBulkDelete, softDelete, columns[], fields[]
//
// Purely descriptive keys the factory deliberately ignores (the UI / bulk layers own
// them): supportsIncludeInactive, deleteRequiresCacheEviction, updateErrorHints,
// imageSlots, bulkUpload, bulkImportMatch, validate.
//
// ---------------------------------------------------------------------------
// Non-negotiable behaviours reproduced here (masters spec §0.5 and §24)
// ---------------------------------------------------------------------------
//   * page-size query param is `items`, never `limit`
//   * list endpoints normally send `is_deleted=false`
//   * bodies go up as multipart FormData -> every value must already be a string
//   * update is READ-MERGE-WRITE for the entities whose PATCH expects a full body;
//     those must never receive a partial body
//   * delete is a soft delete; `fabrics` deliberately uses PATCH {is_deleted:'true'}
//   * relation writes are separate sub-endpoints with indexed or repeated keys

import {
  buildScottPaginatedMeta,
  callScottBulkDelete,
  callScottDashboard,
  extractRecords,
  extractScottEntity,
  fileToScottPayload,
  normalizeId,
  normalizeScottPageParams,
  urlToScottFile
} from "../scottClient";
import { fetchAllScottPages } from "../scottPagination";

// ---------------------------------------------------------------------------
// Shared read helpers (used by the configs)
// ---------------------------------------------------------------------------

/**
 * UI status from an API row. Scott has no status column on most tables: a row is
 * "inactive" when `is_deleted` is truthy (boolean or the string "true").
 * Profit margins map the deleted state to `'deleted'` instead of `'inactive'`.
 * @param {Record<string, unknown>} row
 * @param {string} [deletedStatus]
 * @returns {string}
 */
export function readStatus(row, deletedStatus = "inactive") {
  if (typeof row?.status === "string") return row.status;
  return row?.is_deleted === true || row?.is_deleted === "true" ? deletedStatus : "active";
}

/** `'false'` for active, `'true'` for anything else — the wire value of `is_deleted`. */
export function isDeletedString(status) {
  return status === "active" ? "false" : "true";
}

/** Scott sends booleans as `true`, `'true'` or `'1'` depending on the endpoint. */
export function readBoolean(value) {
  return value === true || value === "true" || value === "1";
}

/** FormData carries strings only. */
export function boolString(value) {
  return value ? "true" : "false";
}

/** Tolerant numeric read (the `num()` helper used by profit margins / app assets). */
export function toNumber(value, fallback = 0) {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value !== "") return parseFloat(value) || fallback;
  return fallback;
}

/** Numeric read that preserves "not supplied" as `undefined`. */
export function optionalNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/** `''`/null/undefined -> undefined, anything else -> String(value). */
export function optionalString(value) {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

/** Timestamps are passed through only when they really are strings. */
export function readTimestamp(value) {
  return typeof value === "string" ? value : "";
}

/**
 * Image-ish fields come back as a bare URL string or as `{ url }` / `{ image_url }`.
 * @returns {string|undefined}
 */
export function pickUrl(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value.url ?? value.image_url ?? value.src;
    if (raw !== null && raw !== undefined && String(raw) !== "") return String(raw);
  }
  return undefined;
}

/**
 * Relation ids from either an `x_ids: [...]` array (strings / numbers / objects with
 * `id`) or an embedded `xs: [{ id, ... }]` array. Id keys win over object keys.
 * @param {Record<string, unknown>} row
 * @param {string[]} objectKeys embedded relation arrays, e.g. ['add_ons']
 * @param {string[]} idKeys     flat id arrays, e.g. ['add_on_ids']
 * @returns {string[]}
 */
export function extractRelationIds(row, objectKeys, idKeys) {
  for (const key of idKeys) {
    const raw = row?.[key];
    if (Array.isArray(raw)) {
      return raw
        .map((item) => {
          if (typeof item === "string" || typeof item === "number") return String(item);
          if (item && typeof item === "object" && "id" in item) return normalizeId(item.id);
          return "";
        })
        .filter(Boolean);
    }
  }

  for (const key of objectKeys) {
    const raw = row?.[key];
    if (Array.isArray(raw)) {
      return raw
        .map((item) => (item && typeof item === "object" && "id" in item ? normalizeId(item.id) : ""))
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Embedded `{ id, name }` relation, tolerating a PascalCase key and an
 * `<rel>_id` field in place of `id`.
 * @param {Record<string, unknown>} row
 * @param {string} key    snake_case relation key, e.g. 'base_product'
 * @param {string} [pascalKey] e.g. 'BaseProduct'
 */
export function extractRelationObject(row, key, pascalKey) {
  const raw = row?.[key] ?? (pascalKey ? row?.[pascalKey] : undefined);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const idValue = raw.id ?? raw[`${key}_id`];
  if (idValue === null || idValue === undefined || idValue === "") return undefined;
  return { id: normalizeId(idValue), name: String(raw.name ?? "") };
}

/**
 * Hex normalizer shared by Colors (§2), RMP Colors (§15) and RMP Classes (§19).
 * `0xAARRGGBB` (Android ARGB) loses its alpha; `#RGB` / `#RRGGBB` / bare hex get a
 * `#` and are upper-cased; anything else becomes `#000000`.
 * @param {unknown} code
 * @returns {string}
 */
export function normalizeHexCode(code) {
  if (typeof code !== "string") return "#000000";

  let hex = code.trim();

  if (/^0[xX][0-9A-Fa-f]{8}$/.test(hex)) {
    return `#${hex.slice(4)}`.toUpperCase(); // drop '0x' + the 2 alpha chars
  }

  const withoutHash = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(withoutHash)) return "#000000";
  if (!hex.startsWith("#")) hex = `#${hex}`;
  return hex.toUpperCase();
}

// ---------------------------------------------------------------------------
// Shared write helpers (used by the configs)
// ---------------------------------------------------------------------------

/**
 * Indexed array fields: `{ 'color_ids[0]': 'a', 'color_ids[1]': 'b' }`.
 * An empty list produces an empty object (matches the original services).
 * @param {string} field base name, e.g. 'color_ids'
 * @param {Array<string|number>} ids
 */
export function indexedIds(field, ids) {
  const body = {};
  (ids ?? []).forEach((value, index) => {
    body[`${field}[${index}]`] = normalizeId(value);
  });
  return body;
}

/** Repeated array field: `{ 'ids[]': [...] }`. */
export function repeatedIds(field, ids) {
  return { [`${field}[]`]: (ids ?? []).map(normalizeId).filter(Boolean) };
}

function isFileLike(value) {
  if (!value || typeof value !== "object") return false;
  if (value.__base64File === true) return true;
  return typeof value.arrayBuffer === "function" && typeof value.name === "string";
}

/**
 * Attach an image to a multipart body under the exact field name the entity uses
 * (`logo`, `image`, `asset`, `thumbnail`, `image_1`…).
 *
 * Resolution order, mirroring every original service:
 *   1. a picked `File` (or an already-built `ScottFilePayload`) -> uploaded as-is;
 *   2. otherwise an existing URL -> re-downloaded in the browser and re-uploaded
 *      under `filename`. Failures are swallowed: images are always optional.
 *
 * `requireHttp: false` reproduces the services that try the re-upload for any
 * truthy URL value (base products, Scott promotional banners).
 *
 * @param {Record<string, unknown>} body mutated in place
 * @param {string} field wire field name
 * @param {{file?: unknown, url?: unknown, filename?: string, requireHttp?: boolean}} opts
 * @returns {Promise<Record<string, unknown>>} the same body
 */
export async function attachScottImageField(body, field, opts = {}) {
  const { file, url, filename = "upload.png", requireHttp = true } = opts;

  if (isFileLike(file)) {
    body[field] = file.__base64File === true ? file : await fileToScottPayload(file);
    return body;
  }

  const candidate = typeof url === "string" ? url.trim() : "";
  if (!candidate) return body;
  if (requireHttp && !/^https?:\/\//i.test(candidate)) return body;

  try {
    body[field] = await urlToScottFile(candidate, filename);
  } catch {
    /* image is optional — a Scott-side URL is often not CORS-readable */
  }
  return body;
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;

function snakeToCamel(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Singularize a display label for button/message copy ("New <singular>").
 * A naive /s$/ strip turns "RMP Classes" into "RMP Classe", so handle the
 * -ies and sibilant -es endings before falling back to dropping a trailing s.
 * Note "z" is deliberately NOT in the sibilant group: "Sizes" must yield
 * "Size", not "Siz" — only a doubled/true sibilant stem takes -es.
 */
function singularize(label) {
  const text = String(label ?? "").trim();
  if (!text) return text;
  if (/ies$/i.test(text)) return text.replace(/ies$/i, "y");
  if (/(ss|sh|ch|x)es$/i.test(text)) return text.replace(/es$/i, "");
  if (/ss$/i.test(text)) return text; // already singular ("Address")
  return text.replace(/s$/i, "");
}

/** A relation entry that actually writes to a sub-endpoint (vs a descriptive FK entry). */
function isWritableRelation(relation) {
  if (!relation || relation.readOnly === true) return false;
  if (relation.kind === "belongsTo" || relation.kind === "inverse") return false;
  return typeof relation.action === "string" && relation.action.length > 0;
}

function withDefaults(config) {
  if (!config || typeof config !== "object") {
    throw new Error("createMastersService: a config object is required");
  }
  if (!config.resource) {
    throw new Error(`createMastersService: config "${config.key ?? "?"}" has no resource`);
  }

  const label = config.label ?? config.key ?? config.resource;
  const labelSingular = config.labelSingular ?? singularize(label).toLowerCase();
  // `supportsSearch:false` is the older spelling of `searchMode:'none'`.
  const searchMode = config.searchMode ?? (config.supportsSearch === false ? "none" : "server");

  return {
    idField: "id",
    altIdField: undefined,
    pageSize: DEFAULT_PAGE_SIZE,
    listMethod: "GET",
    listParams: {},
    getByIdMode: "show",
    readMergeWrite: false,
    updateRecovery: Boolean(config.readMergeWrite),
    deleteMode: "delete",
    deleteReturnsRecord: false,
    softDelete: true,
    supportsBulkDelete: false,
    relations: [],
    columns: [],
    fields: [],
    fetchAll: undefined,
    normalize: (row) => row,
    ...config,
    label,
    labelSingular,
    searchMode,
    messages: {
      notFound: `${label} record not found`,
      createFailed: `Failed to create ${labelSingular}: invalid response`,
      updateFailed: `Failed to update ${labelSingular}: invalid response`,
      bulkDeleteUnsupported: `Bulk delete is not supported for ${label}`,
      ...(config.messages ?? {})
    }
  };
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

/**
 * Build a CRUD service for one master entity.
 *
 * @param {object} config see the contract block at the top of this file
 * @returns {{
 *   config: object,
 *   key: string,
 *   resource: string,
 *   listPage: (params?: object) => Promise<{data: object[], page:number, pageSize:number, totalCount:number, totalPages:number, totalCountIsExact:boolean}>,
 *   listAll: (filters?: object, options?: {onTruncated?: Function}) => Promise<object[]>,
 *   listAllForImport: (filters?: object) => Promise<object[]>,
 *   listAllIds: (filters?: object) => Promise<string[]>,
 *   getById: (id: string) => Promise<object|null>,
 *   create: (form: object) => Promise<object>,
 *   update: (id: string, form: object, prev?: object) => Promise<object>,
 *   remove: (id: string) => Promise<object|undefined>,
 *   bulkDelete: (ids: string[]) => Promise<void>,
 *   updateRelation: (action: string, id: string, value: unknown) => Promise<void>
 * }}
 */
export function createMastersService(config) {
  const cfg = withDefaults(config);

  // -- reads ----------------------------------------------------------------

  function buildQuery(pageParams, filters) {
    const term = String(filters?.search ?? "").trim();
    // 'client' / 'none' never put `search` on the wire.
    const sendSearch = cfg.searchMode !== "none" && cfg.searchMode !== "client";
    const search = sendSearch && term ? term : undefined;

    // buildListQuery is the authority: static listParams cannot express the
    // includeInactive / rmp_sku_id style of dynamic filter.
    if (typeof cfg.buildListQuery === "function") {
      return cfg.buildListQuery({
        page: pageParams.page,
        items: pageParams.items,
        search,
        filters: filters ?? {}
      });
    }

    const query = { items: pageParams.items, page: pageParams.page, ...cfg.listParams };
    if (search) query.search = search;
    return query;
  }

  async function finishRows(rows) {
    if (typeof cfg.enrich !== "function") return rows;
    return cfg.enrich(rows);
  }

  async function finishRow(row) {
    if (!row) return row;
    const [out] = await finishRows([row]);
    return out ?? row;
  }

  function rowId(row) {
    const primary = normalizeId(row?.[cfg.idField]);
    if (primary) return primary;
    return cfg.altIdField ? normalizeId(row?.[cfg.altIdField]) : "";
  }

  function matchesId(row, id) {
    return rowId(row) === id;
  }

  /**
   * One server page. `items`/`pageSize` are interchangeable; every other key is
   * passed to `buildListQuery` as a filter (`search`, `includeInactive`, `rmp_sku_id`…).
   */
  async function listPage(params = {}) {
    const { page, pageSize, items, ...filters } = params ?? {};
    const pageParams = normalizeScottPageParams({
      page,
      items: items ?? pageSize ?? cfg.pageSize
    });

    const { body } = await callScottDashboard({
      resource: cfg.resource,
      method: cfg.listMethod,
      query: buildQuery(pageParams, filters)
    });

    const records = extractRecords(body);
    let rows = records.map((row) => cfg.normalize(row));

    // Client-side search runs ON TOP of the server call (rmp_skus: the endpoint
    // accepts `search` but ignores it), never instead of it.
    const term = String(filters?.search ?? "").trim();
    if (
      term &&
      typeof cfg.clientSearch === "function" &&
      (cfg.searchMode === "client" || cfg.searchMode === "server+client")
    ) {
      rows = cfg.clientSearch(rows, term);
    }
    if (typeof cfg.clientFilter === "function") rows = cfg.clientFilter(rows, filters);

    rows = await finishRows(rows);

    // Meta is built from the raw record count so a client-side pass can never make
    // a full page look like the last one.
    return { data: rows, ...buildScottPaginatedMeta(body, pageParams, records.length) };
  }

  function fetchAllOptions() {
    if (!cfg.fetchAll) return undefined;
    const { pageSize, maxPages, concurrency } = cfg.fetchAll;
    return { pageSize, maxPages, concurrency };
  }

  function dedupeById(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows ?? []) {
      const id = rowId(row);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(row);
    }
    return out;
  }

  /**
   * Drain every page. `cfg.fetchAll` carries the per-entity pageSize/maxPages
   * overrides (rmp_skus 100, rmp_prices 1000) and the "degrade to []" flag.
   */
  async function drain(filters = {}, { dedupe = false, onTruncated } = {}) {
    try {
      const rows = await fetchAllScottPages(
        (pp) => listPage({ page: pp.page, items: pp.items, ...filters }),
        // `onTruncated` fires only when the maxPages cap cut the drain short. It is passed
        // straight through so a caller (the masters list) can raise a visible banner instead
        // of silently sorting/exporting a prefix of the dataset.
        { ...fetchAllOptions(), onTruncated }
      );
      return dedupe ? dedupeById(rows) : rows;
    } catch (error) {
      if (cfg.fetchAll?.onErrorReturnEmpty) {
        console.error(`[scott] ${cfg.label}: fetch-all failed, returning []`, error);
        return [];
      }
      throw error;
    }
  }

  const listAll = (filters = {}, options = {}) => drain(filters, options);

  /**
   * Bulk-import variant: `fetchAll.forImport` widens the filters (e.g. include
   * soft-deleted rows) and de-duplicates, because the Scott cursor repeats rows
   * across pages.
   */
  async function listAllForImport(extraFilters = {}) {
    const spec = cfg.fetchAll?.forImport;
    return drain(
      { ...(spec?.filters ?? {}), ...extraFilters },
      { dedupe: Boolean(spec?.dedupeById) }
    );
  }

  /** Ids only — for "select all matching" bulk actions. */
  async function listAllIds(filters = {}) {
    const rows = await drain(filters);
    return rows.map((row) => rowId(row)).filter(Boolean);
  }

  async function findById(id) {
    const rows = await drain();
    return rows.find((row) => matchesId(row, id)) ?? null;
  }

  /**
   * Unwrap a show response.
   *
   * The configured extractor wins, but it is ASSUMED shape — several show endpoints nest a
   * level deeper than their list counterpart (e.g. `{data:{rmp_brand:{…}}}`), and ScottOne
   * never exercised most of them: its pages prefill the edit dialog straight from the list
   * row, so `getById` was dead code upstream. When the extractor yields something that is not
   * a record, fall back to `extractScottEntity`, which already scans `body.data`'s values and
   * deep-scans for the first record-shaped object.
   *
   * Getting this wrong is not a silent no-op: `normalize()` would read a WRAPPER, produce a
   * record of blanks, and the edit dialog would visibly clear itself a moment after opening.
   */
  function pickShowRecord(body) {
    const configured =
      typeof cfg.pickShowRecord === "function"
        ? cfg.pickShowRecord(body)
        : typeof cfg.detail?.extract === "function"
          ? cfg.detail.extract(body)
          : body?.data;

    if (isRecordLike(configured)) return configured;
    return extractScottEntity(body);
  }

  /** A usable show payload: a plain object carrying at least one own key. */
  function isRecordLike(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
  }

  async function getById(id) {
    const rid = normalizeId(id);
    if (!rid) return null;

    // Several masters have no usable show endpoint; those resolve client-side.
    if (cfg.getByIdMode === "find") return finishRow(await findById(rid));

    const { body } = await callScottDashboard({
      resource: cfg.resource,
      method: "GET",
      pathSuffix: rid
    });
    const raw = pickShowRecord(body);
    if (!isRecordLike(raw)) return null;

    const normalized = finishRow(cfg.normalize(raw));
    // An id-less result means the shape was not what `normalize` expected. Returning it would
    // let the caller replace a good row-shaped prefill with a record of blanks.
    if (!rowId(normalized)) return null;
    return normalized;
  }

  // -- writes ---------------------------------------------------------------

  function bodySnippet(body) {
    if (body !== null && typeof body === "object") {
      try {
        return JSON.stringify(body).slice(0, 400);
      } catch {
        return String(body);
      }
    }
    return String(body);
  }

  /**
   * Some environments answer a successful POST with a body that carries no record.
   * Brands and base product types recover by re-listing and matching on name.
   */
  async function recoverCreated(form) {
    const recovery = cfg.createRecovery;
    if (!recovery) return null;

    const field = recovery.field ?? "name";
    const wanted = String(form?.[field] ?? "").trim();
    if (!wanted) return null;

    const rows = await drain();
    const compare = recovery.match === "ci" ? (v) => v.toLowerCase() : (v) => v;
    const matches = rows.filter(
      (row) => compare(String(row?.[field] ?? "").trim()) === compare(wanted)
    );

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      if (recovery.tieBreak === "updated_at") {
        return [...matches].sort(
          (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
        )[0];
      }
      return matches[0];
    }
    return null;
  }

  async function create(form = {}) {
    const payload = await cfg.toCreatePayload(form);
    const { body } = await callScottDashboard({
      resource: cfg.resource,
      method: "POST",
      body: payload
    });

    const row = extractScottEntity(body);
    if (row) {
      // Soft-delete name collision (rmp_classes): Scott hands back the dead row
      // without reactivating it — follow up with a PATCH and return THAT row.
      if (typeof cfg.onCreateResponse === "function") {
        const followUp = cfg.onCreateResponse(row, form);
        if (followUp?.reactivateId) {
          return update(followUp.reactivateId, followUp.form ?? form);
        }
      }
      return finishRow(cfg.normalize(row));
    }

    const recovered = await recoverCreated(form);
    if (recovered) return recovered;

    const message = cfg.createRecovery?.includeSnippet
      ? `${cfg.messages.createFailed}: ${bodySnippet(body)}`
      : cfg.messages.createFailed;
    throw new Error(message);
  }

  /**
   * PATCH one record.
   *
   * For read-merge-write entities the current row is re-read from the server here
   * (never trusted from the caller) and handed to `toUpdatePayload` as `prev`, so
   * the config can emit the FULL body those endpoints require.
   */
  async function update(id, form = {}, prev) {
    const rid = normalizeId(id);
    let current = prev;

    if (cfg.readMergeWrite) {
      current = await findById(rid);
      if (!current) throw new Error(cfg.messages.notFound);
    }

    const payload = await cfg.toUpdatePayload(form, current);
    const { body } = await callScottDashboard({
      resource: cfg.resource,
      method: "PATCH",
      pathSuffix: rid,
      body: payload
    });

    const row = extractScottEntity(body);
    if (row) return finishRow(cfg.normalize(row));

    if (cfg.updateRecovery) {
      const again = await findById(rid);
      if (again) return again;
    }
    throw new Error(cfg.messages.updateFailed);
  }

  /**
   * Soft delete. `deleteMode: 'patch'` reproduces the fabrics quirk (PATCH with
   * `{is_deleted:'true'}` instead of DELETE) — do not "fix" it.
   */
  async function remove(id) {
    const rid = normalizeId(id);

    if (cfg.deleteMode === "patch") {
      await callScottDashboard({
        resource: cfg.resource,
        method: "PATCH",
        pathSuffix: rid,
        body: cfg.deletePatchBody ?? { is_deleted: "true" }
      });
    } else {
      await callScottDashboard({
        resource: cfg.resource,
        method: "DELETE",
        pathSuffix: rid
      });
    }

    if (!cfg.deleteReturnsRecord) return undefined;
    const after = await getById(rid);
    if (after) return after;
    return typeof cfg.deletedTombstone === "function" ? cfg.deletedTombstone(rid) : null;
  }

  /** Single DELETE to `{resource}/bulk_delete` with repeated `ids[]` fields. */
  async function bulkDelete(ids) {
    if (!cfg.supportsBulkDelete) throw new Error(cfg.messages.bulkDeleteUnsupported);
    await callScottBulkDelete(cfg.resource, ids ?? []);
  }

  // -- relation sub-endpoints ----------------------------------------------

  function relationBody(relation, value) {
    // A config-supplied builder owns the whole body (rmp_brands sends
    // `{'rmp_category_ids[]': ''}` for "clear all" — an empty PATCH body 400s).
    if (typeof relation.buildBody === "function") return relation.buildBody(value);

    const ids = (value ?? []).map(normalizeId).filter(Boolean);
    if (relation.style === "repeated") {
      if (ids.length === 0 && relation.emptyValue !== undefined) {
        return { [`${relation.param}[]`]: relation.emptyValue };
      }
      return repeatedIds(relation.param, ids);
    }
    return indexedIds(relation.param, ids);
  }

  function relationPath(relation, id) {
    if (typeof relation.pathSuffix === "function") return relation.pathSuffix(normalizeId(id));
    if (typeof relation.pathSuffix === "string") return relation.pathSuffix;
    return `${normalizeId(id)}/${relation.action}`;
  }

  async function updateRelation(action, id, value) {
    const relation = cfg.relations.find((rel) => rel.action === action && isWritableRelation(rel));
    if (!relation) throw new Error(`Unknown relation "${action}" for ${cfg.label}`);
    await callScottDashboard({
      resource: cfg.resource,
      method: relation.method ?? "PATCH",
      pathSuffix: relationPath(relation, id),
      body: relationBody(relation, value)
    });
  }

  const service = {
    config: cfg,
    key: cfg.key,
    resource: cfg.resource,
    listPage,
    listAll,
    listAllForImport,
    listAllIds,
    getById,
    create,
    update,
    remove,
    bulkDelete,
    updateRelation
  };

  // `update_colors` -> service.updateColors(id, ids). Descriptive `belongsTo` /
  // `inverse` / read-only relation entries never become methods.
  for (const relation of cfg.relations) {
    if (!isWritableRelation(relation)) continue;
    const methodName = relation.methodName ?? snakeToCamel(relation.action);
    service[methodName] = (id, value) => updateRelation(relation.action, id, value);
  }

  return service;
}

/**
 * Build services for a whole registry: `{ colors: config, … }` -> `{ colors: service, … }`.
 * @param {Record<string, object>} configs
 */
export function createMastersServices(configs) {
  const services = {};
  for (const [key, config] of Object.entries(configs ?? {})) {
    services[key] = createMastersService(config);
  }
  return services;
}
