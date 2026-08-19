// Ready-made-product (RMP) master configs — the 8 `rmp_*` Scott resources.
//
//   rmp_colors, rmp_sizes, rmp_brands, rmp_categories,
//   rmp_classes, rmp_skus, rmp_price_types, rmp_prices
//
// All of them live under `{base}/api/dashboard/v1/{resource}` (no namespace split, no
// 404 fallback games), all soft-delete via `is_deleted`, and all support
// `DELETE {resource}/bulk_delete` with repeated `ids[]`.
//
// ---------------------------------------------------------------------------
// CONTRACT WITH mastersService (the generic CRUD factory) — read before wiring
// ---------------------------------------------------------------------------
// 1. `toCreatePayload` / `toUpdatePayload` are **async**. Image fields have to be
//    base64-encoded (`fileToScottPayload`) or re-downloaded (`urlToScottFile`), so the
//    builders return Promises. The service MUST `await` them. (`await` on the handful
//    that never touch images is harmless.)
// 2. Form conventions the builders read:
//      - `form.imageFile`  — a freshly picked `File` for single-image entities.
//      - `form.image`      — the stored image URL echoed back by the dialog. IGNORED on
//        write by every RMP entity (re-uploading it churned rmp_categories on every save).
//      - `form.imageUrl`   — a NEW image URL to fetch-and-upload (rmp_categories, bulk
//        import only). Callers must set this deliberately; `form.image` no longer counts.
//      - `form.imageFiles` — `{ image_1..image_5: File }` for rmp_classes.
//      - `form.image_1..image_5` — existing slot URLs (rmp_classes; bulk import path).
// 3. `buildListQuery({ page, items, search, filters })` is the AUTHORITY for list query
//    params. `listParams` is only the static base — using it alone silently breaks
//    rmp_categories/rmp_classes `includeInactive` and the rmp_prices `rmp_sku_id` filter.
// 4. `clientSearch` (rmp_skus only) must run on top of the server call, not instead of it.
// 5. `detail.extract(body)` unwraps show responses — rmp_brands nests one level deeper.
// 6. `onCreateResponse(rawRow, form)` (rmp_classes only) may ask the service to follow the
//    POST with a reactivating PATCH. Ignoring it silently breaks re-creating a name that
//    exists soft-deleted.
// 7. Updates are PARTIAL PATCHes for every RMP entity — no read-merge-write anywhere here,
//    so `toUpdatePayload`'s `prev` argument is accepted but unused.
//
// Ported verbatim from the ScottOne services (`rmp*Service.ts`). Where the upstream
// behaviour looks like a bug it is reproduced and commented — do not "fix" it here.

import { fileToScottPayload, normalizeId, urlToScottFile } from "../scottClient";

/** Left-rail grouping in the Masters screen. */
export const RMP_GROUP = "Ready-made products";

/** Scott's page-size param is `items`; 20 matches the app-wide default. */
const DEFAULT_PAGE_SIZE = 20;

const STATUS_OPTIONS = Object.freeze([
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
]);

/**
 * Radix sentinel for "no relation" in an RMP dialog. A `Select` cannot hold an empty
 * string value, so a nullable FK needs a real token for its None row; every payload
 * builder strips it back to `''`, which is what a PATCH sends to CLEAR the column.
 * (Same pattern as `promotional_banners` in masterConfigs.core.js.)
 */
export const RMP_NONE = "__rmp_none__";

/** `''` for the None sentinel, the value untouched otherwise. */
const withoutSentinel = (value) => (value === RMP_NONE ? "" : value);

/** RMP class image slots, in wire order. */
export const RMP_CLASS_IMAGE_SLOTS = Object.freeze([
  "image_1",
  "image_2",
  "image_3",
  "image_4",
  "image_5"
]);

/** `size_type` enum accepted by rmp_sizes. */
export const RMP_SIZE_TYPES = Object.freeze(["alpha", "numeric", "free_size", "kids", "bags"]);

/** `price_for` enum accepted by rmp_price_types. */
export const RMP_PRICE_FOR_TYPES = Object.freeze(["customer", "dealer", "zone"]);

// ---------------------------------------------------------------------------
// Shared read helpers (each mirrors one upstream coercion exactly)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Scott sends booleans as booleans OR as the strings "true"/"false". */
function readIsDeleted(row) {
  return row?.is_deleted === true || row?.is_deleted === "true";
}

/** `status` when the API sends one, else derived from `is_deleted`. */
function readStatus(row) {
  if (typeof row?.status === "string") return row.status;
  return readIsDeleted(row) ? "inactive" : "active";
}

/** `position` pattern: number passthrough, null/undefined -> 0, else Number(v). */
function readPosition(value) {
  if (typeof value === "number") return value;
  return value != null ? Number(value) : 0;
}

/** cgst/igst/sgst pattern. */
function readTaxRate(value) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

/** price/mrp pattern. */
function readAmount(value) {
  return value != null ? Number(value) : 0;
}

/** Timestamps are passed through only when they really are strings. */
function readTimestamp(value) {
  return typeof value === "string" ? value : "";
}

/** `created_by` / `updated_by` are optional and dropped when falsy. */
function readOptionalString(value) {
  return value ? String(value) : undefined;
}

/**
 * `is_deleted` for a write body. Anything that is not exactly "active" is inactive —
 * that asymmetry is upstream's, and bulk-import rows rely on it.
 */
function deletedFlagFor(status) {
  return status === "active" ? "false" : "true";
}

/**
 * Embedded `{ id, name }` relation with a PascalCase alias and an `<rel>_id` fallback
 * for the inner primary key. Returns undefined when there is no usable id.
 */
function readEmbeddedRelation(row, key, pascalKey, innerIdKey) {
  const raw = row?.[key] ?? (pascalKey ? row?.[pascalKey] : undefined);
  if (!isPlainObject(raw)) return undefined;
  const idValue = raw.id ?? (innerIdKey ? raw[innerIdKey] : undefined);
  if (idValue == null || idValue === "") return undefined;
  return { id: normalizeId(idValue), name: String(raw.name ?? "") };
}

/**
 * `format` for a relation column that is KEYED ON THE FK.
 *
 * The embedded `{id, name}` object wins whenever the API actually sent one with a name (no
 * lookup needed); otherwise the bare FK falls through so `decorateMasterColumns` can resolve
 * it against the option list injected from `optionsResource`. Without this a list response
 * that carries only `rmp_size_id` renders an em dash — which is exactly what ScottOne avoids
 * by resolving through its drained master maps (`RmpSkusPage.tsx:105-126`).
 *
 * @param {string} embeddedKey key of the embedded object on the normalized row
 */
function embeddedOrId(embeddedKey) {
  return (raw, row) => {
    const embedded = row?.[embeddedKey];
    if (embedded && String(embedded.name ?? "").trim()) return embedded;
    return raw ?? embedded;
  };
}

