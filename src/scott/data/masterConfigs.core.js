// Scott master configs — the NON-RMP ("core") family, §1–§14.
//
//   authorized_brands, colors, sc_sizes, size_types, base_product_types, parts,
//   add_ons, fabrics, base_products, asset_infos, base_product_asset_infos,
//   profit_margins, promotions, promotional_banners
//
// Consumed by `createMastersService` (mastersService.js). §15–§22 — the RMP family —
// live in masterConfigs.rmp.js and follow the same contract.
//
// ---------------------------------------------------------------------------
// CONTRACT WITH mastersService (identical to the RMP file's)
// ---------------------------------------------------------------------------
// 1. `toCreatePayload` / `toUpdatePayload` are ASYNC (image fields base64-encode or
//    re-download), and the service awaits them.
// 2. Form conventions the builders read:
//      - `form.<imageKey>`  — the EXISTING image URL (`logo_url`, `image_url`,
//        `asset`, `banner_image`)
//      - `form.<fileKey>`   — a freshly picked `File` (`logoFile`, `imageFile`,
//        `assetFile`); each field declares its own `fileKey`.
// 3. `buildListQuery({page, items, search, filters})` is the AUTHORITY for list query
//    params; `listParams` is kept only as the documented static base.
// 4. `detail.extract(body)` unwraps show responses. Entities with no show endpoint
//    upstream use `getByIdMode: 'find'` instead (client-side find over the full list).
// 5. Updates are READ-MERGE-WRITE for brands, colors, size types, base product types,
//    app assets, profit margins and promotions — their PATCH expects the FULL body, so
//    `toUpdatePayload` merges `prev` (re-read by the service) with the form. Everything
//    else PATCHes only the fields the form supplied.
//
// EVERY field name in a payload builder is a WIRE name and must match Scott exactly:
// `add_on`, `add_on_price`, `position`, `size_type_id`, `base_of`, `tims_cost`,
// `over_header_percentage`, `category`, `thumbnail`, `name` (promotions title)…
// The UI-facing names produced by `normalize` are deliberately different in places.
//
// Namespace notes (the edge function handles these; listed so nobody "fixes" them):
//   * `profit_margins`, `promotions`, `size_types` -> /api/v1/…  (bulk_delete stays dashboard ns)
//   * `base_product_types` list is a POST to /api/v1/products/base_product_types — the
//     CLIENT still sends method "GET" with no pathSuffix; the edge rewrites it.
//   * everything else -> /api/dashboard/v1/…
//
// Ported from the ScottOne services (`brandsService.ts`, `colorsService.ts`,
// `sizesServiceScott.ts`, …). Where the upstream behaviour looks like a bug it is
// reproduced and commented — do not "fix" it here.

import {
  attachScottImageField,
  boolString,
  createMastersService,
  extractRelationIds,
  extractRelationObject,
  indexedIds,
  isDeletedString,
  normalizeHexCode,
  optionalNumber,
  optionalString,
  pickUrl,
  readBoolean,
  readStatus,
  readTimestamp,
  toNumber
} from "./mastersService";
import { normalizeId } from "../scottClient";

/** Left-rail groupings for the Masters screen. `RMP` matches masterConfigs.rmp.js. */
export const MASTER_GROUPS = Object.freeze({
  CATALOGUE: "Catalogue",
  ASSETS: "App assets",
  PRICING: "Pricing",
  PROMOTIONS: "Promotions",
  RMP: "Ready-made products"
});

/** Scott's page-size param is `items`; 20 matches the app-wide default. */
const DEFAULT_PAGE_SIZE = 20;

const STATUS_OPTIONS = Object.freeze([
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
]);

/**
 * Radix sentinel for "no relation" in a nullable FK select. A `Select` cannot hold an empty
 * string value and the dialog filters out empty option values, so a nullable FK needs a real
 * token for its None row; every payload builder strips it back to `''`, which is what a PATCH
 * sends to CLEAR the column. Shared by §9 base_products and §14 promotional_banners.
 * (Same token as `RMP_NONE` in masterConfigs.rmp.js.)
 */
const RMP_NONE = "__rmp_none__";

/** `''` for the None sentinel, the value untouched otherwise. */
const withoutSentinel = (value) => (value === RMP_NONE ? "" : value);

/** Profit margins use `deleted` rather than `inactive` (§12). */
const PM_STATUS_OPTIONS = Object.freeze([
  { value: "active", label: "Active" },
  { value: "deleted", label: "Deleted" }
]);

const statusColumn = () => ({ key: "status", header: "Status", type: "badge", sortable: true });
const timestampColumns = () => [
  { key: "created_at", header: "Created At", type: "datetime", sortable: true },
  { key: "updated_at", header: "Updated At", type: "datetime", sortable: true }
];
const statusField = () => ({
  key: "status",
  label: "Status",
  type: "select",
  options: STATUS_OPTIONS,
  defaultValue: "active",
  wire: "is_deleted"
});

/** The list query almost every master uses: `{items, page, is_deleted:false}` + `search`. */
function standardListQuery({ page, items, search }) {
  const query = { items, page, is_deleted: false };
  if (search) query.search = search;
  return query;
}

/** Show responses are `{ data: {...} }` wherever a show endpoint is actually used. */
function extractDetailData(body) {
  const data = body && typeof body === "object" ? body.data : null;
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}

// ---------------------------------------------------------------------------
// §1 Brands (Authorized Brands) — resource `authorized_brands`
// ---------------------------------------------------------------------------

/** Shared by create and update: this endpoint always wants the full body. */
async function brandToForm(data) {
  const isActive = data.status === "active";
  const body = {
    name: data.name ?? "",
    description: data.description ?? "",
    status: isActive ? "active" : "inactive",
    is_deleted: isActive ? "false" : "true",
    sort_order: String(data.sort_order ?? 0)
  };
  if (data.logo_url) body.logo_url = data.logo_url;
  // Explicit file wins; otherwise an existing http(s) logo is re-downloaded and
  // re-uploaded on EVERY save (upstream behaviour, kept deliberately).
  await attachScottImageField(body, "logo", {
    file: data.logoFile,
    url: data.logo_url,
    filename: "logo.png"
  });
  return body;
}

export const authorizedBrandsConfig = {
  key: "authorized_brands",
  resource: "authorized_brands",
  label: "Brands",
  labelSingular: "brand",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "authorized_brand_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  // No show endpoint is used upstream — resolve by id from the full list.
  getByIdMode: "find",

  /**
   * ScottOne ordered brands by `sort_order` then name. `useScottList` models one sort key
   * only, so `sort_order` is what is restored — and the column exists precisely to be
   * ordered by. SAFE HERE: `authorized_brands` already runs `getByIdMode: 'find'`, i.e. the
   * full list is drained anyway, so the drain an active sort forces costs nothing new.
   */
  defaultSort: { key: "sort_order", direction: "asc" },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "description", header: "Description", type: "text" },
    { key: "logo_url", header: "Logo", type: "image" },
    { key: "sort_order", header: "Sort Order", type: "number", sortable: true },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true, maxLength: 255 },
    { key: "description", label: "Description", type: "textarea" },
    { key: "logo_url", label: "Logo", type: "image", fileKey: "logoFile", wire: "logo" },
    { key: "sort_order", label: "Sort order", type: "number", min: 0, defaultValue: 0 },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id ?? r.authorized_brand_id),
      name: String(r.name ?? ""),
      description: r.description != null ? String(r.description) : undefined,
      logo_url: typeof r.logo_url === "string" ? r.logo_url : pickUrl(r.logo),
      status: readStatus(r),
      sort_order: optionalNumber(r.sort_order),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    return brandToForm(form ?? {});
  },
  // Read-merge-write: `prev` is the freshly re-read row supplied by the service.
  async toUpdatePayload(form, prev) {
    const merged = { ...(prev ?? {}), ...(form ?? {}) };
    return brandToForm({
      name: merged.name,
      description: merged.description,
      logo_url: merged.logo_url,
      status: merged.status,
      sort_order: merged.sort_order,
      logoFile: form?.logoFile
    });
  },

  readMergeWrite: true,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [],
  /** A minimal create response is recovered by re-listing and matching on name. */
  createRecovery: { field: "name", match: "exact", tieBreak: "updated_at", includeSnippet: true },
  messages: {
    notFound: "Brand not found",
    createFailed: "Unexpected create brand response",
    updateFailed: "Unexpected update brand response"
  }
};

