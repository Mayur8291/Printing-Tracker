import { supabase } from "../supabaseClient";
import { isSchemaCacheError, waitForSchemaCacheRetry } from "../supabaseErrorUtils";
import {
  INVENTORY_INITIAL_SKU_BATCH,
  INVENTORY_SKU_FULL_SELECT,
  INVENTORY_SKU_LIST_SELECT,
  INVENTORY_SUPPLIER_LIST_SELECT,
  INVENTORY_WAREHOUSE_LIST_SELECT
} from "./inventoryQueryFields";

async function withSchemaCacheRetry(run) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await run();
    if (!error) return { data, error: null };
    if (!isSchemaCacheError(error.message) || attempt >= 4) return { data, error };
    await waitForSchemaCacheRetry(attempt);
  }
  return { data: null, error: new Error("Schema cache retry exhausted.") };
}

export const INVENTORY_SKU_SELECT = INVENTORY_SKU_FULL_SELECT;

export const INVENTORY_MOVEMENT_SELECT =
  "id, sku_id, movement_type, qty, reason, reference, from_warehouse_id, to_warehouse_id, created_by, created_at, inventory_skus(sku_code, name, color, unit)";

export const DEFAULT_ALERT_SETTINGS = {
  id: 1,
  critical_ratio: 0.5,
  low_stock_enabled: true,
  out_of_stock_critical: true
};

export function rowToSku(row) {
  if (!row) return null;
  const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
  const retail =
    extra.retail ?? (row.retail_price != null ? Number(row.retail_price) : 0);
  const base = {
    _uuid: row.id,
    id: row.sku_code,
    name: row.name,
    color: row.color || "",
    hex: row.hex_color || "#cccccc",
    reorder: Number(row.reorder_point) || 0,
    doc: Number(row.doc) || 0,
    drr: Number(row.drr) || 0,
    cost: Number(row.unit_cost) || 0,
    retail,
    supplier: row.supplier_id || "",
    wh: row.warehouse_id || "",
    bin: row.bin_location || "",
    lastIn: row.last_received_at || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    unit: row.unit || "pc",
    kind: row.kind,
    created_at: row.created_at || null
  };

  if (row.kind === "apparel") {
    return {
      ...base,
      ...extra,
      totalStock: Number(row.stock_qty) || 0,
      sizes: extra.sizes || {}
    };
  }

  return {
    ...base,
    ...extra,
    stock: Number(row.stock_qty) || 0
  };
}

export function skuToInsertPayload(kind, record, userId) {
  const isApparel = kind === "apparel";
  const stockQty = isApparel
    ? Number(record.totalStock) || 0
    : Number(record.stock) || 0;

  const extra = { ...record };
  [
    "id",
    "_uuid",
    "name",
    "color",
    "hex",
    "stock",
    "totalStock",
    "reorder",
    "doc",
    "drr",
    "cost",
    "supplier",
    "wh",
    "bin",
    "lastIn",
    "tags",
    "unit",
    "kind",
    "retail"
  ].forEach((k) => delete extra[k]);

  return {
    sku_code: record.id,
    kind,
    name: record.name,
    color: record.color || "",
    hex_color: record.hex || "#cccccc",
    stock_qty: stockQty,
    reorder_point: Number(record.reorder) || 0,
    doc: Number(record.doc) || 0,
    drr: Number(record.drr) || 0,
    unit: record.unit || (isApparel ? "pc" : record.unit || "pc"),
    unit_cost: Number(record.cost) || 0,
    retail_price: Number(record.retail) || null,
    parent_style_id: null,
    supplier_id: record.supplier || null,
    warehouse_id: record.wh || null,
    bin_location: record.bin || "",
    last_received_at: record.lastIn || null,
    tags: Array.isArray(record.tags) ? record.tags : [],
    extra,
    created_by: userId || null
  };
}

export function movementRowToUi(row) {
  const sku = row.inventory_skus || {};
  const skuName = sku.name
    ? sku.name + (sku.color ? ` / ${sku.color}` : "")
    : row.sku_id;
  return {
    id: `MV-${row.id}`,
    _dbId: row.id,
    skuUuid: row.sku_id,
    ts: row.created_at,
    type: row.movement_type,
    sku: sku.sku_code || row.sku_id,
    skuName,
    qty: Number(row.qty),
    unit: sku.unit || "pc",
    reason: row.reason || "",
    ref: row.reference || "—",
    user: "—",
    fromWh: row.from_warehouse_id || "",
    toWh: row.to_warehouse_id || ""
  };
}