/** Flat snake_case id, then camelCase, then the embedded relation's id. */
function readForeignKey(row, snakeKey, camelKey, embedded) {
  const raw = row?.[snakeKey] ?? (camelKey ? row?.[camelKey] : undefined);
  if (raw != null && String(raw) !== "") return String(raw);
  return embedded?.id;
}

// ---------------------------------------------------------------------------
// Shared write helpers
// ---------------------------------------------------------------------------

/**
 * Single-image entities (rmp_sizes, rmp_brands, rmp_skus): ONLY a freshly picked File is
 * uploaded. These three deliberately do NOT re-upload an existing image URL — that is a
 * rmp_categories / rmp_classes behaviour. Do not add it here.
 */
async function attachImageFile(form, body, field = "image") {
  const file = form?.imageFile;
  if (file) body[field] = await fileToScottPayload(file);
}

/**
 * rmp_categories: a freshly picked File wins.
 *
 * WHY THE STORED URL IS NOT RE-UPLOADED (audit fix).
 * `buildInitialForm` seeds `form.image` with the record's stored URL, so the old
 * "any http(s) `form.image` gets re-downloaded and re-uploaded" rule fired on EVERY edit:
 * open a category, change its name, save — and the same picture was fetched over the network
 * and pushed back up as a brand-new `category.png`. ScottOne's dialog only ever sends a
 * picked File, never an existing URL.
 *
 * The URL path is kept for BULK IMPORT, which is the one caller that legitimately supplies a
 * NEW image URL — but it now has to say so explicitly through `form.imageUrl`. `form.image`
 * (the stored URL echoed back by the dialog / grid) is ignored on write.
 *
 * A failed fetch is swallowed — the image is optional and must never block the save.
 */
async function attachCategoryImage(form, body) {
  if (form?.imageFile) {
    body.image = await fileToScottPayload(form.imageFile);
    return;
  }
  const url = form?.imageUrl;
  if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
    try {
      body.image = await urlToScottFile(url, "category.png");
    } catch {
      /* optional image — skip failed URL fetch */
    }
  }
}

/**
 * rmp_classes: five independent slots. Per slot — a new File wins; otherwise an existing
 * http(s) URL is re-downloaded and re-uploaded as `rmp_class_{slot}.png`
 * (i.e. `rmp_class_image_1.png` … `rmp_class_image_5.png`). A slot left empty is simply
 * omitted, which is what "keep the current image" means on a PATCH.
 */
async function attachRmpClassImages(form, body) {
  const files = form?.imageFiles;
  for (const slot of RMP_CLASS_IMAGE_SLOTS) {
    const file = files?.[slot];
    if (file) {
      body[slot] = await fileToScottPayload(file);
      continue;
    }
    const url = form?.[slot];
    if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
      try {
        body[slot] = await urlToScottFile(url, `rmp_class_${slot}.png`);
      } catch {
        /* optional image — skip failed URL fetch */
      }
    }
  }
}

/** Standard list query: `{items, page, is_deleted:false}` + `search` when non-empty. */
function buildStandardListQuery({ page, items, search }) {
  const query = { items, page, is_deleted: false };
  if (search) query.search = search;
  return query;
}

/** Show responses are `{ data: {...} }` for every RMP resource except rmp_brands. */
function extractDetailData(body) {
  return isPlainObject(body) && isPlainObject(body.data) ? body.data : null;
}

// ---------------------------------------------------------------------------
// Hex codes (shared with §2 Colors — import `normalizeHexCode` from here)
// ---------------------------------------------------------------------------

/**
 * Scott stores hex three different ways. Normalizes all of them to `#RRGGBB` uppercase:
 *   - Android/Java ARGB `0xAARRGGBB` -> alpha stripped
 *   - `#RGB` / `#RRGGBB` / bare `RRGGBB` -> `#`-prefixed, uppercased
 *   - anything else -> `#000000`
 *
 * Note the `0x` branch keeps the 3-digit-shorthand check out of play and returns early;
 * `#RGB` is passed through as-is (uppercased), NOT expanded to 6 digits.
 *
 * @param {unknown} code
 * @returns {string}
 */
export function normalizeHexCode(code) {
  if (typeof code !== "string") return "#000000";

  let hex = code.trim();

  // 0xAARRGGBB / 0XAARRGGBB (e.g. 0xff848789) -> drop "0x" + the 2 alpha chars.
  if (/^0[xX][0-9A-Fa-f]{8}$/.test(hex)) {
    return `#${hex.slice(4)}`.toUpperCase();
  }

  const hexWithoutHash = hex.startsWith("#") ? hex.slice(1) : hex;
  const isValidHex = /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(hexWithoutHash);
  if (!isValidHex) return "#000000";

  if (!hex.startsWith("#")) hex = `#${hex}`;
  return hex.toUpperCase();
}

// ===========================================================================
// §15 — RMP Colors
// ===========================================================================

export const rmpColorsConfig = {
  key: "rmp_colors",
  resource: "rmp_colors",
  label: "RMP Colors",
  group: RMP_GROUP,
  idField: "id",
  /** Create/show responses may carry this instead of `id`. */
  altIdField: "rmp_color_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: buildStandardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    // The upstream page splits this into "Code" (text) + "Preview" (swatch); one
    // `color` column renders both without duplicating the key.
    { key: "code", header: "Code", type: "color", sortable: true },
    { key: "status", header: "Status", type: "badge", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "code", label: "Hex code", type: "color", required: true, defaultValue: "#000000" },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" }
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id ?? r.rmp_color_id),
      name: String(r.name ?? ""),
      code: normalizeHexCode(r.code),
      is_deleted: readIsDeleted(r),
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: readOptionalString(r.created_by),
      updated_by: readOptionalString(r.updated_by)
    };
  },

  // async purely for a uniform service contract — nothing here awaits.
  async toCreatePayload(form) {
    return {
      name: form?.name,
      code: normalizeHexCode(form?.code),
      is_deleted: deletedFlagFor(form?.status)
    };
  },

  // async purely for a uniform service contract — nothing here awaits.
  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.code !== undefined) body.code = normalizeHexCode(form.code);
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,
  relations: []
};

// ===========================================================================
// §16 — RMP Sizes
// ===========================================================================