// ---------------------------------------------------------------------------
// §2 Colors — resource `colors`
// ---------------------------------------------------------------------------

function colorToForm(data) {
  const isActive = data.status === "active";
  return {
    name: data.name ?? "",
    // Sent exactly as the form holds it — upstream does NOT normalize on write.
    hex_code: data.hex_code ?? "",
    status: isActive ? "active" : "inactive",
    is_deleted: isActive ? "false" : "true"
  };
}

export const colorsConfig = {
  key: "colors",
  resource: "colors",
  label: "Colors",
  labelSingular: "color",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "color_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,
  getByIdMode: "find",

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "hex_code", header: "Hex", type: "color", sortable: true },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "hex_code", label: "Hex code", type: "color", required: true, defaultValue: "#000000" },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id),
      name: String(r.name ?? ""),
      // Android ARGB (`0xAARRGGBB`) and bare hex are both normalized on read.
      hex_code: normalizeHexCode(r.hex_code),
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: r.created_by ? String(r.created_by) : undefined,
      updated_by: r.updated_by ? String(r.updated_by) : undefined
    };
  },

  async toCreatePayload(form) {
    return colorToForm(form ?? {});
  },
  async toUpdatePayload(form, prev) {
    const merged = { ...(prev ?? {}), ...(form ?? {}) };
    return colorToForm({ name: merged.name, hex_code: merged.hex_code, status: merged.status });
  },

  readMergeWrite: true,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [],
  messages: {
    notFound: "Color not found",
    createFailed: "Unexpected create color response",
    updateFailed: "Unexpected update color response"
  }
};

// ---------------------------------------------------------------------------
// §3 Sizes (SC sizes) — resource `sc_sizes`
// UI `size_group_id` ⇄ wire `size_type_id`; UI `sort_order` ⇄ wire `position`.
// The list endpoint takes NO `search`, and create sends neither `status` nor `code`.
// ---------------------------------------------------------------------------

export const scSizesConfig = {
  key: "sc_sizes",
  resource: "sc_sizes",
  label: "Sizes",
  labelSingular: "size",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "sc_size_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  /** Deliberate: the upstream hook never sends a search term for sizes. */
  searchMode: "none",
  buildListQuery: ({ page, items }) => ({ items, page, is_deleted: false }),

  detail: { extract: extractDetailData },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "code", header: "Code", type: "text", sortable: true },
    {
      key: "size_group_id",
      header: "Size Type",
      type: "relation",
      optionsResource: "size_types"
    },
    { key: "sort_order", header: "Position", type: "number", sortable: true },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "code",
      label: "Code",
      type: "text",
      // Scott derives the code from the name and accepts neither on create nor on update,
      // so the input is DISABLED as well as annotated — an editable box whose value
      // silently reverts on save is worse than no box at all.
      disabled: true,
      note: "Display only — never sent to Scott"
    },
    {
      key: "size_group_id",
      label: "Size type",
      type: "select",
      required: true,
      requiredMessage: "Size Type is required",
      wire: "size_type_id",
      optionsResource: "size_types"
    },
    {
      key: "sort_order",
      label: "Position",
      type: "number",
      min: 0,
      defaultValue: 0,
      wire: "position"
    },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id ?? r.sc_size_id),
      name: String(r.name ?? ""),
      code: String(r.code ?? r.name ?? ""),
      size_group_id: String(r.size_type_id ?? r.size_group_id ?? ""),
      status: readStatus(r),
      sort_order: r.position != null ? Number(r.position) : optionalNumber(r.sort_order),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    const isActive = form?.status === "active";
    return {
      name: form?.name ?? "",
      size_type_id: form?.size_group_id ?? "",
      is_deleted: isActive ? "false" : "true",
      position: String(form?.sort_order ?? 0)
    };
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.size_group_id !== undefined) body.size_type_id = form.size_group_id;
    if (form?.status !== undefined) body.is_deleted = isDeletedString(form.status);
    if (form?.sort_order !== undefined) body.position = String(form.sort_order);
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [],
  messages: {
    createFailed: "Failed to create size: invalid response",
    updateFailed: "Failed to update size: invalid response"
  }
};

// ---------------------------------------------------------------------------
// §4 Size Types — resource `size_types` (v1 namespace)
// ---------------------------------------------------------------------------

function sizeTypeToForm(data) {
  const isActive = data.status === "active";
  return {
    name: data.name ?? "",
    status: isActive ? "active" : "inactive",
    is_deleted: isActive ? "false" : "true"
  };
}

export const sizeTypesConfig = {
  key: "size_types",
  resource: "size_types",
  label: "Size Types",
  labelSingular: "size type",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "size_type_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,
  getByIdMode: "find",

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id),
      name: String(r.name ?? ""),
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    return sizeTypeToForm(form ?? {});
  },
  async toUpdatePayload(form, prev) {
    return sizeTypeToForm({
      name: form?.name ?? prev?.name,
      status: form?.status ?? prev?.status
    });
  },

  readMergeWrite: true,
  softDelete: true,
  // bulk_delete would resolve to the dashboard ns, but no page wires it up upstream.
  supportsBulkDelete: false,
  relations: [],
  messages: {
    notFound: "Size type not found",
    createFailed: "Unexpected create size type response",
    updateFailed: "Unexpected update size type response"
  }
};

// ---------------------------------------------------------------------------
// §5 Base Product Types ("Parent Categories") — resource `base_product_types`
// Split namespace (list is a POST upstream), and the ONLY master whose list sends
// no `is_deleted` filter. bulk_delete is unusable here: the edge function never
// attaches a DELETE body for this resource, so `ids[]` would be dropped silently.
// ---------------------------------------------------------------------------

async function baseProductTypeToForm(data) {
  const isActive = data.status === "active";
  const body = {
    name: data.name ?? "",
    is_deleted: isActive ? "false" : "true",
    status: isActive ? "active" : "inactive",
    position: String(data.position ?? 0)
  };
  await attachScottImageField(body, "image", {
    file: data.imageFile,
    url: data.image ?? data.image_url,
    filename: "image.png"
  });
  return body;
}

export const baseProductTypesConfig = {
  key: "base_product_types",
  resource: "base_product_types",
  label: "Base Product Types",
  labelSingular: "parent category",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "base_product_type_id",

  listParams: {}, // no is_deleted filter upstream
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  /** No `is_deleted` — this list returns soft-deleted rows too. */
  buildListQuery({ page, items, search }) {
    const query = { items, page };
    if (search) query.search = search;
    return query;
  },
  /** The edge fn turns this GET into POST /api/v1/products/base_product_types. */
  listMethod: "GET",
  getByIdMode: "find",

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "position", header: "Position", type: "number", sortable: true },
    { key: "image_url", header: "Image", type: "image" },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "position", label: "Position", type: "number", min: 0, defaultValue: 0 },
    { key: "image_url", label: "Image", type: "image", fileKey: "imageFile", wire: "image" },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id),
      name: String(r.name ?? ""),
      status: readStatus(r),
      position: optionalNumber(r.position),
      // Upstream sometimes PascalCases this one.
      image_url:
        typeof r.image_url === "string"
          ? r.image_url
          : typeof r.Image === "string"
            ? r.Image
            : undefined,
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    return baseProductTypeToForm(form ?? {});
  },
  async toUpdatePayload(form, prev) {
    return baseProductTypeToForm({
      name: form?.name ?? prev?.name,
      status: form?.status ?? prev?.status,
      position: form?.position ?? prev?.position,
      image: form?.image ?? form?.image_url ?? prev?.image_url,
      imageFile: form?.imageFile
    });
  },

  readMergeWrite: true,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [],
  createRecovery: { field: "name", match: "ci" },
  messages: {
    notFound: "Parent category not found",
    createFailed: "Unexpected create parent category response",
    updateFailed: "Unexpected update parent category response"
  }
};

