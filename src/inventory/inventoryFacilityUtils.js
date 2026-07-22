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