export const rmpSizesConfig = {
  key: "rmp_sizes",
  resource: "rmp_sizes",
  label: "RMP Sizes",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_size_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: buildStandardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "image", header: "Image", type: "image" },
    { key: "size_type", header: "Size Type", type: "text", sortable: true },
    { key: "position", header: "Position", type: "number", sortable: true },
    { key: "status", header: "Status", type: "badge", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "size_type",
      label: "Size type",
      type: "select",
      required: true,
      defaultValue: "alpha",
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "numeric", label: "Numeric" },
        { value: "free_size", label: "Free Size" },
        { value: "kids", label: "Kids" },
        { value: "bags", label: "Bags" }
      ]
    },
    { key: "position", label: "Position", type: "number", min: 0, defaultValue: 0 },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" },
    { key: "image", label: "Image", type: "image" }
  ],

  normalize(row) {
    const r = row ?? {};

    // Unknown size_type strings are lower-cased + underscored and re-checked; anything
    // still unrecognised falls back to 'alpha'.
    let sizeType = "alpha";
    if (typeof r.size_type === "string") {
      if (RMP_SIZE_TYPES.includes(r.size_type)) {
        sizeType = r.size_type;
      } else {
        const candidate = r.size_type.toLowerCase().replace(/\s+/g, "_");
        if (RMP_SIZE_TYPES.includes(candidate)) sizeType = candidate;
      }
    }

    return {
      id: normalizeId(r.id ?? r.rmp_size_id),
      name: String(r.name ?? ""),
      position: readPosition(r.position),
      is_deleted: readIsDeleted(r),
      size_type: sizeType,
      // Upstream does not unwrap `{url}` here (only rmp_categories does) — kept as-is.
      image: r.image ? String(r.image) : undefined,
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: readOptionalString(r.created_by),
      updated_by: readOptionalString(r.updated_by)
    };
  },

  async toCreatePayload(form) {
    const body = {
      name: form?.name,
      position: String(form?.position ?? 0),
      size_type: form?.size_type,
      is_deleted: deletedFlagFor(form?.status)
    };
    await attachImageFile(form, body);
    return body;
  },

  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.position !== undefined) body.position = String(form.position);
    if (form?.size_type !== undefined) body.size_type = form.size_type;
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    await attachImageFile(form, body);
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,
  relations: []
};

// ===========================================================================
// §17 — RMP Brands
// ===========================================================================

export const rmpBrandsConfig = {
  key: "rmp_brands",
  resource: "rmp_brands",
  label: "RMP Brands",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_brand_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: buildStandardListQuery,

  detail: {
    /**
     * Only RMP entity whose show response nests one level deeper:
     * `{ data: { rmp_brand: {...} } }`. Reading `body.data` here yields the wrapper.
     */
    extract(body) {
      const data = extractDetailData(body);
      return isPlainObject(data?.rmp_brand) ? data.rmp_brand : null;
    }
  },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "image", header: "Image", type: "image" },
    { key: "position", header: "Position", type: "number", sortable: true },
    // NO "Categories" COLUMN (audit fix). The rmp_brands LIST response does not carry
    // `rmp_categories` — ScottOne only shows it by firing a per-row show request
    // (`RmpBrandsPage.tsx:171-187`, which itself falls back to `row.rmp_categories ?? []`).
    // This table has no per-row detail fetch, so the column was an em dash on every brand
    // that has categories. `normalize` still reads them, and the Edit dialog still prefills
    // from the show response through `relations[].valueFrom` — only the column is gone.
    {
      // Keyed on the FK so `decorateMasterColumns` can inject the Authorized Brands option
      // list: the API does not always embed `authorized_brand`, and without a lookup the
      // cell rendered an em dash. The embedded object stays as the preferred source when
      // it carries a name (no request needed to show it).
      key: "authorized_brand_id",
      header: "Authorized Brand",
      type: "relation",
      sortable: true,
      optionsResource: "authorized_brands",
      format: (raw, row) => {
        const embedded = row?.authorized_brand;
        if (embedded && String(embedded.name ?? "").trim()) return embedded;
        return raw ?? embedded;
      }
    },
    { key: "status", header: "Status", type: "badge", sortable: true },
    { key: "created_at", header: "Created At", type: "datetime", sortable: true },
    { key: "updated_at", header: "Updated At", type: "datetime", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "position", label: "Position", type: "number", min: 0, defaultValue: 0 },
    {
      key: "authorized_brand_id",
      label: "Authorized brand",
      type: "select",
      // Options come from the Authorized Brands master (§1, masterConfigs.core.js).
      optionsResource: "authorized_brands",
      nullable: true,
      emptyLabel: "None",
      // Without a sentinel the dialog drops the None row (it filters out empty option
      // values), so a set brand could never be cleared. `toUpdatePayload` strips it to ''.
      noneValue: RMP_NONE
    },
    {
      key: "rmp_category_ids",
      label: "Categories",
      type: "multiselect",
      optionsResource: "rmp_categories",
      // NOT part of the create/update body — saved through the `update_categories`
      // relation endpoint below, as a second request after the main save.
      relation: "update_categories"
    },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" },
    { key: "image", label: "Image", type: "image" }
    // `main_category` is accepted by the API (and handled by the payload builders below)
    // but the upstream dialog never exposed it — only bulk paths set it.
  ],

  normalize(row) {
    const r = row ?? {};
    const authorizedBrand = readEmbeddedRelation(
      r,
      "authorized_brand",
      "AuthorizedBrand",
      "authorized_brand_id"
    );

    // Linked categories: `rmp_categories` wins, `active_rmp_categories` is the fallback;
    // an empty array on the preferred key falls through to the other one.
    const linked = r.rmp_categories;
    const active = r.active_rmp_categories;
    const rawCategories =
      Array.isArray(linked) && linked.length > 0
        ? linked
        : Array.isArray(active) && active.length > 0
          ? active
          : undefined;

    return {
      id: normalizeId(r.id ?? r.rmp_brand_id),
      name: String(r.name ?? ""),
      position: readPosition(r.position),
      is_deleted: readIsDeleted(r),
      main_category: r.main_category ? String(r.main_category) : undefined,
      authorized_brand_id: readForeignKey(r, "authorized_brand_id", "authorizedBrandId", authorizedBrand),
      authorized_brand: authorizedBrand,
      rmp_categories: rawCategories
        ? rawCategories.map((c) => ({
            id: normalizeId(c?.id ?? c?.rmp_category_id),
            name: String(c?.name ?? "")
          }))
        : undefined,
      image: r.image ? String(r.image) : undefined,
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: readOptionalString(r.created_by),
      updated_by: readOptionalString(r.updated_by)
    };
  },

  async toCreatePayload(form) {
    const body = {
      name: form?.name,
      position: String(form?.position ?? 0),
      is_deleted: deletedFlagFor(form?.status)
    };
    // Create only sends the FKs when they are truthy (no ''-to-clear on POST).
    if (form?.main_category) body.main_category = form.main_category;
    const createBrandId = withoutSentinel(form?.authorized_brand_id);
    if (createBrandId) body.authorized_brand_id = createBrandId;
    await attachImageFile(form, body);
    return body;
  },

  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.position !== undefined) body.position = String(form.position);
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    // On PATCH the FKs send '' to CLEAR — presence of the key is what matters.
    if (form?.main_category !== undefined) body.main_category = form.main_category || "";
    if (form?.authorized_brand_id !== undefined) {
      body.authorized_brand_id = withoutSentinel(form.authorized_brand_id) || "";
    }
    await attachImageFile(form, body);
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,

  relations: [
    {
      key: "rmp_categories",
      action: "update_categories",
      label: "Categories",
      method: "PATCH",
      pathSuffix: (id) => `${id}/update_categories`,
      optionsResource: "rmp_categories",
      /** Current value for the form, read off a normalized row. */
      valueFrom: (row) => (row?.rmp_categories ?? []).map((c) => c.id),
      /**
       * Sends the FULL final list (not a delta). An empty list must still send one field:
       * Scott 400s on a PATCH with no form fields, so `{'rmp_category_ids[]': ''}` is how
       * "clear all categories" is expressed.
       */
      buildBody(rmpCategoryIds) {
        const ids = rmpCategoryIds ?? [];
        if (ids.length === 0) return { "rmp_category_ids[]": "" };
        return { "rmp_category_ids[]": ids };
      }
    }
  ]
};