// ---------------------------------------------------------------------------
// §6 Parts — resource `parts`
// UI `sort_position` ⇄ wire `position`.
// ---------------------------------------------------------------------------

export const partsConfig = {
  key: "parts",
  resource: "parts",
  label: "Parts",
  labelSingular: "part",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "part_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  detail: { extract: extractDetailData },

  /**
   * ScottOne always renders parts ordered by `sort_position` (`PartsPage.tsx:77`), and a
   * parts list that ignores its own position column is misleading. SAFE HERE: `parts` is a
   * tiny master (tens of rows), and an active sort switches `useScottList` into full-drain
   * mode — one small extra request, then everything is in memory.
   */
  defaultSort: { key: "sort_position", direction: "asc" },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "order_criteria", header: "Order Criteria", type: "boolean", sortable: true },
    { key: "sort_position", header: "Position", type: "number", decimals: 0, sortable: true },
    statusColumn(),
    // The two linked-relation columns ScottOne shows (`PartsPage.tsx:232-240`). `normalize`
    // already emits both id arrays; `optionsResource` is what turns the ids into names,
    // exactly as ScottOne's `resolveAddOnNames` / `resolveColors` maps do.
    {
      key: "add_on_ids",
      header: "Linked Add-Ons",
      type: "relation-list",
      optionsResource: "add_ons"
    },
    {
      key: "selected_colors",
      header: "Linked Colors",
      type: "relation-list",
      optionsResource: "colors"
    },
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "order_criteria", label: "Order criteria", type: "switch", defaultValue: false },
    {
      key: "sort_position",
      label: "Position",
      type: "number",
      min: 0,
      defaultValue: 0,
      wire: "position"
    },
    statusField(),
    {
      key: "add_on_ids",
      label: "Add-ons",
      type: "multiselect",
      defaultValue: [],
      // Saved by a SECOND request after the part itself (update_add_ons).
      relation: "update_add_ons",
      optionsResource: "add_ons"
    }
  ],

  normalize(row) {
    const r = row ?? {};
    const addOnIds = extractRelationIds(r, ["add_ons"], ["add_on_ids"]);
    return {
      id: normalizeId(r.id ?? r.part_id),
      name: String(r.name ?? ""),
      order_criteria: readBoolean(r.order_criteria),
      sort_position: r.position != null ? Number(r.position) : optionalNumber(r.sort_position) ?? 0,
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      add_on_ids: addOnIds,
      selected_add_ons: addOnIds, // legacy alias kept by the original service
      selected_colors: extractRelationIds(r, ["colors"], ["color_ids"])
    };
  },

  async toCreatePayload(form) {
    const isActive = form?.status === "active";
    return {
      name: form?.name ?? "",
      is_deleted: isActive ? "false" : "true",
      order_criteria: form?.order_criteria ? "true" : "false",
      position: String(form?.sort_position ?? 0)
    };
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.status !== undefined) body.is_deleted = isDeletedString(form.status);
    if (form?.order_criteria !== undefined) body.order_criteria = boolString(form.order_criteria);
    if (form?.sort_position !== undefined) body.position = String(form.sort_position);
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  supportsBulkDelete: true, // page uses callScottBulkDelete('parts', ids)
  relations: [
    {
      key: "colors",
      action: "update_colors",
      param: "color_ids",
      style: "indexed",
      label: "Colors",
      optionsResource: "colors",
      valueFrom: (row) => row?.selected_colors ?? []
    },
    {
      key: "add_ons",
      action: "update_add_ons",
      param: "add_on_ids",
      style: "indexed",
      label: "Add-ons",
      optionsResource: "add_ons",
      valueFrom: (row) => row?.add_on_ids ?? []
    }
  ],
  messages: {
    createFailed: "Failed to create part: invalid response",
    updateFailed: "Failed to update part: invalid response"
  }
};

// ---------------------------------------------------------------------------
// §7 Add-Ons — resource `add_ons`
// Renames: name -> add_on, price -> add_on_price, sort_order -> position,
// image_url -> image; read accepts `has_color` OR `has_colour`.
// ---------------------------------------------------------------------------

const SELECT_TYPE_OPTIONS = Object.freeze([
  { value: "single", label: "Single" },
  { value: "multiple", label: "Multiple" },
  { value: "checked", label: "Checked" }
]);

export const addOnsConfig = {
  key: "add_ons",
  resource: "add_ons",
  label: "Add-Ons",
  labelSingular: "add-on",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "add_on_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  detail: { extract: extractDetailData },

  /**
   * ScottOne sorts by `sort_order` then name (`AddOnsPage.tsx:37-42`); `useScottList` only
   * models a single sort key, so the position ordering is what is restored. SAFE HERE:
   * add-ons is a small master, and the drain an active sort forces is one pass.
   */
  defaultSort: { key: "sort_order", direction: "asc" },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    // ScottOne prints `${price}` on add-ons and `₹` everywhere else — that dollar sign is a
    // ScottOne bug, not a currency. Rendered as INR here like every other price in the app.
    { key: "price", header: "Price", type: "currency", sortable: true },
    { key: "group_name", header: "Group", type: "text", sortable: true },
    // Both are collected as form fields AND shown by ScottOne (`AddOnsPage.tsx:159-160,
    // 193-194`); the port collected them but never displayed them back.
    { key: "add_on_of", header: "Add On OF", type: "number", decimals: 0, sortable: true },
    { key: "add_on_sn", header: "Add On SN", type: "number", decimals: 0, sortable: true },
    { key: "select_type", header: "Select Type", type: "text", sortable: true },
    { key: "has_color", header: "Has Color", type: "boolean" },
    { key: "sort_order", header: "Position", type: "number", decimals: 0, sortable: true },
    { key: "layer_sort", header: "Layer Sort", type: "number", decimals: 0, sortable: true },
    { key: "image_url", header: "Image", type: "image" },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true, maxLength: 255, wire: "add_on" },
    { key: "price", label: "Price", type: "number", min: 0, defaultValue: 0, wire: "add_on_price" },
    { key: "add_on_of", label: "Add-on of", type: "number", min: 0, defaultValue: 0 },
    { key: "add_on_sn", label: "Add-on SN", type: "number", min: 0, defaultValue: 0 },
    { key: "has_color", label: "Has color", type: "switch", defaultValue: false },
    {
      key: "select_type",
      label: "Select type",
      type: "select",
      required: true,
      options: SELECT_TYPE_OPTIONS,
      defaultValue: "single"
    },
    { key: "group_name", label: "Group name", type: "text", defaultValue: "" },
    {
      key: "sort_order",
      label: "Position",
      type: "number",
      min: 0,
      defaultValue: 0,
      wire: "position"
    },
    { key: "layer_sort", label: "Layer sort", type: "number", min: 0, defaultValue: 0 },
    { key: "image_url", label: "Image", type: "image", fileKey: "imageFile", wire: "image" },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id ?? r.add_on_id),
      name: String(r.add_on ?? r.name ?? ""),
      price: Number(r.add_on_price ?? r.price ?? 0),
      add_on_of: Number(r.add_on_of ?? 0),
      add_on_sn: Number(r.add_on_sn ?? 0),
      has_color: readBoolean(r.has_color) || readBoolean(r.has_colour),
      select_type: r.select_type || "single",
      group_name: String(r.group_name ?? ""),
      sort_order: Number(r.position ?? r.sort_order ?? 0),
      layer_sort: Number(r.layer_sort ?? 0),
      status: readStatus(r),
      image_url: typeof r.image === "string" ? r.image : optionalString(r.image_url),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      // CURRENT LINKED LISTS (audit fix). `update_colors` / `update_base_products` send the
      // FULL final list, not a delta, so a picker that opens EMPTY is destructive: a user
      // adding one colour silently dropped every colour already attached. Reading the lists
      // here is what lets `relations[].valueFrom` prefill the pickers. Both keys are read
      // exactly the way §6 parts reads its own (`add_ons` / `colors` objects first, the flat
      // `*_ids` arrays as the fallback) — the same list payload shape, same endpoint family.
      color_ids: extractRelationIds(r, ["colors"], ["color_ids"]),
      base_product_ids: extractRelationIds(r, ["base_products"], ["base_product_ids"])
    };
  },

  async toCreatePayload(form) {
    const isActive = form?.status === "active";
    const body = {
      add_on: form?.name ?? "",
      add_on_price: String(form?.price ?? 0),
      add_on_of: String(form?.add_on_of ?? 0),
      add_on_sn: String(form?.add_on_sn ?? 0),
      has_color: form?.has_color ? "true" : "false",
      select_type: form?.select_type || "single",
      group_name: form?.group_name ?? "",
      position: String(form?.sort_order ?? 0),
      layer_sort: String(form?.layer_sort ?? 0),
      is_deleted: isActive ? "false" : "true"
    };
    // Add-ons only ever upload a freshly picked file — no URL re-upload upstream.
    await attachScottImageField(body, "image", { file: form?.imageFile });
    return body;
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.name !== undefined) body.add_on = form.name;
    if (form?.price !== undefined) body.add_on_price = String(form.price);
    if (form?.add_on_of !== undefined) body.add_on_of = String(form.add_on_of);
    if (form?.add_on_sn !== undefined) body.add_on_sn = String(form.add_on_sn);
    if (form?.has_color !== undefined) body.has_color = boolString(form.has_color);
    if (form?.select_type !== undefined) body.select_type = form.select_type;
    if (form?.group_name !== undefined) body.group_name = form.group_name;
    if (form?.sort_order !== undefined) body.position = String(form.sort_order);
    if (form?.layer_sort !== undefined) body.layer_sort = String(form.layer_sort);
    if (form?.status !== undefined) body.is_deleted = isDeletedString(form.status);
    await attachScottImageField(body, "image", { file: form?.imageFile });
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [
    {
      key: "colors",
      action: "update_colors",
      param: "color_ids",
      style: "indexed",
      label: "Colors",
      optionsResource: "colors",
      // Prefill — see the `color_ids` note in `normalize`. Without it the picker opened
      // empty and the save REPLACED the stored set with whatever was ticked.
      valueFrom: (row) => row?.color_ids ?? []
    },
    {
      key: "base_products",
      action: "update_base_products",
      param: "base_product_ids",
      style: "indexed",
      label: "Base products",
      optionsResource: "base_products",
      valueFrom: (row) => row?.base_product_ids ?? []
    }
  ],
  messages: {
    createFailed: "Failed to create add-on: invalid response",
    updateFailed: "Failed to update add-on: invalid response"
  }
};

