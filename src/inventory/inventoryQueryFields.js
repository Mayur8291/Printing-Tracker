/** Table/list/overview — omits audit timestamps; keeps extra JSON for grid columns. */
export const INVENTORY_SKU_LIST_SELECT =
  "id, sku_code, kind, name, color, hex_color, stock_qty, reorder_point, doc, drr, unit, unit_cost, retail_price, supplier_id, warehouse_id, bin_location, last_received_at, tags, extra, parent_style_id, created_at, inventory_style_parents(id, parent_sku_code, style_name)";

/** Single-SKU detail (drawer, edits) — includes audit fields. */
export const INVENTORY_SKU_FULL_SELECT = `${INVENTORY_SKU_LIST_SELECT}, created_at, updated_at`;

export const INVENTORY_SUPPLIER_LIST_SELECT =
  "id, name, country, city, lead_days, rating, contact, payment_terms, gstin, address, supplier_type";

export const INVENTORY_WAREHOUSE_LIST_SELECT = "id, name, city, capacity, warehouse_type";

export const INVENTORY_INITIAL_SKU_BATCH = 1000;

export function skuNeedsDetailHydration(sku) {
  if (!sku?._uuid) return false;
  return sku.created_at === undefined && sku.updated_at === undefined;
}