// ===========================================================================
// §18 — RMP Categories
// ===========================================================================

export const rmpCategoriesConfig = {
  key: "rmp_categories",
  resource: "rmp_categories",
  label: "RMP Categories",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_category_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",

  /** Page-level toggle that widens the list to soft-deleted rows. */
  supportsIncludeInactive: true,

  /**
   * `includeInactive` OMITS `is_deleted:false` entirely (it does not send `true`) — that is
   * what makes the list show active AND soft-deleted rows.
   */
  buildListQuery({ page, items, search, filters }) {
    const query = { items, page };
    if (!filters?.includeInactive) query.is_deleted = false;
    if (search) query.search = search;
    return query;
  },

  detail: { extract: extractDetailData },

  /**
   * DELETE CACHE SURGERY (UI concern, documented here so it is not lost):
   * Scott only soft-deletes. With `includeInactive` on, plainly invalidating the list after
   * a delete re-fetches the row and it REAPPEARS. The delete mutation must first drop the
   * deleted id out of every cached page (filter `page.data` across all cached
   * `['rmp_categories']` queries) and only then invalidate.
   */
  deleteRequiresCacheEviction: true,

  /**
   * Soft-delete name collisions surface as a bare "name has already been taken" on update.
   * The toast appends the recovery path rather than leaving the user stuck.
   */
  updateErrorHints: [
    {
      match: "name has already been taken",
      append:
        " — another inactive record may have the same name. Rename it first using the Edit button, then reactivate."
    }
  ],

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "image", header: "Image", type: "image" },
    { key: "position", header: "Position", type: "number", sortable: true },
    { key: "status", header: "Status", type: "badge", sortable: true },
    { key: "created_at", header: "Created At", type: "datetime", sortable: true },
    { key: "updated_at", header: "Updated At", type: "datetime", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "position", label: "Position", type: "number", min: 0, defaultValue: 0 },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" },
    {
      key: "image",
      label: "Image",
      type: "image",
      // A bulk/CSV cell carrying a NEW image URL lands here. `image` itself is the stored URL
      // echoed back by the dialog and is IGNORED on write, so editing a category no longer
      // re-fetches and re-uploads the same asset every save (see attachCategoryImage).
      urlKey: "imageUrl"
    }
  ],

  normalize(row) {
    const r = row ?? {};

    // The only RMP image field that is unwrapped: string, or {url} / {image_url}.
    let image;
    const rawImage = r.image ?? r.image_url;
    if (typeof rawImage === "string" && rawImage.trim() !== "") {
      image = rawImage;
    } else if (isPlainObject(rawImage)) {
      if (typeof rawImage.url === "string" && rawImage.url.trim() !== "") {
        image = rawImage.url;
      } else if (typeof rawImage.image_url === "string" && rawImage.image_url.trim() !== "") {
        image = rawImage.image_url;
      }
    }

    return {
      id: normalizeId(r.id ?? r.rmp_category_id),
      name: String(r.name ?? ""),
      position: readPosition(r.position),
      is_deleted: readIsDeleted(r),
      status: readStatus(r),
      image,
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    const body = {
      name: form?.name,
      position: String(form?.position ?? 0),
      is_deleted: deletedFlagFor(form?.status)
    };
    await attachCategoryImage(form, body);
    return body;
  },

  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.position !== undefined) body.position = String(form.position);
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    await attachCategoryImage(form, body);
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,
  relations: []
};

// ===========================================================================
// §19 — RMP Classes
// ===========================================================================