// ---------------------------------------------------------------------------
// §8 Fabrics — resource `fabrics`
// DELETE is a PATCH `{is_deleted:'true'}` upstream. Deliberate — do not change it.
// ---------------------------------------------------------------------------

const FABRIC_TYPE_OPTIONS = Object.freeze([
  { value: "Cotton", label: "Cotton" },
  { value: "Poly Cotton", label: "Poly Cotton" },
  { value: "Polyester", label: "Polyester" }
]);

const UOM_OPTIONS = Object.freeze([
  { value: "kg", label: "kg" },
  { value: "meter", label: "meter" }
]);

function normalizeFabricType(raw) {
  const s = String(raw ?? "").toLowerCase().replace(/_/g, " ").trim();
  if (s === "cotton") return "Cotton";
  if (s === "polyester") return "Polyester";
  if (s === "poly cotton" || s === "polycotton") return "Poly Cotton";
  return String(raw ?? "");
}

// Lazily built so the fabrics enrichment can reuse the colors normalizer without a
// module cycle (this file owns both configs).
let colorsServiceForEnrichment = null;
function getColorsService() {
  if (!colorsServiceForEnrichment) {
    colorsServiceForEnrichment = createMastersService(colorsConfig);
  }
  return colorsServiceForEnrichment;
}

/**
 * Fabrics that carry `color_ids` but no resolved `colors` trigger ONE full colors
 * fetch. Any failure degrades to `colors: []` — enrichment never throws.
 */
async function enrichFabricsWithColors(rows) {
  if (!rows || rows.length === 0) return rows ?? [];

  const needsEnrichment = rows.some(
    (fabric) => fabric.colors === undefined && fabric.color_ids && fabric.color_ids.length > 0
  );
  if (!needsEnrichment) return rows.map((f) => ({ ...f, colors: f.colors ?? [] }));

  try {
    const allColors = await getColorsService().listAll();
    const colorMap = new Map(allColors.map((color) => [color.id, color]));

    return rows.map((fabric) => {
      if (fabric.colors !== undefined) return fabric;
      if (fabric.color_ids && fabric.color_ids.length > 0) {
        const colors = fabric.color_ids
          .map((id) => colorMap.get(id))
          .filter(Boolean)
          .map((color) => ({ id: color.id, name: color.name, hex_code: color.hex_code }));
        return { ...fabric, colors };
      }
      return { ...fabric, colors: [] };
    });
  } catch {
    return rows.map((f) => ({ ...f, colors: f.colors ?? [] }));
  }
}

export const fabricsConfig = {
  key: "fabrics",
  resource: "fabrics",
  label: "Fabrics",
  labelSingular: "fabric",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "fabric_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "fabric_type", header: "Type", type: "text", sortable: true },
    { key: "gsm", header: "GSM", type: "number", decimals: 0, sortable: true },
    { key: "uom", header: "UOM", type: "text", sortable: true },
    { key: "price", header: "Price", type: "currency", sortable: true },
    { key: "colors", header: "Colors", type: "colors" },
    { key: "image_url", header: "Image", type: "image" },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "fabric_type",
      label: "Fabric type",
      type: "select",
      required: true,
      options: FABRIC_TYPE_OPTIONS
    },
    // Upstream seeded new fabrics at 100 GSM; the port lost the default and the field
    // opened blank on a `required` input.
    { key: "gsm", label: "GSM", type: "number", required: true, min: 1, defaultValue: 100 },
    { key: "uom", label: "UOM", type: "select", required: true, options: UOM_OPTIONS },
    { key: "price", label: "Price", type: "number", min: 0, defaultValue: 0 },
    {
      key: "color_ids",
      label: "Colors",
      type: "multiselect",
      defaultValue: [],
      wire: "color_ids[i]",
      optionsResource: "colors"
    },
    { key: "image_url", label: "Image", type: "image", fileKey: "imageFile", wire: "image" },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    let colorIds = [];
    let colors;

    if (Array.isArray(r.colors) && r.colors.length > 0) {
      // `id` on the nested object is often the join-table row id — prefer `color_id`.
      colors = r.colors.map((color) => ({
        id: normalizeId(color?.color_id ?? color?.id),
        name: String(color?.name ?? ""),
        hex_code: String(color?.hex_code ?? color?.color_code ?? "#000000")
      }));
      colorIds = colors.map((color) => color.id);
    } else if (Array.isArray(r.color_ids) && r.color_ids.length > 0) {
      colorIds = r.color_ids.map((id) => normalizeId(id));
    }

    // Only keep an actual http URL — the API sometimes returns a bare filename.
    const rawImage =
      typeof r.image === "string" ? r.image : typeof r.image_url === "string" ? r.image_url : "";

    return {
      id: normalizeId(r.id ?? r.fabric_id),
      name: String(r.name ?? ""),
      fabric_type: normalizeFabricType(r.fabric_type),
      gsm: Number(r.gsm ?? 0),
      uom: String(r.uom ?? ""),
      price: Number(r.price ?? 0),
      color_ids: colorIds,
      colors,
      image_url: rawImage.startsWith("http") ? rawImage : undefined,
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },
  enrich: enrichFabricsWithColors,

  async toCreatePayload(form) {
    const isActive = form?.status === "active";
    const body = {
      name: form?.name ?? "",
      fabric_type: form?.fabric_type ?? "",
      gsm: String(form?.gsm ?? 0),
      uom: form?.uom ?? "",
      price: String(form?.price ?? 0),
      is_deleted: isActive ? "false" : "true"
    };
    if (form?.color_ids && form.color_ids.length > 0) {
      Object.assign(body, indexedIds("color_ids", form.color_ids));
    }
    await attachScottImageField(body, "image", { file: form?.imageFile });
    return body;
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.fabric_type !== undefined) body.fabric_type = form.fabric_type;
    if (form?.gsm !== undefined) body.gsm = String(form.gsm);
    if (form?.uom !== undefined) body.uom = form.uom;
    if (form?.price !== undefined) body.price = String(form.price);
    if (form?.status !== undefined) body.is_deleted = isDeletedString(form.status);
    // Re-sent in full whenever the form supplies them (indexed keys, not a delta).
    if (form?.color_ids !== undefined) Object.assign(body, indexedIds("color_ids", form.color_ids));
    await attachScottImageField(body, "image", { file: form?.imageFile });
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  /** PATCH {id} { is_deleted: 'true' } — deliberately NOT a DELETE. */
  deleteMode: "patch",
  deletePatchBody: { is_deleted: "true" },
  supportsBulkDelete: false,
  relations: [],
  messages: {
    createFailed: "Failed to create fabric: invalid response",
    updateFailed: "Failed to update fabric: invalid response"
  }
};