export function deriveAlerts(skus, settings = DEFAULT_ALERT_SETTINGS) {
  const resolved = settings || DEFAULT_ALERT_SETTINGS;
  const criticalRatio = Number(resolved.critical_ratio) || 0.5;
  const lowEnabled = resolved.low_stock_enabled !== false;
  const oosCritical = resolved.out_of_stock_critical !== false;
  const alerts = [];

  for (const sku of skus) {
    const reorder = Number(sku.reorder) || 0;
    if (reorder <= 0) continue;

    const stock = Number(sku.stock ?? sku.totalStock ?? 0);
    const base = {
      id: sku.id,
      _uuid: sku._uuid,
      name: sku.name,
      color: sku.color || "",
      hex: sku.hex,
      stock,
      reorder,
      supplier: sku.supplier,
      kind: sku.kind
    };

    if (stock === 0 && oosCritical) {
      alerts.push({ ...base, severity: "critical", message: "Out of stock" });
    } else if (stock > 0 && stock < reorder * criticalRatio) {
      alerts.push({
        ...base,
        severity: "critical",
        message: `Below ${Math.round(criticalRatio * 100)}% of reorder point`
      });
    } else if (lowEnabled && stock < reorder) {
      alerts.push({ ...base, severity: "warn", message: "Below reorder point" });
    }
  }

  return alerts;
}

export function statusOfWithSettings(row, settings = DEFAULT_ALERT_SETTINGS) {
  const resolved = settings || DEFAULT_ALERT_SETTINGS;
  const stock = Number(row.stock ?? row.totalStock ?? 0);
  const reorder = Number(row.reorder) || 0;
  if (reorder <= 0) return { label: "No threshold", kind: "neutral" };
  const criticalRatio = Number(resolved.critical_ratio) || 0.5;
  if (stock === 0) return { label: "Out of stock", kind: "danger" };
  if (stock < reorder * criticalRatio) return { label: "Critical", kind: "danger" };
  if (stock < reorder) return { label: "Low", kind: "warning" };
  return { label: "In stock", kind: "success" };
}

function mapSupplierRow(s) {
  return {
    id: s.id,
    name: s.name,
    country: s.country,
    city: s.city,
    leadDays: s.lead_days,
    rating: s.rating != null ? Number(s.rating) : null,
    contact: s.contact,
    paymentTerms: s.payment_terms,
    gstin: s.gstin || "",
    address: s.address || "",
    supplierType: s.supplier_type || "other",
    openPOs: 0,
    ytdSpend: 0
  };
}

function mapWarehouseRow(w) {
  return {
    id: w.id,
    name: w.name,
    city: w.city,
    capacity: Number(w.capacity) || 0,
    used: 0,
    type: w.warehouse_type,
    facilityCode: w.facility_code || "",
    layout: w.layout || null
  };
}

const SUPABASE_PAGE_SIZE = 1000;

async function fetchInventorySkuBatch(offset, pageSize = SUPABASE_PAGE_SIZE) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_skus")
      .select(INVENTORY_SKU_LIST_SELECT)
      .order("sku_code")
      .range(offset, offset + pageSize - 1)
  );
  if (error) throw error;
  return data || [];
}