export const rmpClassesConfig = {
  key: "rmp_classes",
  resource: "rmp_classes",
  label: "RMP Classes",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_class_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",

  supportsIncludeInactive: true,

  /**
   * Same reason as rmp_categories: with `includeInactive` on, a plain invalidate after a
   * soft delete re-fetches the row and it REAPPEARS, so the delete looks like a no-op. The
   * mutation must evict the id from every cached page first. (Was missing here while
   * rmp_categories had it — the two share `supportsIncludeInactive`.)
   */
  deleteRequiresCacheEviction: true,

  /** Same shape as rmp_categories: `includeInactive` omits the filter rather than negating it. */
  buildListQuery({ page, items, search, filters }) {
    const query = { items, page };
    if (!filters?.includeInactive) query.is_deleted = false;
    if (search) query.search = search;
    return query;
  },

  detail: { extract: extractDetailData },

  fetchAll: {
    /**
     * Bulk-import variant: every page INCLUDING soft-deleted rows, de-duplicated by id
     * (the Scott cursor repeats rows across pages). Without the inactive rows, re-importing
     * a soft-deleted name is misclassified as "create" instead of "update/reactivate".
     */
    forImport: { filters: { includeInactive: true }, dedupeById: true }
  },

  /** Five slots; also the wire field names. */
  imageSlots: RMP_CLASS_IMAGE_SLOTS,

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    {
      key: "image_1",
      header: "Images",
      type: "image-list",
      imageSlots: RMP_CLASS_IMAGE_SLOTS,
      thumbSuffix: "_thumb"
    },
    { key: "position", header: "Position", type: "number", sortable: true },
    {
      // Keyed on the FK (see the rmp_brands twin above) so the RMP Colors option list can
      // be injected; the embedded `rmp_color` object wins whenever it carries a name.
      key: "rmp_color_id",
      header: "Color",
      type: "relation",
      sortable: true,
      optionsResource: "rmp_colors",
      format: (raw, row) => {
        const embedded = row?.rmp_color;
        if (embedded && String(embedded.name ?? "").trim()) return embedded;
        return raw ?? embedded;
      }
    },
    // NO "Linked SKUs" COLUMN (audit fix). `normalize` never produced `linked_skus` and
    // nothing reads the `inverse` relation below, so the cell was an em dash for every class.
    // Deriving it honestly would need a FULL rmp_skus drain (up to 25k rows) on every class
    // list render — deliberately not done. The `inverse` relation entry is kept purely as
    // documentation of the direction of the FK.
    { key: "status", header: "Status", type: "badge", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "position", label: "Position", type: "number", min: 0, defaultValue: 0 },
    {
      key: "rmp_color_id",
      label: "Color",
      type: "select",
      optionsResource: "rmp_colors",
      nullable: true,
      emptyLabel: "None",
      // See `authorized_brand_id` above — no sentinel meant no None row, so a colour that
      // had been set could never be removed from a class.
      noneValue: RMP_NONE
    },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" },
    {
      key: "imageFiles",
      label: "Images",
      type: "image-slots",
      slots: RMP_CLASS_IMAGE_SLOTS,
      // Leaving a slot empty on edit keeps whatever is already stored.
      keepOnEmpty: true,
      /**
       * PREFILL. `normalize` spreads the stored images as `image_1..image_5`; the record
       * never carries an `imageFiles` key, so the dialog used to seed `[]` — Edit showed
       * "No image" on a class with five images, and (worse) the first file the user added
       * landed at array index 0 and overwrote `image_1`.
       *
       * SLOT ORDER IS THE CONTRACT: index N of this array is always
       * `RMP_CLASS_IMAGE_SLOTS[N]`, so an empty slot must stay a hole (`null`) rather than
       * being compacted away — that alignment is what `toWriteForm` maps back onto the wire.
       */
      valueFrom: (row) =>
        RMP_CLASS_IMAGE_SLOTS.map((slot) => {
          const url = row?.[slot];
          return typeof url === "string" && url.trim() ? url : null;
        })
    }
  ],

  normalize(row) {
    const r = row ?? {};

    const rawColor = r.rmp_color ?? r.RmpColor ?? r.color;
    let embeddedColor;
    if (isPlainObject(rawColor)) {
      const idValue = rawColor.id ?? rawColor.rmp_color_id;
      if (idValue != null && idValue !== "") {
        embeddedColor = {
          id: normalizeId(idValue),
          name: String(rawColor.name ?? ""),
          code: normalizeHexCode(rawColor.code)
        };
      }
    }

    const rawColorId = r.rmp_color_id ?? r.rmpColorId ?? r.color_id ?? r.colorId;
    const rmpColorId =
      rawColorId != null && String(rawColorId) !== "" ? String(rawColorId) : embeddedColor?.id;

    // Per-slot legacy read: string, or {url} / {image_url}.
    const extractImage = (field) => {
      const value = r[field];
      if (typeof value === "string") return value;
      if (isPlainObject(value)) {
        if (typeof value.url === "string") return value.url;
        if (typeof value.image_url === "string") return value.image_url;
      }
      return undefined;
    };

    const images = {};

    // The `images: [...]` array wins: index -> slot, and the thumb is the SAME url
    // (the array form carries no separate thumbnails).
    if (Array.isArray(r.images)) {
      r.images.forEach((img, index) => {
        const slot = RMP_CLASS_IMAGE_SLOTS[index];
        if (!slot) return;
        const url = typeof img === "string" ? img : (img?.url ?? img?.image_url);
        images[slot] = url;
        images[`${slot}_thumb`] = url;
      });
    }

    // Fall back to the per-slot fields wherever the array left a hole.
    for (const slot of RMP_CLASS_IMAGE_SLOTS) {
      images[slot] = images[slot] ?? extractImage(slot);
      images[`${slot}_thumb`] =
        images[`${slot}_thumb`] ?? extractImage(`${slot}_thumb`) ?? extractImage(`${slot}_thumbnail`);
    }

    return {
      id: normalizeId(r.id ?? r.rmp_class_id),
      name: String(r.name ?? ""),
      position: readPosition(r.position),
      is_deleted: readIsDeleted(r),
      rmp_color_id: rmpColorId,
      rmp_color: embeddedColor,
      ...images,
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: readOptionalString(r.created_by),
      updated_by: readOptionalString(r.updated_by)
    };
  },

  async toCreatePayload(form) {
    const body = {
      name: form?.name,
      position: String(form?.position ?? 0),
      is_deleted: deletedFlagFor(form?.status)
    };
    const createColorId = withoutSentinel(form?.rmp_color_id);
    if (createColorId) body.rmp_color_id = createColorId;
    await attachRmpClassImages(form, body);
    return body;
  },

  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.position !== undefined) body.position = String(form.position);
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    if (form?.rmp_color_id !== undefined) {
      body.rmp_color_id = withoutSentinel(form.rmp_color_id) || "";
    }
    await attachRmpClassImages(form, body);
    return body;
  },

  /**
   * SOFT-DELETE COLLISION ON CREATE.
   * POSTing a name that already exists as a soft-deleted row makes Scott return that dead
   * row — it neither creates a new record nor reactivates the old one. The service must
   * detect it and follow up with a PATCH that flips `is_deleted` back to false.
   *
   * @param {Record<string, unknown>} rawRow  entity pulled out of the create response
   * @param {Record<string, unknown>} form    the form that was submitted
   * @returns {{reactivateId: string, form: Object}|null}
   *   non-null => run `update(reactivateId, await toUpdatePayload(form))` and return THAT
   *   row as the create result. null => use `rawRow` as-is.
   */
  onCreateResponse(rawRow, form) {
    const requestedName = String(form?.name ?? "");

    if (readIsDeleted(rawRow) && rawRow?.id) {
      if (import.meta.env.DEV) {
        console.warn(
          `[rmp_classes] Soft-deleted record returned for "${requestedName}" (id=${rawRow.id}) — reactivating via PATCH`
        );
      }
      return {
        reactivateId: String(rawRow.id),
        // Deliberately minimal: name + status only, plus the same image files. Matches
        // upstream `updateRmpClass(id, {status:'active', name}, imageFiles)`.
        form: { name: requestedName, status: "active", imageFiles: form?.imageFiles }
      };
    }

    if (import.meta.env.DEV) {
      const returnedName = String(rawRow?.name ?? "");
      if (requestedName.toLowerCase() !== returnedName.toLowerCase()) {
        console.warn(
          `[rmp_classes] NAME MISMATCH — requested "${requestedName}" but API returned name="${returnedName}"`,
          { requestedName, returnedName, id: rawRow?.id }
        );
      }
    }

    return null;
  },

  softDelete: true,
  supportsBulkDelete: true,

  relations: [
    {
      key: "linked_skus",
      kind: "inverse",
      readOnly: true,
      resource: "rmp_skus",
      // SKUs declare `rmp_class_id`; there is no endpoint on the class side.
      foreignKey: "rmp_class_id",
      label: "Linked SKUs"
    }
  ]
};

// ===========================================================================
// §20 — RMP SKUs
// ===========================================================================