// ---------------------------------------------------------------------------
// §9 Base Products — resource `base_products`
// Wire names differ from the legacy UI ones: base_of (base_price),
// tims_cost (trims_cost), over_header_percentage (overhead_percentage).
// ---------------------------------------------------------------------------

export const baseProductsConfig = {
  key: "base_products",
  resource: "base_products",
  label: "Base Products",
  labelSingular: "base product",
  group: MASTER_GROUPS.CATALOGUE,
  idField: "id",
  altIdField: "base_product_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    // Parent Category + App Asset are the two columns ScottOne's table leads with after the
    // name (`BaseProductsTable.tsx:156-171`); the port had dropped both even though
    // `normalize` already produces the embedded objects AND the flat FKs. Keyed on the FK
    // with the embedded object as the fast path — same shape as the rmp_skus relations.
    {
      key: "base_product_type_id",
      header: "Parent Category",
      type: "relation",
      sortable: true,
      optionsResource: "base_product_types",
      format: (raw, row) => {
        const embedded = row?.base_product_type;
        if (embedded && String(embedded.name ?? "").trim()) return embedded;
        return raw ?? embedded;
      }
    },
    {
      key: "asset_info_id",
      header: "App Asset",
      type: "relation",
      sortable: true,
      optionsResource: "asset_infos",
      format: (raw, row) => {
        const embedded = row?.asset_info;
        if (embedded && String(embedded.name ?? "").trim()) return embedded;
        return raw ?? embedded;
      }
    },
    // Money is INR everywhere in this app (`formatScottCurrency` -> `₹`).
    { key: "base_of", header: "Base Price", type: "currency", sortable: true },
    // A serial number, not a measurement — never `12.00`.
    { key: "base_sn", header: "Base SN", type: "number", decimals: 0, sortable: true },
    { key: "tims_cost", header: "Trims Cost", type: "currency", sortable: true },
    { key: "adult_consumption", header: "Adult Consumption", type: "number", sortable: true },
    { key: "kids_consumption", header: "Kids Consumption", type: "number", sortable: true },
    { key: "over_header_percentage", header: "Overhead %", type: "percent", sortable: true },
    // Third column ScottOne shows and the port lost; `normalize` already emits it.
    { key: "calculator", header: "Calculator", type: "number", sortable: true },
    // A count of sides — integers only.
    { key: "branding_sides", header: "Branding Sides", type: "number", decimals: 0, sortable: true },
    { key: "sample_rate", header: "Sample Rate", type: "currency", sortable: true },
    { key: "image_url", header: "Image", type: "image" },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "base_of", label: "Base price", type: "number", min: 0, defaultValue: 0 },
    { key: "base_sn", label: "Base SN", type: "number", min: 0, defaultValue: 0 },
    { key: "tims_cost", label: "Trims cost", type: "number", min: 0, defaultValue: 0 },
    { key: "adult_consumption", label: "Adult consumption", type: "number", min: 0, defaultValue: 0 },
    { key: "kids_consumption", label: "Kids consumption", type: "number", min: 0, defaultValue: 0 },
    {
      key: "over_header_percentage",
      label: "Overhead %",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 0
    },
    { key: "calculator", label: "Calculator", type: "number", min: 0, defaultValue: 0 },
    { key: "branding_sides", label: "Branding sides", type: "number", min: 0, defaultValue: 0 },
    { key: "sample_rate", label: "Sample rate", type: "number", min: 0, defaultValue: 0 },
    // Both carry the None sentinel (audit fix). `nullable + emptyLabel` alone produced no
    // None row — the dialog drops empty option values — so a parent category or app asset
    // that had been set could never be removed. ScottOne has the same defect; fixed here
    // anyway, since the payload builders below already know how to send the clear.
    {
      key: "base_product_type_id",
      label: "Parent category",
      type: "select",
      optionsResource: "base_product_types",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    {
      key: "asset_info_id",
      label: "App asset",
      type: "select",
      optionsResource: "asset_infos",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    { key: "image_url", label: "Image", type: "image", fileKey: "imageFile", wire: "image" },
    statusField(),
    {
      key: "fabric_ids",
      label: "Fabrics",
      type: "multiselect",
      defaultValue: [],
      relation: "update_fabrics",
      optionsResource: "fabrics"
    },
    {
      key: "part_ids",
      label: "Parts",
      type: "multiselect",
      defaultValue: [],
      relation: "update_parts",
      optionsResource: "parts"
    },
    {
      key: "size_type_ids",
      label: "Size types",
      type: "multiselect",
      defaultValue: [],
      relation: "update_size_types",
      optionsResource: "size_types"
    }
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id ?? r.base_product_id),
      name: String(r.name ?? ""),
      base_of: Number(r.base_of ?? 0),
      base_sn: Number(r.base_sn ?? 0),
      tims_cost: Number(r.tims_cost ?? r.trims_cost ?? 0),
      adult_consumption: Number(r.adult_consumption ?? 0),
      kids_consumption: Number(r.kids_consumption ?? 0),
      over_header_percentage: Number(r.over_header_percentage ?? r.overhead_percentage ?? 0),
      calculator: Number(r.calculator ?? 0),
      branding_sides: Number(r.branding_sides ?? 0), // a single number, not an array
      sample_rate: Number(r.sample_rate ?? 0),
      base_product_type_id: optionalString(r.base_product_type_id),
      asset_info_id: optionalString(r.asset_info_id),
      image_url: typeof r.image === "string" ? r.image : optionalString(r.image_url),
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      base_product_type: extractRelationObject(r, "base_product_type", "BaseProductType"),
      asset_info: extractRelationObject(r, "asset_info", "AssetInfo"),
      fabric_ids: extractRelationIds(r, ["fabrics"], ["fabric_ids"]),
      part_ids: extractRelationIds(r, ["parts"], ["part_ids"]),
      size_type_ids: extractRelationIds(r, ["size_types"], ["size_type_ids"])
    };
  },

  async toCreatePayload(form) {
    const isActive = form?.status === "active";
    const body = {
      name: form?.name ?? "",
      base_of: String(form?.base_of ?? 0),
      base_sn: String(form?.base_sn ?? 0),
      tims_cost: String(form?.tims_cost ?? 0),
      adult_consumption: String(form?.adult_consumption ?? 0),
      kids_consumption: String(form?.kids_consumption ?? 0),
      over_header_percentage: String(form?.over_header_percentage ?? 0),
      calculator: String(form?.calculator ?? 0),
      branding_sides: String(form?.branding_sides ?? 0),
      sample_rate: String(form?.sample_rate ?? 0),
      is_deleted: isActive ? "false" : "true"
    };
    // The None sentinel strips to '' — falsy, so "None" simply omits the key on POST.
    const createTypeId = withoutSentinel(form?.base_product_type_id);
    const createAssetId = withoutSentinel(form?.asset_info_id);
    if (createTypeId) body.base_product_type_id = createTypeId;
    if (createAssetId) body.asset_info_id = createAssetId;
    // Any truthy image_url is retried here — upstream has no http(s) guard.
    await attachScottImageField(body, "image", {
      file: form?.imageFile,
      url: form?.image_url,
      filename: "base_product_image.png",
      requireHttp: false
    });
    return body;
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.name !== undefined) body.name = form.name;
    if (form?.base_of !== undefined) body.base_of = String(form.base_of);
    if (form?.base_sn !== undefined) body.base_sn = String(form.base_sn);
    if (form?.tims_cost !== undefined) body.tims_cost = String(form.tims_cost);
    if (form?.adult_consumption !== undefined) {
      body.adult_consumption = String(form.adult_consumption);
    }
    if (form?.kids_consumption !== undefined) {
      body.kids_consumption = String(form.kids_consumption);
    }
    if (form?.over_header_percentage !== undefined) {
      body.over_header_percentage = String(form.over_header_percentage);
    }
    if (form?.calculator !== undefined) body.calculator = String(form.calculator);
    if (form?.branding_sides !== undefined) body.branding_sides = String(form.branding_sides);
    if (form?.sample_rate !== undefined) body.sample_rate = String(form.sample_rate);
    if (form?.status !== undefined) body.is_deleted = isDeletedString(form.status);
    // PATCH: the key being present is the signal, `''` is the clear.
    if (form?.base_product_type_id !== undefined) {
      body.base_product_type_id = withoutSentinel(form.base_product_type_id) || "";
    }
    if (form?.asset_info_id !== undefined) {
      body.asset_info_id = withoutSentinel(form.asset_info_id) || "";
    }
    await attachScottImageField(body, "image", {
      file: form?.imageFile,
      url: form?.image_url,
      filename: "base_product_image.png",
      requireHttp: false
    });
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [
    {
      key: "size_types",
      action: "update_size_types",
      param: "size_type_ids",
      style: "indexed",
      label: "Size types",
      optionsResource: "size_types",
      valueFrom: (row) => row?.size_type_ids ?? []
    },
    {
      key: "categories",
      action: "update_categories",
      param: "category_ids",
      style: "indexed",
      label: "Categories",
      // Exported by the original service; the dialog currently drives the other three.
      optionsResource: null
    },
    {
      key: "fabrics",
      action: "update_fabrics",
      param: "fabric_ids",
      style: "indexed",
      label: "Fabrics",
      optionsResource: "fabrics",
      valueFrom: (row) => row?.fabric_ids ?? []
    },
    {
      key: "parts",
      action: "update_parts",
      param: "part_ids",
      style: "indexed",
      label: "Parts",
      optionsResource: "parts",
      valueFrom: (row) => row?.part_ids ?? []
    }
  ],
  messages: {
    createFailed: "Failed to create base product: invalid response",
    updateFailed: "Failed to update base product: invalid response"
  }
};

