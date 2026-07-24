/** Resolve external facility code for a warehouse row (matches DB trigger logic). */
export function resolveFacilityCode(warehouse) {
  if (!warehouse) return "DEFAULT";
  const fc = String(warehouse.facilityCode || "").trim();
  if (fc) return fc;
  const id = String(warehouse.id || "").trim();
  return id || "DEFAULT";
}

/** Per-facility stock for one SKU from the availability map (null when no row). */
export function facilityStockForSku(availabilityBySku, skuCode, facilityCode) {
  const entry = availabilityBySku?.[skuCode];
  if (!entry?.facilities?.length) return null;
  const fac = entry.facilities.find((f) => f.facilityCode === facilityCode);
  if (!fac) return null;
  return {
    onHand: Number(fac.onHand) || 0,
    reserved: Number(fac.reserved) || 0,
    available: Number(fac.available) || 0
  };
}

/** Warehouses where this SKU has on-hand or reserved stock. */
export function warehouseLocationsForSku(availabilityBySku, skuCode, warehouses = []) {
  const entry = availabilityBySku?.[skuCode];
  if (!entry?.facilities?.length) return [];

  const byCode = new Map(warehouses.map((w) => [resolveFacilityCode(w), w]));
  const locations = [];

  for (const fac of entry.facilities) {
    const onHand = Number(fac.onHand) || 0;
    const reserved = Number(fac.reserved) || 0;
    if (onHand <= 0 && reserved <= 0) continue;
    const wh = byCode.get(fac.facilityCode);
    locations.push({
      warehouseId: wh?.id || "",
      name: wh?.name || fac.facilityCode,
      facilityCode: fac.facilityCode,
      onHand,
      reserved,
      available: Number(fac.available) || 0
    });
  }

  return locations.sort((a, b) => b.onHand - a.onHand);
}

/** On-hand qty at a warehouse; falls back to SKU home warehouse stock when facility map missing. */
export function onHandAtWarehouse(sku, warehouse, availabilityBySku) {
  const fc = resolveFacilityCode(warehouse);
  const fac = facilityStockForSku(availabilityBySku, sku.id, fc);
  if (fac) return fac.onHand;
  if (sku.wh === warehouse?.id) return Number(sku.stock ?? sku.totalStock ?? 0);
  return 0;
}

/** Available qty at a warehouse for value / KPI calculations. */
export function availableAtWarehouse(sku, warehouse, availabilityBySku) {
  const fc = resolveFacilityCode(warehouse);
  const fac = facilityStockForSku(availabilityBySku, sku.id, fc);
  if (fac) return fac.available;
  if (sku.wh === warehouse?.id) {
    const entry = availabilityBySku?.[sku.id];
    if (entry) return Number(entry.available) || 0;
    return Number(sku.stock ?? sku.totalStock ?? 0);
  }
  return 0;
}

/** Sum inventory value (available × unit cost) for one warehouse or all. */
export function computeInventoryValue(skus, availabilityBySku, warehouses, warehouseId = "all") {
  const wh =
    warehouseId === "all" ? null : warehouses.find((w) => w.id === warehouseId) || null;

  let total = 0;
  for (const sku of skus) {
    const cost = Number(sku.cost) || 0;
    const qty = wh ? availableAtWarehouse(sku, wh, availabilityBySku) : skuAvailableTotal(sku, availabilityBySku);
    total += qty * cost;
  }
  return total;
}

function skuAvailableTotal(sku, availabilityBySku) {
  const entry = availabilityBySku?.[sku.id];
  if (entry) return Number(entry.available) || 0;
  return Number(sku.stock ?? sku.totalStock ?? 0);
}

/** True when SKU has stock at the given warehouse (facility row or home warehouse). */
export function skuHasStockAtWarehouse(sku, warehouse, availabilityBySku) {
  return onHandAtWarehouse(sku, warehouse, availabilityBySku) > 0 || sku.wh === warehouse?.id;
}

/** Stock movement tied to a warehouse (from, to, or both). */
export function movementMatchesWarehouse(mov, warehouseId) {
  if (!warehouseId || warehouseId === "all") return true;
  return mov.fromWh === warehouseId || mov.toWh === warehouseId;
}

/** Signed qty change at a warehouse for one movement row. */
export function warehouseQtyDeltaForMovement(mov, warehouseId) {
  if (!warehouseId) return Number(mov.qty) || 0;
  const qty = Number(mov.qty) || 0;
  switch (mov.type) {
    case "IN":
      return mov.toWh === warehouseId ? qty : 0;
    case "OUT":
      return mov.fromWh === warehouseId ? -Math.abs(qty) : 0;
    case "TRANSFER": {
      let delta = 0;
      if (mov.fromWh === warehouseId) delta -= Math.abs(qty);
      if (mov.toWh === warehouseId) delta += Math.abs(qty);
      return delta;
    }
    case "ADJUST":
      if (mov.toWh === warehouseId || mov.fromWh === warehouseId) return qty;
      return 0;
    default:
      return 0;
  }
}

/** Human-readable warehouse label for a movement (all-warehouses view). */
export function warehouseLabelForMovement(mov, warehouses = []) {
  const name = (id) => warehouses.find((w) => w.id === id)?.name;
  const from = name(mov.fromWh);
  const to = name(mov.toWh);
  if (mov.type === "TRANSFER" && from && to) return `${from} → ${to}`;
  if (mov.type === "IN" && to) return to;
  if (mov.type === "OUT" && from) return from;
  return to || from || null;
}

/** Undo post-`endMs` movements to estimate per-SKU qty at one warehouse. */
export function stockBySkuAtWarehouse(endMs, skus, movements, warehouse, availabilityBySku, { metric = "available" } = {}) {
  const warehouseId = warehouse?.id;
  const readQty = (sku) =>
    metric === "onHand"
      ? onHandAtWarehouse(sku, warehouse, availabilityBySku)
      : availableAtWarehouse(sku, warehouse, availabilityBySku);

  const map = new Map();
  for (const sku of skus) {
    if (sku?._uuid) map.set(sku._uuid, readQty(sku));
  }

  for (const mov of movements) {
    const ts = new Date(mov.ts).getTime();
    if (ts <= endMs) continue;
    if (!movementMatchesWarehouse(mov, warehouseId)) continue;
    const id = mov.skuUuid;
    if (!id || !map.has(id)) continue;
    const prev = map.get(id) ?? 0;
    map.set(id, Math.max(0, prev - warehouseQtyDeltaForMovement(mov, warehouseId)));
  }
  return map;
}

/** SKUs with stock/available qty scoped to one warehouse (or global available when warehouse null). */
export function skusWithScopedAvailability(skus, warehouse, availabilityBySku) {
  if (!warehouse) {
    if (!availabilityBySku) return skus;
    return skus.map((s) => {
      const entry = availabilityBySku[s.id];
      if (!entry) return s;
      return s.totalStock !== undefined
        ? { ...s, totalStock: entry.available, stock: entry.available }
        : { ...s, stock: entry.available };
    });
  }

  return skus.map((s) => {
    const avail = availableAtWarehouse(s, warehouse, availabilityBySku);
    return s.totalStock !== undefined ? { ...s, totalStock: avail, stock: avail } : { ...s, stock: avail };
  });
}

/** Purchase order belongs to warehouse when `warehouse` field matches (or all when filter is all). */
export function poMatchesWarehouse(po, warehouseId) {
  if (!warehouseId || warehouseId === "all") return true;
  return po.warehouse === warehouseId;
}