export const rmpSkusConfig = {
  key: "rmp_skus",
  resource: "rmp_skus",
  label: "RMP SKUs",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_sku_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,

  /**
   * `search` is sent to the server AND applied client-side: the rmp_skus endpoint accepts
   * the param but IGNORES it, so without the client pass the list looks unfiltered.
   */
  searchMode: "server+client",
  buildListQuery: buildStandardListQuery,

  /**
   * Case-insensitive `name` contains, applied to the page the server returned. Works on raw
   * or normalized rows (both expose `name`).
   */
  clientSearch(rows, search) {
    if (!search) return rows;
    const needle = String(search).toLowerCase();
    return (rows ?? []).filter((r) => String(r?.name ?? "").toLowerCase().includes(needle));
  },

  detail: { extract: extractDetailData },

  fetchAll: {
    // The endpoint is unhappy with large pages; 100 x 250 pages = up to 25k SKUs.
    pageSize: 100,
    maxPages: 250,
    /** Dropdowns must degrade, not explode — a failed drain resolves to []. */
    onErrorReturnEmpty: true
  },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "image", header: "Image", type: "image" },
    { key: "cgst", header: "CGST", type: "percent", sortable: true },
    { key: "igst", header: "IGST", type: "percent", sortable: true },
    { key: "sgst", header: "SGST", type: "percent", sortable: true },
    // All four relations are KEYED ON THE FK, not on the embedded object (audit fix).
    // The rmp_skus list frequently returns only `rmp_size_id` / `rmp_class_id` / … with no
    // embedded `{id,name}`, and a column keyed on the object then rendered an em dash for
    // every row. ScottOne resolves the same four through its drained master maps
    // (`RmpSkusPage.tsx:105-126, 401-404`); here `optionsResource` feeds the identical map
    // in through `decorateMasterColumns`, and `format` keeps the embedded object as the
    // zero-request fast path.
    {
      key: "rmp_size_id",
      header: "Size",
      type: "relation",
      sortable: true,
      optionsResource: "rmp_sizes",
      format: embeddedOrId("rmp_size")
    },
    {
      key: "rmp_class_id",
      header: "Class",
      type: "relation",
      sortable: true,
      optionsResource: "rmp_classes",
      format: embeddedOrId("rmp_class")
    },
    {
      key: "rmp_brand_id",
      header: "Brand",
      type: "relation",
      sortable: true,
      optionsResource: "rmp_brands",
      format: embeddedOrId("rmp_brand")
    },
    {
      key: "rmp_category_id",
      header: "Category",
      type: "relation",
      sortable: true,
      optionsResource: "rmp_categories",
      format: embeddedOrId("rmp_category")
    },
    { key: "status", header: "Status", type: "badge", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "cgst", label: "CGST", type: "number", min: 0, max: 100, defaultValue: 0 },
    { key: "igst", label: "IGST", type: "number", min: 0, max: 100, defaultValue: 0 },
    { key: "sgst", label: "SGST", type: "number", min: 0, max: 100, defaultValue: 0 },
    // All four are nullable and ALL FOUR CARRY THE SENTINEL (audit fix): the dialog filters
    // out empty option values, so `nullable + emptyLabel` alone produced no None row and a
    // size/class/brand/category that had been set could never be cleared. ScottOne offers a
    // SELECT_NONE item on each of them (`RmpSkusPage.tsx:488, 507, 520`). Both payload
    // builders strip the sentinel — `''` is what a PATCH sends to CLEAR the column.
    {
      key: "rmp_size_id",
      label: "Size",
      type: "select",
      optionsResource: "rmp_sizes",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    {
      key: "rmp_class_id",
      label: "Class",
      type: "select",
      optionsResource: "rmp_classes",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    {
      key: "rmp_brand_id",
      label: "Brand",
      type: "select",
      optionsResource: "rmp_brands",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    {
      key: "rmp_category_id",
      label: "Category",
      type: "select",
      optionsResource: "rmp_categories",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" },
    { key: "image", label: "Image", type: "image" }
  ],

  normalize(row) {
    const r = row ?? {};

    const embeddedSize = readEmbeddedRelation(r, "rmp_size", "RmpSize", "rmp_size_id");
    const embeddedClass = readEmbeddedRelation(r, "rmp_class", "RmpClass", "rmp_class_id");
    const embeddedBrand = readEmbeddedRelation(r, "rmp_brand", "RmpBrand", "rmp_brand_id");
    const embeddedCategory = readEmbeddedRelation(r, "rmp_category", "RmpCategory", "rmp_category_id");

    return {
      id: normalizeId(r.id ?? r.rmp_sku_id),
      name: String(r.name ?? ""),
      cgst: readTaxRate(r.cgst),
      igst: readTaxRate(r.igst),
      sgst: readTaxRate(r.sgst),
      is_deleted: readIsDeleted(r),
      // Flat snake_case, then camelCase, then the embedded relation id.
      rmp_size_id: readForeignKey(r, "rmp_size_id", "rmpSizeId", embeddedSize),
      rmp_class_id: readForeignKey(r, "rmp_class_id", "rmpClassId", embeddedClass),
      rmp_brand_id: readForeignKey(r, "rmp_brand_id", "rmpBrandId", embeddedBrand),
      rmp_category_id: readForeignKey(r, "rmp_category_id", "rmpCategoryId", embeddedCategory),
      image: r.image ? String(r.image) : undefined,
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: readOptionalString(r.created_by),
      updated_by: readOptionalString(r.updated_by),
      rmp_size: embeddedSize,
      rmp_class: embeddedClass,
      rmp_brand: embeddedBrand,
      rmp_category: embeddedCategory
    };
  },

  async toCreatePayload(form) {
    const body = {
      name: form?.name,
      cgst: String(form?.cgst ?? 0),
      igst: String(form?.igst ?? 0),
      sgst: String(form?.sgst ?? 0),
      is_deleted: deletedFlagFor(form?.status)
    };
    // POST omits empty FKs entirely (no ''-to-clear on create). The None sentinel is
    // stripped to '' first, which is falsy — so "None" simply omits the key.
    const createSizeId = withoutSentinel(form?.rmp_size_id);
    const createClassId = withoutSentinel(form?.rmp_class_id);
    const createBrandId = withoutSentinel(form?.rmp_brand_id);
    const createCategoryId = withoutSentinel(form?.rmp_category_id);
    if (createSizeId) body.rmp_size_id = createSizeId;
    if (createClassId) body.rmp_class_id = createClassId;
    if (createBrandId) body.rmp_brand_id = createBrandId;
    if (createCategoryId) body.rmp_category_id = createCategoryId;
    await attachImageFile(form, body);
    return body;
  },

  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.cgst !== undefined) body.cgst = String(form.cgst);
    if (form?.igst !== undefined) body.igst = String(form.igst);
    if (form?.sgst !== undefined) body.sgst = String(form.sgst);
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    // PATCH sends '' to CLEAR an FK — the key being present is the signal. The None
    // sentinel becomes '' here, which is exactly the clear.
    if (form?.rmp_size_id !== undefined) {
      body.rmp_size_id = withoutSentinel(form.rmp_size_id) || "";
    }
    if (form?.rmp_class_id !== undefined) {
      body.rmp_class_id = withoutSentinel(form.rmp_class_id) || "";
    }
    if (form?.rmp_brand_id !== undefined) {
      body.rmp_brand_id = withoutSentinel(form.rmp_brand_id) || "";
    }
    if (form?.rmp_category_id !== undefined) {
      body.rmp_category_id = withoutSentinel(form.rmp_category_id) || "";
    }
    await attachImageFile(form, body);
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,

  relations: [
    { key: "rmp_size_id", kind: "belongsTo", resource: "rmp_sizes", label: "Size" },
    { key: "rmp_class_id", kind: "belongsTo", resource: "rmp_classes", label: "Class" },
    { key: "rmp_brand_id", kind: "belongsTo", resource: "rmp_brands", label: "Brand" },
    { key: "rmp_category_id", kind: "belongsTo", resource: "rmp_categories", label: "Category" }
  ]
};

// ===========================================================================
// §21 — RMP Price Types
// ===========================================================================

export const rmpPriceTypesConfig = {
  key: "rmp_price_types",
  resource: "rmp_price_types",
  label: "RMP Price Types",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_price_type_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: buildStandardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "price_for", header: "Price For", type: "text", sortable: true },
    { key: "zone_id", header: "Zone ID", type: "text", sortable: true },
    { key: "zone", header: "Zone", type: "relation" },
    { key: "status", header: "Status", type: "badge", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "price_for",
      label: "Price for",
      type: "select",
      required: true,
      defaultValue: "zone",
      options: [
        { value: "customer", label: "Customer" },
        { value: "dealer", label: "Dealer" },
        { value: "zone", label: "Zone" }
      ]
    },
    {
      key: "zone_id",
      // Upstream is a free-text field, NOT a dropdown: `<Input value={zoneId} …
      // placeholder="Scott zone id (numeric)">` with the hint "Scott dashboard zone
      // identifier (not app zones)" (RmpPriceTypesPage.tsx:311-320). It is deliberately
      // NOT the local Supabase `zones` master — different id space — so a zones-backed
      // select would be wrong, not just missing. Typed `text` so `required` is satisfiable;
      // as a `select` with no option source this field was unsavable.
      label: "Zone ID (Scott)",
      type: "text",
      placeholder: "Scott zone id (numeric)",
      hint: "Scott dashboard zone identifier (not app zones)",
      // ScottOne blocks the save outright without a zone — `onSave` returns early and the
      // submit button stays disabled on `!zoneId.trim()` (RmpPriceTypesPage.tsx:159, 342).
      required: true
    },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" }
  ],

  normalize(row) {
    const r = row ?? {};

    let zone;
    if (isPlainObject(r.zone)) {
      // Note: no id guard here — an embedded zone object always produces a relation.
      zone = { id: normalizeId(r.zone.id), name: String(r.zone.name ?? "") };
    }

    // Show responses may wrap the entity: `{ rmp_price_type: {...} }`.
    //
    // INTENTIONAL DIVERGENCE FROM UPSTREAM. ScottOne reads `status` off the OUTER row while
    // taking every other field from the unwrapped envelope, so a soft-deleted price type
    // opened in the dialog as "Active" (the wrapper carries no `is_deleted`) and the very
    // next save silently REACTIVATED it. That is a data-corrupting bug, not a quirk worth
    // reproducing: status now comes from the same source as everything else, falling back to
    // the outer row only when the unwrapped one says nothing about it.
    const src = isPlainObject(r.rmp_price_type) ? r.rmp_price_type : r;
    const statusSource =
      typeof src.status === "string" || src.is_deleted !== undefined ? src : r;
    const status = readStatus(statusSource);

    return {
      id: normalizeId(src.id ?? r.rmp_price_type_id),
      name: String(src.name ?? ""),
      // '' / null collapse back to 'zone'.
      price_for: String(src.price_for ?? "zone") || "zone",
      zone_id: String(src.zone_id ?? ""),
      is_deleted: src.is_deleted === true || src.is_deleted === "true",
      status,
      zone,
      created_at: readTimestamp(src.created_at),
      updated_at: readTimestamp(src.updated_at)
    };
  },

  // async purely for a uniform service contract — nothing here awaits.
  async toCreatePayload(form) {
    return {
      name: form?.name,
      price_for: form?.price_for,
      zone_id: form?.zone_id,
      is_deleted: deletedFlagFor(form?.status)
    };
  },

  // async purely for a uniform service contract — nothing here awaits.
  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.price_for !== undefined) body.price_for = form.price_for;
    if (form?.zone_id !== undefined) body.zone_id = form.zone_id;
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,
  relations: []
};