/** Scott uses `base_of`; legacy rows may carry `base_price`. Safe for list display. */
export function getBaseProductUnitPriceForDisplay(row) {
  const value = Number(row?.base_of ?? row?.base_price ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// §10 App Assets (Asset Infos) — resource `asset_infos`
// ---------------------------------------------------------------------------

/** Radix "no selection" sentinel used by the dialog; never reaches the wire. */
const NO_ADD_ON = "none";

async function appAssetToForm(data) {
  const isActive = data.status === "active";
  const body = {
    name: data.name ?? "",
    dx: String(data.dx ?? 0),
    dy: String(data.dy ?? 0),
    mirror_dx: String(data.mirror_dx ?? 0),
    asset_height_resp_to_box: String(data.asset_height_resp_to_box ?? 0),
    add_on_id: data.add_on_id === NO_ADD_ON ? "" : data.add_on_id ?? "",
    status: isActive ? "active" : "inactive",
    is_deleted: isActive ? "false" : "true"
  };
  await attachScottImageField(body, "asset", {
    file: data.assetFile,
    url: data.asset,
    filename: "asset.png"
  });
  return body;
}

export const assetInfosConfig = {
  key: "asset_infos",
  resource: "asset_infos",
  label: "App Assets",
  labelSingular: "app asset",
  group: MASTER_GROUPS.ASSETS,
  idField: "id",
  altIdField: "asset_info_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,
  getByIdMode: "find",

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "asset", header: "Asset", type: "image" },
    { key: "dx", header: "dX", type: "number", sortable: true },
    { key: "dy", header: "dY", type: "number", sortable: true },
    { key: "mirror_dx", header: "Mirror dX", type: "number", sortable: true },
    { key: "asset_height_resp_to_box", header: "Height / Box", type: "number", sortable: true },
    {
      key: "add_on_id",
      header: "Add-on",
      type: "relation",
      optionsResource: "add_ons"
    },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "dx", label: "dX", type: "number", min: 0, defaultValue: 0 },
    { key: "dy", label: "dY", type: "number", min: 0, defaultValue: 0 },
    { key: "mirror_dx", label: "Mirror dX", type: "number", min: 0, defaultValue: 0 },
    {
      key: "asset_height_resp_to_box",
      label: "Asset height (resp. to box)",
      type: "number",
      min: 0,
      defaultValue: 0
    },
    {
      key: "add_on_id",
      label: "Add-on",
      type: "select",
      optionsResource: "add_ons",
      nullable: true,
      emptyLabel: "None",
      /** Radix sentinel the payload builder strips back to `''`. */
      noneValue: NO_ADD_ON
    },
    { key: "asset", label: "Asset", type: "image", fileKey: "assetFile", wire: "asset" },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    // The API sometimes answers in camelCase even though it accepts snake_case.
    return {
      id: normalizeId(r.id),
      name: String(r.name ?? ""),
      dx: toNumber(r.dx ?? r.dX),
      dy: toNumber(r.dy ?? r.dY),
      mirror_dx: toNumber(r.mirror_dx ?? r.mirrorDX),
      asset_height_resp_to_box: toNumber(r.asset_height_resp_to_box ?? r.assetHeightRespToBox),
      asset: pickUrl(r.asset),
      add_on_id: r.add_on_id != null ? String(r.add_on_id) : undefined,
      add_on: extractRelationObject(r, "add_on", "AddOn"),
      status: readStatus(r),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    return appAssetToForm(form ?? {});
  },
  async toUpdatePayload(form, prev) {
    return appAssetToForm({ ...(prev ?? {}), ...(form ?? {}) });
  },

  readMergeWrite: true,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [{ key: "add_on_id", kind: "belongsTo", resource: "add_ons", label: "Add-on" }],
  messages: {
    notFound: "App asset not found",
    createFailed: "Unexpected create app asset response",
    updateFailed: "Unexpected update app asset response"
  }
};

// ---------------------------------------------------------------------------
// §11 Base Product Asset Infos — resource `base_product_asset_infos` (link table)
// ---------------------------------------------------------------------------