async function fetchAllInventorySkuRows() {
  const rows = [];
  let offset = 0;

  while (true) {
    const chunk = await fetchInventorySkuBatch(offset);
    rows.push(...chunk);
    if (chunk.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

export async function fetchInventorySkuRowsAll() {
  return fetchAllInventorySkuRows();
}

export async function fetchInventorySkuRowsInitial() {
  return fetchInventorySkuBatch(0, INVENTORY_INITIAL_SKU_BATCH);
}

export async function fetchInventorySkuRowsFromOffset(offset) {
  return fetchAllInventorySkuRowsFromOffset(offset);
}

async function fetchAllInventorySkuRowsFromOffset(startOffset) {
  const rows = [];
  let offset = startOffset;

  while (true) {
    const chunk = await fetchInventorySkuBatch(offset);
    rows.push(...chunk);
    if (chunk.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

export async function fetchInventoryMovements(limit = 100) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_stock_movements")
      .select(INVENTORY_MOVEMENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return (data || []).map(movementRowToUi);
}

/** Movements since a date — used for overview KPI sparklines. */
export async function fetchInventoryMovementsSince(sinceIso, limit = 8000) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_stock_movements")
      .select(INVENTORY_MOVEMENT_SELECT)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return (data || []).map(movementRowToUi);
}

export async function fetchSkuDetail(skuUuid) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase.from("inventory_skus").select(INVENTORY_SKU_FULL_SELECT).eq("id", skuUuid).maybeSingle()
  );
  if (error) throw error;
  return data ? rowToSku(data) : null;
}

export async function fetchSkuMovements(skuUuid, limit = 6) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_stock_movements")
      .select(INVENTORY_MOVEMENT_SELECT)
      .eq("sku_id", skuUuid)
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return (data || []).map(movementRowToUi);
}

function buildInventoryBundleFromParts({ settingsRes, suppliersRes, warehousesRes, skuRows, movements = [] }) {
  const errors = [settingsRes.error, suppliersRes.error, warehousesRes.error].filter(Boolean);
  if (errors.length) throw errors[0];

  const skus = (skuRows || []).map(rowToSku);
  const settings = settingsRes.data || DEFAULT_ALERT_SETTINGS;

  return {
    settings,
    suppliers: (suppliersRes.data || []).map(mapSupplierRow),
    warehouses: (warehousesRes.data || []).map(mapWarehouseRow),
    skus,
    fabrics: skus.filter((s) => s.kind === "fabric"),
    trims: skus.filter((s) => s.kind === "trim"),
    apparel: skus.filter((s) => s.kind === "apparel"),
    movements,
    alerts: deriveAlerts(skus, settings)
  };
}

export async function fetchInventoryRefreshBundle({ fullSkus = false } = {}) {
  const [settingsRes, suppliersRes, warehousesRes, skuRows] = await Promise.all([
    supabase.from("inventory_alert_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("inventory_suppliers").select(INVENTORY_SUPPLIER_LIST_SELECT).order("name"),
    supabase.from("inventory_warehouses").select(INVENTORY_WAREHOUSE_LIST_SELECT).order("name"),
    fullSkus ? fetchAllInventorySkuRows() : fetchInventorySkuRowsInitial()
  ]);

  const bundle = buildInventoryBundleFromParts({
    settingsRes,
    suppliersRes,
    warehousesRes,
    skuRows,
    movements: []
  });

  return {
    ...bundle,
    hasMoreSkus: !fullSkus && skuRows.length >= INVENTORY_INITIAL_SKU_BATCH
  };
}

export async function fetchInventoryCoreBundle() {
  return fetchInventoryRefreshBundle({ fullSkus: false });
}

export async function fetchInventoryBundle() {
  const [core, movements] = await Promise.all([
    fetchInventoryCoreBundle(),
    fetchInventoryMovements().catch(() => [])
  ]);

  return {
    ...core,
    movements,
    alerts: deriveAlerts(core.skus, core.settings)
  };
}

export async function saveAlertSettings(patch, userId) {
  const { data, error } = await supabase
    .from("inventory_alert_settings")
    .upsert({
      id: 1,
      ...patch,
      updated_by: userId || null,
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSkuReorder(skuUuid, reorderPoint) {
  return updateSkuFields(skuUuid, { reorder: reorderPoint });
}

export async function updateSkuFields(skuUuid, patch) {
  const payload = {};
  if (patch.reorder !== undefined) payload.reorder_point = Number(patch.reorder) || 0;
  if (patch.doc !== undefined) payload.doc = Number(patch.doc) || 0;
  if (patch.drr !== undefined) payload.drr = Number(patch.drr) || 0;
  if (patch.cost !== undefined) payload.unit_cost = Number(patch.cost) || 0;
  if (patch.retail !== undefined) payload.retail_price = Number(patch.retail) || null;
  if (patch.bin !== undefined) payload.bin_location = String(patch.bin ?? "").trim() || null;

  const { data, error } = await supabase
    .from("inventory_skus")
    .update(payload)
    .eq("id", skuUuid)
    .select(INVENTORY_SKU_SELECT)
    .single();
  if (error) throw error;
  return rowToSku(data);
}

export async function insertSku(kind, record, userId) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_skus")
      .insert(skuToInsertPayload(kind, record, userId))
      .select(INVENTORY_SKU_SELECT)
      .single()
  );
  if (error) throw error;
  return rowToSku(data);
}

export async function insertSkuBatch(kind, records, userId, { chunkSize = 150 } = {}) {
  let inserted = 0;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const payloads = chunk.map((record) => skuToInsertPayload(kind, record, userId));
    const { error } = await withSchemaCacheRetry(() =>
      supabase.from("inventory_skus").insert(payloads, { ignoreDuplicates: true })
    );
    if (error) throw error;
    inserted += chunk.length;
  }
  return { inserted, total: records.length };
}

export async function deleteSku(skuUuid) {
  const { error } = await supabase.from("inventory_skus").delete().eq("id", skuUuid);
  if (error) throw error;
}

export async function insertStockMovement({ skuUuid, type, qty, reason, reference, fromWh, toWh, userId }) {
  const { data, error } = await supabase
    .from("inventory_stock_movements")
    .insert({
      sku_id: skuUuid,
      movement_type: type,
      qty: Number(qty),
      reason: reason || "",
      reference: reference || "",
      from_warehouse_id: fromWh || null,
      to_warehouse_id: toWh || null,
      created_by: userId || null
    })
    .select(INVENTORY_MOVEMENT_SELECT)
    .single();
  if (error) throw error;
  return movementRowToUi(data);
}

export async function applyStockAdjustment({ skuUuid, type, qty, reason, reference, fromWh, toWh, userId }) {
  const signedQty = type === "OUT" ? -Math.abs(qty) : Math.abs(qty);
  const { data: skuRow, error: skuErr } = await supabase
    .from("inventory_skus")
    .select("stock_qty")
    .eq("id", skuUuid)
    .single();
  if (skuErr) throw skuErr;

  const nextStock = Math.max(0, Number(skuRow.stock_qty) + signedQty);
  const { error: updErr } = await supabase
    .from("inventory_skus")
    .update({ stock_qty: nextStock })
    .eq("id", skuUuid);
  if (updErr) throw updErr;

  return insertStockMovement({
    skuUuid,
    type,
    qty: signedQty,
    reason,
    reference,
    fromWh,
    toWh,
    userId
  });
}

/**
 * Set absolute on-hand qty for one SKU at one warehouse facility.
 * Recomputes inventory_skus.stock_qty server-side (RPC adjust_sku_facility_stock).
 */
export async function applyFacilityStockAdjustment({
  skuUuid,
  warehouseId,
  targetOnHand,
  reason,
  reference,
  userId
}) {
  const { data, error } = await supabase.rpc("adjust_sku_facility_stock", {
    p_sku_id: skuUuid,
    p_warehouse_id: warehouseId,
    p_target_on_hand: Math.max(0, Number(targetOnHand)),
    p_reason: reason || "",
    p_reference: reference || "",
    p_user_id: userId || null
  });
  if (error) throw error;
  return data;
}

/** Batch facility stock targets for bulk Excel upload (single DB transaction per batch). */
export async function bulkAdjustFacilityStock({ warehouseId, adjustments, userId }) {
  if (!warehouseId || !adjustments?.length) {
    return { applied: 0, failed: 0, results: [] };
  }
  const { data, error } = await supabase.rpc("bulk_adjust_sku_facility_stock", {
    p_warehouse_id: warehouseId,
    p_adjustments: adjustments,
    p_user_id: userId || null
  });
  if (error) throw error;
  return data ?? { applied: 0, failed: 0, results: [] };
}

/** Batch SKU pricing / reorder / DOC updates for bulk Excel upload. */
export async function bulkUpdateSkuMetrics(updates, userId) {
  if (!updates?.length) {
    return { applied: 0, failed: 0, results: [] };
  }
  const { data, error } = await supabase.rpc("bulk_update_sku_metrics", {
    p_updates: updates,
    p_user_id: userId || null
  });
  if (error) throw error;
  return data ?? { applied: 0, failed: 0, results: [] };
}

export async function insertSupplier(record) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_suppliers")
      .insert({
        id: record.id,
        name: record.name,
        country: record.country || "",
        city: record.city || "",
        lead_days: Number(record.leadDays) || 0,
        rating: record.rating != null ? Number(record.rating) : null,
        contact: record.contact || "",
        payment_terms: record.paymentTerms || "",
        gstin: record.gstin || "",
        address: record.address || "",
        supplier_type: record.supplierType || "other"
      })
      .select("*")
      .single()
  );
  if (error) throw error;
  return mapSupplierRow(data);
}

/**
 * Update warehouse fields by id. A facility_code change is propagated to
 * facility stock / open reservations / open Scott orders / channel defaults
 * by the DB trigger inventory_warehouses_propagate_facility_code.
 */
export async function updateWarehouse(id, record) {
  const patch = {
    name: record.name,
    city: record.city || "",
    capacity: Number(record.capacity) || 0,
    warehouse_type: record.type || "",
    facility_code: record.facilityCode?.trim() || null
  };
  if (record.layout !== undefined) patch.layout = record.layout;

  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_warehouses")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single()
  );
  if (error) throw error;
  return mapWarehouseRow(data);
}

/** Update only the bin-map layout (Layout dialog). */
export async function updateWarehouseLayout(id, layout) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_warehouses")
      .update({ layout })
      .eq("id", id)
      .select("*")
      .single()
  );
  if (error) throw error;
  return mapWarehouseRow(data);
}

export async function insertWarehouse(record) {
  const { data, error } = await withSchemaCacheRetry(() =>
    supabase
      .from("inventory_warehouses")
      .insert({
        id: record.id,
        name: record.name,
        city: record.city || "",
        capacity: Number(record.capacity) || 0,
        warehouse_type: record.type || "",
        facility_code: record.facilityCode?.trim() || null
      })
      .select("*")
      .single()
  );
  if (error) throw error;
  return mapWarehouseRow(data);
}