// ===========================================================================
// §22 — RMP Prices (+ CSV bulk upload)
// ===========================================================================

export const rmpPricesConfig = {
  key: "rmp_prices",
  resource: "rmp_prices",
  label: "RMP Prices",
  group: RMP_GROUP,
  idField: "id",
  altIdField: "rmp_price_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",

  /** Server-side filters this list understands beyond `search`. */
  serverFilters: ["rmp_sku_id"],

  buildListQuery({ page, items, search, filters }) {
    const query = { items, page, is_deleted: false };
    if (search) query.search = search;
    // Real server-side filter — the endpoint narrows to one SKU's price rows.
    if (filters?.rmp_sku_id) query.rmp_sku_id = filters.rmp_sku_id;
    return query;
  },

  detail: { extract: extractDetailData },

  fetchAll: {
    // Price rows are numerous but small; 1000 per request is the tuned size.
    pageSize: 1000
  },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "price", header: "Price", type: "currency", sortable: true },
    { key: "mrp", header: "MRP", type: "currency", sortable: true },
    // SKU stays keyed on the embedded object — the list endpoint DOES return `rmp_sku`
    // (ScottOne reads `r.rmp_sku?.name` at `RmpPricesPage.tsx:393`).
    { key: "rmp_sku", header: "SKU", type: "relation", sortable: true },
    // Price type must be keyed on the FK (audit fix). The list endpoint does NOT embed
    // `rmp_price_type`, which is why ScottOne resolves it from the drained price-types
    // master instead (`RmpPricesPage.tsx:395`) rather than off the row. Keyed on the object
    // this cell was an em dash on EVERY row.
    {
      key: "rmp_price_type_id",
      header: "Price type",
      type: "relation",
      sortable: true,
      optionsResource: "rmp_price_types",
      format: embeddedOrId("rmp_price_type")
    },
    { key: "status", header: "Status", type: "badge", sortable: true }
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "price", label: "Price", type: "number", min: 0, required: true, defaultValue: 0 },
    { key: "mrp", label: "MRP", type: "number", min: 0, required: true, defaultValue: 0 },
    {
      key: "rmp_sku_id",
      label: "SKU",
      type: "select",
      optionsResource: "rmp_skus",
      required: true
    },
    {
      key: "rmp_price_type_id",
      label: "Price type",
      type: "select",
      optionsResource: "rmp_price_types",
      required: true
    },
    { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "active" }
  ],

  normalize(row) {
    const r = row ?? {};

    // Both relations are built from ANY embedded object (no id guard) — matches upstream.
    let rmpSku;
    if (isPlainObject(r.rmp_sku)) {
      rmpSku = { id: normalizeId(r.rmp_sku.id), name: String(r.rmp_sku.name ?? "") };
    }

    let rmpPriceType;
    if (isPlainObject(r.rmp_price_type)) {
      rmpPriceType = {
        id: normalizeId(r.rmp_price_type.id),
        name: String(r.rmp_price_type.name ?? ""),
        price_for: r.rmp_price_type.price_for ? String(r.rmp_price_type.price_for) : undefined
      };
    }

    // NB: relation id FIRST, flat field as the fallback — the opposite precedence to
    // rmp_skus. Keep it that way.
    const idFromRelation = (relKey) => {
      const rel = r[relKey];
      if (!isPlainObject(rel)) return "";
      const id = rel.id ?? rel[`${relKey}_id`];
      return id ? normalizeId(id) : "";
    };

    return {
      id: normalizeId(r.id ?? r.rmp_price_id),
      name: String(r.name ?? ""),
      price: readAmount(r.price),
      mrp: readAmount(r.mrp),
      is_deleted: readIsDeleted(r),
      status: readStatus(r),
      rmp_sku_id: idFromRelation("rmp_sku") || String(r.rmp_sku_id ?? ""),
      rmp_price_type_id: idFromRelation("rmp_price_type") || String(r.rmp_price_type_id ?? ""),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      rmp_sku: rmpSku,
      rmp_price_type: rmpPriceType
    };
  },

  // async purely for a uniform service contract — nothing here awaits.
  async toCreatePayload(form) {
    return {
      name: form?.name,
      price: String(form?.price),
      mrp: String(form?.mrp),
      is_deleted: deletedFlagFor(form?.status),
      rmp_sku_id: form?.rmp_sku_id,
      rmp_price_type_id: form?.rmp_price_type_id
    };
  },

  // async purely for a uniform service contract — nothing here awaits.
  async toUpdatePayload(form /* , prev */) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.price !== undefined) body.price = String(form.price);
    if (form?.mrp !== undefined) body.mrp = String(form.mrp);
    if (form?.status !== undefined) body.is_deleted = deletedFlagFor(form.status);
    // Unlike the other RMP FKs these are sent verbatim — no ''-to-clear coercion, because
    // a price row without a SKU or price type is meaningless.
    if (form?.rmp_sku_id !== undefined) body.rmp_sku_id = form.rmp_sku_id;
    if (form?.rmp_price_type_id !== undefined) body.rmp_price_type_id = form.rmp_price_type_id;
    return body;
  },

  softDelete: true,
  supportsBulkDelete: true,

  /**
   * CSV BULK UPLOAD — endpoint descriptors only.
   * Deliberately NOT implemented here: the upload/poll runner and its status dialog belong
   * to the bulk phase (bulkService.js). This block exists so that phase does not have to
   * re-derive the wire details.
   *
   * Flow: POST the CSV, parse the response as a status; if the phase is non-terminal, poll
   * `bulk_upload_status` until `completed`/`failed`. `idle` only counts as
   * "completed" after `minPollsBeforeIdleTerminal` polls (the job needs a moment to
   * register upstream).
   */
  bulkUpload: {
    method: "POST",
    pathSuffix: "bulk_upload",
    fileField: "file",
    /**
     * @param {{__base64File:true,data:string,filename:string}} filePayload from fileToScottPayload
     * @param {{replaceAll?: boolean}} [options]
     */
    buildBody(filePayload, options) {
      return {
        file: filePayload,
        replace_all: options?.replaceAll ? "true" : "false"
      };
    },
    status: { method: "GET", pathSuffix: "bulk_upload_status" },
    poll: {
      intervalMs: 2_000,
      timeoutMs: 30 * 60 * 1_000,
      /** Ignore `idle` until this many polls have come back. */
      minPollsBeforeIdleTerminal: 2
    },
    /**
     * Status parsing is defensive — the upstream keys drift. Aliases, for bulkService:
     *   phase   <- status | state | job_status | upload_status  (+ a `success` boolean)
     *   total   <- total | total_rows | count | row_count
     *   processed <- processed | processed_rows | completed | completed_rows | imported
     *   created <- created | created_count | inserted | inserted_count
     *   updated <- updated | updated_count
     *   failed  <- failed | failed_count | errors_count | failure_count
     *   skipped <- skipped | skipped_count
     *   progress<- progress | percentage | percent
     *   failures<- failures | errors | error_rows | failed_rows
     *             (row number <- row | row_number | line | line_number)
     */
    statusAliases: {
      phase: ["status", "state", "job_status", "upload_status"],
      total: ["total", "total_rows", "count", "row_count"],
      processed: ["processed", "processed_rows", "completed", "completed_rows", "imported"],
      created: ["created", "created_count", "inserted", "inserted_count"],
      updated: ["updated", "updated_count"],
      failed: ["failed", "failed_count", "errors_count", "failure_count"],
      skipped: ["skipped", "skipped_count"],
      progress: ["progress", "percentage", "percent"],
      failures: ["failures", "errors", "error_rows", "failed_rows"],
      failureRowNumber: ["row", "row_number", "line", "line_number"]
    }
  },

  /**
   * Bulk-import matching (CSV rows -> existing price rows) keys on the
   * `(rmp_sku_id, rmp_price_type_id)` PAIR, not on name. Strategy switch:
   *   <= 40 unique SKUs -> per-SKU queries (`rmp_sku_id` filter, items 500, <=50 pages,
   *                        concurrency 8, early exit once every pair is found)
   *   otherwise         -> parallel full scan (items 5000, concurrency 6, <=250 pages,
   *                        early exit)
   */
  bulkImportMatch: {
    matchKeys: ["rmp_sku_id", "rmp_price_type_id"],
    perSkuThreshold: 40,
    perSku: { pageSize: 500, maxPages: 50, concurrency: 8 },
    fullScan: { pageSize: 5000, maxPages: 250, concurrency: 6 }
  },

  relations: [
    { key: "rmp_sku_id", kind: "belongsTo", resource: "rmp_skus", label: "SKU", required: true },
    {
      key: "rmp_price_type_id",
      kind: "belongsTo",
      resource: "rmp_price_types",
      label: "Price type",
      required: true
    }
  ]
};

// ===========================================================================
// Registry
// ===========================================================================

/** All 8 RMP configs, in the order they should appear under "Ready-made products". */
export const RMP_MASTER_CONFIGS = Object.freeze([
  rmpColorsConfig,
  rmpSizesConfig,
  rmpBrandsConfig,
  rmpCategoriesConfig,
  rmpClassesConfig,
  rmpSkusConfig,
  rmpPriceTypesConfig,
  rmpPricesConfig
]);

export default RMP_MASTER_CONFIGS;