export const baseProductAssetInfosConfig = {
  key: "base_product_asset_infos",
  resource: "base_product_asset_infos",
  label: "Base Product Asset Links",
  labelSingular: "base product asset info",
  group: MASTER_GROUPS.ASSETS,
  idField: "id",
  altIdField: "base_product_asset_info_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    {
      key: "base_product_id",
      header: "Base Product",
      type: "relation",
      optionsResource: "base_products"
    },
    {
      key: "add_on_id",
      header: "Add-on",
      type: "relation",
      optionsResource: "add_ons"
    },
    {
      key: "part_id",
      header: "Part",
      type: "relation",
      optionsResource: "parts"
    },
    {
      key: "asset_info_id",
      header: "App Asset",
      type: "relation",
      optionsResource: "asset_infos"
    },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    {
      key: "base_product_id",
      label: "Base product",
      type: "select",
      required: true,
      optionsResource: "base_products"
    },
    {
      key: "add_on_id",
      label: "Add-on",
      type: "select",
      required: true,
      optionsResource: "add_ons"
    },
    {
      key: "part_id",
      label: "Part",
      type: "select",
      required: true,
      optionsResource: "parts"
    },
    {
      key: "asset_info_id",
      label: "App asset",
      type: "select",
      required: true,
      optionsResource: "asset_infos"
    },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    const baseProduct = extractRelationObject(r, "base_product", "BaseProduct");
    const addOn = extractRelationObject(r, "add_on", "AddOn");
    const part = extractRelationObject(r, "part", "Part");
    const assetInfo = extractRelationObject(r, "asset_info", "AssetInfo");

    // Flat snake_case first, then camelCase, then the embedded relation's id.
    const flat = (primary, embedded) =>
      primary != null && String(primary) !== "" ? String(primary) : embedded?.id ?? "";

    const isDeleted = readBoolean(r.is_deleted);

    return {
      id: normalizeId(r.id ?? r.base_product_asset_info_id),
      base_product_id: flat(r.base_product_id ?? r.baseProductId, baseProduct),
      add_on_id: flat(r.add_on_id ?? r.addOnId, addOn),
      part_id: flat(r.part_id ?? r.partId, part),
      asset_info_id: flat(r.asset_info_id ?? r.assetInfoId, assetInfo),
      is_deleted: isDeleted,
      status: isDeleted ? "inactive" : "active",
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      created_by: r.created_by ? String(r.created_by) : undefined,
      updated_by: r.updated_by ? String(r.updated_by) : undefined,
      base_product: baseProduct,
      add_on: addOn,
      part: part,
      asset_info: assetInfo
    };
  },

  async toCreatePayload(form) {
    return {
      base_product_id: form?.base_product_id ?? "",
      add_on_id: form?.add_on_id ?? "",
      part_id: form?.part_id ?? "",
      asset_info_id: form?.asset_info_id ?? "",
      is_deleted:
        form?.is_deleted !== undefined ? boolString(form.is_deleted) : isDeletedString(form?.status)
    };
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.base_product_id !== undefined) body.base_product_id = form.base_product_id;
    if (form?.add_on_id !== undefined) body.add_on_id = form.add_on_id;
    if (form?.part_id !== undefined) body.part_id = form.part_id;
    if (form?.asset_info_id !== undefined) body.asset_info_id = form.asset_info_id;
    if (form?.is_deleted !== undefined) body.is_deleted = boolString(form.is_deleted);
    else if (form?.status !== undefined) body.is_deleted = isDeletedString(form.status);
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [
    { key: "base_product_id", kind: "belongsTo", resource: "base_products", label: "Base product" },
    { key: "add_on_id", kind: "belongsTo", resource: "add_ons", label: "Add-on" },
    { key: "part_id", kind: "belongsTo", resource: "parts", label: "Part" },
    { key: "asset_info_id", kind: "belongsTo", resource: "asset_infos", label: "App asset" }
  ],
  messages: {
    createFailed: "Failed to create base product asset info: invalid response",
    updateFailed: "Failed to update base product asset info: invalid response"
  }
};

// ---------------------------------------------------------------------------
// §12 Profit Margins — resource `profit_margins` (v1 namespace)
// The only master whose list also sends `status=active`; soft-deleted rows read
// back as status `'deleted'`, not `'inactive'`.
// ---------------------------------------------------------------------------

function profitMarginToForm(data) {
  const status = data.status ?? "active";
  return {
    name: data.name ?? "",
    // `String(undefined ?? '')` -> '' — upstream sends empty strings, not zeros.
    min_range: String(data.min_range ?? ""),
    max_range: String(data.max_range ?? ""),
    margin_percentage: String(data.margin_percentage ?? ""),
    branding_print: String(data.branding_print ?? ""),
    branding_embroidery: String(data.branding_embroidery ?? ""),
    status,
    is_deleted: status === "deleted" ? "true" : "false"
  };
}

export const profitMarginsConfig = {
  key: "profit_margins",
  resource: "profit_margins",
  label: "Profit Margins",
  labelSingular: "profit margin",
  group: MASTER_GROUPS.PRICING,
  idField: "id",
  altIdField: "profit_margin_id",

  listParams: { is_deleted: false, status: "active" },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  /** The only list that also pins `status=active`. */
  buildListQuery({ page, items, search }) {
    const query = { items, page, is_deleted: false, status: "active" };
    if (search) query.search = search;
    return query;
  },
  getByIdMode: "find", // no show endpoint is used upstream

  columns: [
    { key: "name", header: "Name", type: "text", sortable: true },
    { key: "min_range", header: "Min Range", type: "number", sortable: true },
    { key: "max_range", header: "Max Range", type: "number", sortable: true },
    { key: "margin_percentage", header: "Margin %", type: "percent", sortable: true },
    { key: "branding_print", header: "Branding Print", type: "number", sortable: true },
    { key: "branding_embroidery", header: "Branding Embroidery", type: "number", sortable: true },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "min_range", label: "Min range", type: "number", min: 0, defaultValue: 0 },
    { key: "max_range", label: "Max range", type: "number", min: 0, defaultValue: 0 },
    {
      key: "margin_percentage",
      label: "Margin %",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 0
    },
    { key: "branding_print", label: "Branding print", type: "number", min: 0, defaultValue: 0 },
    {
      key: "branding_embroidery",
      label: "Branding embroidery",
      type: "number",
      min: 0,
      defaultValue: 0
    },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: PM_STATUS_OPTIONS,
      defaultValue: "active",
      wire: "is_deleted"
    }
  ],
  /** Dialog-level refine from the original schema. */
  validate(form) {
    if (Number(form?.max_range ?? 0) < Number(form?.min_range ?? 0)) {
      return "Max range must be greater than or equal to min range";
    }
    return null;
  },

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id ?? r.profit_margin_id),
      name: String(r.name ?? ""),
      min_range: toNumber(r.min_range),
      max_range: toNumber(r.max_range),
      margin_percentage: toNumber(r.margin_percentage),
      branding_print: toNumber(r.branding_print),
      branding_embroidery: toNumber(r.branding_embroidery),
      status: readStatus(r, "deleted"),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    return profitMarginToForm(form ?? {});
  },
  async toUpdatePayload(form, prev) {
    return profitMarginToForm({
      name: form?.name ?? prev?.name,
      min_range: form?.min_range ?? prev?.min_range,
      max_range: form?.max_range ?? prev?.max_range,
      margin_percentage: form?.margin_percentage ?? prev?.margin_percentage,
      branding_print: form?.branding_print ?? prev?.branding_print,
      branding_embroidery: form?.branding_embroidery ?? prev?.branding_embroidery,
      status: form?.status ?? prev?.status
    });
  },

  readMergeWrite: true,
  softDelete: true,
  supportsBulkDelete: true, // DELETE profit_margins/bulk_delete (dashboard ns)
  /** Delete re-reads the row and falls back to a zeroed tombstone when it is gone. */
  deleteReturnsRecord: true,
  deletedTombstone: (id) => ({
    id,
    name: "",
    min_range: 0,
    max_range: 0,
    margin_percentage: 0,
    branding_print: 0,
    branding_embroidery: 0,
    status: "deleted",
    created_at: "",
    updated_at: ""
  }),
  relations: [],
  messages: {
    notFound: "Profit margin not found",
    createFailed: "Unexpected create profit margin response",
    updateFailed: "Unexpected update profit margin response"
  }
};

// ---------------------------------------------------------------------------
// §13 Promotional Banners (catalogue "promotions") — resource `promotions` (v1 ns)
// UI ⇄ wire: title ⇄ name, category_label ⇄ category, banner_image ⇄ thumbnail.
// There is no status column upstream — only `is_deleted`. `position` is client-only.
// ---------------------------------------------------------------------------

async function promotionToForm(data) {
  const body = {
    name: data.title ?? "",
    link: data.link ?? "",
    category: data.category_label ?? "",
    upload_date: data.upload_date ?? "",
    file_size: data.file_size ?? "",
    is_deleted: data.status !== "active" ? "true" : "false"
  };
  // Upstream only ever re-uploads an existing http(s) banner URL — there is no
  // file picker for promotions, so the field is a URL input, not an image input.
  await attachScottImageField(body, "thumbnail", {
    url: data.banner_image,
    filename: "thumbnail.png"
  });
  return body;
}

