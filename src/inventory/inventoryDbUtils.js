import { supabase } from "../supabaseClient";

export const INVENTORY_SKU_SELECT =
  "id, sku_code, kind, name, color, hex_color, stock_qty, reorder_point, unit, unit_cost, retail_price, supplier_id, warehouse_id, bin_location, last_received_at, tags, extra, created_at, updated_at";

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
  const base = {
    _uuid: row.id,
    id: row.sku_code,
    name: row.name,
    color: row.color || "",
    hex: row.hex_color || "#cccccc",
    reorder: Number(row.reorder_point) || 0,
    cost: Number(row.unit_cost) || 0,
    supplier: row.supplier_id || "",
    wh: row.warehouse_id || "",
    bin: row.bin_location || "",
    lastIn: row.last_received_at || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    unit: row.unit || "pc",
    kind: row.kind
  };

  if (row.kind === "apparel") {
    return {
      ...base,
      ...extra,
      totalStock: Number(row.stock_qty) || 0,
      retail: extra.retail ?? (row.retail_price != null ? Number(row.retail_price) : 0),
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
    unit: record.unit || (isApparel ? "pc" : record.unit || "pc"),
    unit_cost: Number(record.cost) || 0,
    retail_price: isApparel ? Number(record.retail) || null : null,
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

export async function fetchInventoryBundle() {
  const [settingsRes, suppliersRes, warehousesRes, skusRes, movementsRes] = await Promise.all([
    supabase.from("inventory_alert_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("inventory_suppliers").select("*").order("name"),
    supabase.from("inventory_warehouses").select("*").order("name"),
    supabase.from("inventory_skus").select(INVENTORY_SKU_SELECT).order("sku_code"),
    supabase
      .from("inventory_stock_movements")
      .select(INVENTORY_MOVEMENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  const errors = [
    settingsRes.error,
    suppliersRes.error,
    warehousesRes.error,
    skusRes.error,
    movementsRes.error
  ].filter(Boolean);

  if (errors.length) {
    const movementOnly = errors.find((e) => e && movementsRes.error === e);
    if (movementOnly && !settingsRes.error && !suppliersRes.error && !warehousesRes.error && !skusRes.error) {
      const skus = (skusRes.data || []).map(rowToSku);
      const settings = settingsRes.data || DEFAULT_ALERT_SETTINGS;
      return {
        settings,
        suppliers: (suppliersRes.data || []).map((s) => ({
          id: s.id,
          name: s.name,
          country: s.country,
          city: s.city,
          leadDays: s.lead_days,
          rating: s.rating != null ? Number(s.rating) : null,
          contact: s.contact,
          paymentTerms: s.payment_terms,
          openPOs: 0,
          ytdSpend: 0
        })),
        warehouses: (warehousesRes.data || []).map((w) => ({
          id: w.id,
          name: w.name,
          city: w.city,
          capacity: Number(w.capacity) || 0,
          used: 0,
          type: w.warehouse_type
        })),
        skus,
        fabrics: skus.filter((s) => s.kind === "fabric"),
        trims: skus.filter((s) => s.kind === "trim"),
        apparel: skus.filter((s) => s.kind === "apparel"),
        movements: [],
        alerts: deriveAlerts(skus, settings)
      };
    }
    throw errors[0];
  }

  const skus = (skusRes.data || []).map(rowToSku);
  const settings = settingsRes.data || DEFAULT_ALERT_SETTINGS;

  return {
    settings,
    suppliers: (suppliersRes.data || []).map((s) => ({
      id: s.id,
      name: s.name,
      country: s.country,
      city: s.city,
      leadDays: s.lead_days,
      rating: s.rating != null ? Number(s.rating) : null,
      contact: s.contact,
      paymentTerms: s.payment_terms,
      openPOs: 0,
      ytdSpend: 0
    })),
    warehouses: (warehousesRes.data || []).map((w) => ({
      id: w.id,
      name: w.name,
      city: w.city,
      capacity: Number(w.capacity) || 0,
      used: 0,
      type: w.warehouse_type
    })),
    skus,
    fabrics: skus.filter((s) => s.kind === "fabric"),
    trims: skus.filter((s) => s.kind === "trim"),
    apparel: skus.filter((s) => s.kind === "apparel"),
    movements: (movementsRes.data || []).map(movementRowToUi),
    alerts: deriveAlerts(skus, settings)
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
  const { data, error } = await supabase
    .from("inventory_skus")
    .update({ reorder_point: Number(reorderPoint) || 0 })
    .eq("id", skuUuid)
    .select(INVENTORY_SKU_SELECT)
    .single();
  if (error) throw error;
  return rowToSku(data);
}

export async function insertSku(kind, record, userId) {
  const { data, error } = await supabase
    .from("inventory_skus")
    .insert(skuToInsertPayload(kind, record, userId))
    .select(INVENTORY_SKU_SELECT)
    .single();
  if (error) throw error;
  return rowToSku(data);
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

export async function insertSupplier(record) {
  const { data, error } = await supabase
    .from("inventory_suppliers")
    .insert({
      id: record.id,
      name: record.name,
      country: record.country || "",
      city: record.city || "",
      lead_days: Number(record.leadDays) || 0,
      rating: record.rating != null ? Number(record.rating) : null,
      contact: record.contact || "",
      payment_terms: record.paymentTerms || ""
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function insertWarehouse(record) {
  const { data, error } = await supabase
    .from("inventory_warehouses")
    .insert({
      id: record.id,
      name: record.name,
      city: record.city || "",
      capacity: Number(record.capacity) || 0,
      warehouse_type: record.type || ""
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