export const promotionsConfig = {
  key: "promotions",
  resource: "promotions",
  label: "Promotional Banners",
  labelSingular: "promotion",
  group: MASTER_GROUPS.PROMOTIONS,
  idField: "id",
  altIdField: "promotion_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,
  getByIdMode: "find",

  columns: [
    { key: "title", header: "Title", type: "text", sortable: true },
    { key: "banner_image", header: "Banner", type: "image" },
    { key: "category_label", header: "Category", type: "text", sortable: true },
    { key: "link", header: "Link", type: "link" },
    { key: "upload_date", header: "Upload Date", type: "text", sortable: true },
    { key: "file_size", header: "File Size", type: "text" },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "title", label: "Title", type: "text", required: true, wire: "name" },
    { key: "link", label: "Link", type: "text" },
    { key: "category_label", label: "Category", type: "text", wire: "category" },
    { key: "upload_date", label: "Upload date", type: "text" },
    { key: "file_size", label: "File size", type: "text" },
    {
      key: "banner_image",
      label: "Banner image URL",
      type: "text",
      wire: "thumbnail",
      note: "An http(s) URL is re-downloaded and uploaded as thumbnail.png"
    },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    return {
      id: normalizeId(r.id),
      title: String(r.name ?? r.title ?? ""),
      link: typeof r.link === "string" ? r.link : undefined,
      category_label: typeof r.category === "string" ? r.category : undefined,
      upload_date: typeof r.upload_date === "string" ? r.upload_date : undefined,
      file_size: r.file_size != null ? String(r.file_size) : undefined,
      banner_image: pickUrl(r.thumbnail),
      status: readBoolean(r.is_deleted) ? "inactive" : "active",
      position: 0, // never returned by the API
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at)
    };
  },

  async toCreatePayload(form) {
    return promotionToForm(form ?? {});
  },
  async toUpdatePayload(form, prev) {
    return promotionToForm({ ...(prev ?? {}), ...(form ?? {}) });
  },

  readMergeWrite: true,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [],
  messages: {
    notFound: "Promotion not found",
    createFailed: "Unexpected create promotion response",
    updateFailed: "Unexpected update promotion response"
  }
};

// ---------------------------------------------------------------------------
// §14 Scott Promotional Banners (RMP banners) — resource `promotional_banners`
// Sends a REAL `status` value, not `is_deleted`.
// ---------------------------------------------------------------------------

/** Radix sentinel for "no relation" in the banner dialog. */

export const promotionalBannersConfig = {
  key: "promotional_banners",
  resource: "promotional_banners",
  label: "Scott Promotional Banners",
  labelSingular: "promotional banner",
  group: MASTER_GROUPS.RMP,
  idField: "id",
  altIdField: "promotional_banner_id",

  listParams: { is_deleted: false },
  pageSize: DEFAULT_PAGE_SIZE,
  searchMode: "server",
  buildListQuery: standardListQuery,

  detail: { extract: extractDetailData },

  columns: [
    { key: "title", header: "Title", type: "text", sortable: true },
    { key: "image_url", header: "Image", type: "image" },
    { key: "position", header: "Position", type: "number", sortable: true },
    {
      key: "rmp_category_id",
      header: "RMP Category",
      type: "relation",
      optionsResource: "rmp_categories"
    },
    {
      key: "rmp_class_id",
      header: "RMP Class",
      type: "relation",
      optionsResource: "rmp_classes"
    },
    {
      key: "rmp_brand_id",
      header: "RMP Brand",
      type: "relation",
      optionsResource: "rmp_brands"
    },
    statusColumn(),
    ...timestampColumns()
  ],

  fields: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "position", label: "Position", type: "number", min: 0, defaultValue: 0 },
    {
      key: "rmp_category_id",
      label: "RMP category",
      type: "select",
      optionsResource: "rmp_categories",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    {
      key: "rmp_class_id",
      label: "RMP class",
      type: "select",
      optionsResource: "rmp_classes",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    {
      key: "rmp_brand_id",
      label: "RMP brand",
      type: "select",
      optionsResource: "rmp_brands",
      nullable: true,
      emptyLabel: "None",
      noneValue: RMP_NONE
    },
    { key: "image_url", label: "Image", type: "image", fileKey: "imageFile", wire: "image" },
    statusField()
  ],

  normalize(row) {
    const r = row ?? {};
    const rmpCategory = extractRelationObject(r, "rmp_category");
    const rmpClass = extractRelationObject(r, "rmp_class");
    const rmpBrand = extractRelationObject(r, "rmp_brand");

    return {
      id: normalizeId(r.id ?? r.promotional_banner_id),
      title: String(r.title ?? ""),
      status: readStatus(r),
      position: Number(r.position ?? r.sort_order ?? 0),
      image_url: typeof r.image === "string" ? r.image : optionalString(r.image_url),
      rmp_category_id: rmpCategory?.id ?? optionalString(r.rmp_category_id),
      rmp_class_id: rmpClass?.id ?? optionalString(r.rmp_class_id),
      rmp_brand_id: rmpBrand?.id ?? optionalString(r.rmp_brand_id),
      is_deleted: readBoolean(r.is_deleted),
      created_at: readTimestamp(r.created_at),
      updated_at: readTimestamp(r.updated_at),
      rmp_category: rmpCategory,
      rmp_class: rmpClass,
      rmp_brand: rmpBrand
    };
  },

  async toCreatePayload(form) {
    const body = {
      title: form?.title ?? "",
      // The real status string — this entity does NOT send is_deleted on create.
      status: form?.status ?? "active",
      position: String(form?.position ?? 0)
    };
    // Optional FKs are omitted entirely when empty.
    const category = withoutSentinel(form?.rmp_category_id);
    const klass = withoutSentinel(form?.rmp_class_id);
    const brand = withoutSentinel(form?.rmp_brand_id);
    if (category) body.rmp_category_id = category;
    if (klass) body.rmp_class_id = klass;
    if (brand) body.rmp_brand_id = brand;

    await attachScottImageField(body, "image", {
      file: form?.imageFile,
      url: form?.image_url,
      filename: "banner_image.png",
      requireHttp: false
    });
    return body;
  },
  async toUpdatePayload(form) {
    const body = {};
    if (form?.title !== undefined) body.title = form.title;
    if (form?.status !== undefined) body.status = form.status;
    if (form?.position !== undefined) body.position = String(form.position);
    // `''` clears an FK on update.
    if (form?.rmp_category_id !== undefined) {
      body.rmp_category_id = withoutSentinel(form.rmp_category_id);
    }
    if (form?.rmp_class_id !== undefined) body.rmp_class_id = withoutSentinel(form.rmp_class_id);
    if (form?.rmp_brand_id !== undefined) body.rmp_brand_id = withoutSentinel(form.rmp_brand_id);
    await attachScottImageField(body, "image", {
      file: form?.imageFile,
      url: form?.image_url,
      filename: "banner_image.png",
      requireHttp: false
    });
    return body;
  },

  readMergeWrite: false,
  softDelete: true,
  supportsBulkDelete: false,
  relations: [
    { key: "rmp_category_id", kind: "belongsTo", resource: "rmp_categories", label: "RMP category" },
    { key: "rmp_class_id", kind: "belongsTo", resource: "rmp_classes", label: "RMP class" },
    { key: "rmp_brand_id", kind: "belongsTo", resource: "rmp_brands", label: "RMP brand" }
  ],
  messages: {
    createFailed: "Failed to create promotional banner: invalid response",
    updateFailed: "Failed to update promotional banner: invalid response"
  }
};

// ===========================================================================
// Registry
// ===========================================================================

/** The 14 non-RMP masters, in the order they should appear in the nav. */
export const CORE_MASTER_CONFIGS = Object.freeze([
  authorizedBrandsConfig,
  colorsConfig,
  scSizesConfig,
  sizeTypesConfig,
  baseProductTypesConfig,
  partsConfig,
  addOnsConfig,
  fabricsConfig,
  baseProductsConfig,
  assetInfosConfig,
  baseProductAssetInfosConfig,
  profitMarginsConfig,
  promotionsConfig,
  promotionalBannersConfig
]);

export default CORE_MASTER_CONFIGS;
