// Pure helpers for deriving Total Inventory demand metrics from RMP order lines.
// Kept transport-free so the date/status/SKU rules can be tested independently.

export const INVENTORY_DRR_WINDOW_DAYS = 90;

function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toScottDate(date) {
  const iso = toIsoDate(date);
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

/** Parse Scott DD-MM-YYYY/DD/MM/YYYY values and ISO timestamps as local calendar dates. */
export function parseInventoryDemandDate(value) {
  const text = asString(value);
  if (!text) return null;

  const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const parts = dayFirst
    ? [Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : null;

  if (!parts) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
  }

  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
}

/** Inclusive trailing-90-day window ending on the applied report end date, capped at today. */
export function buildInventoryDrrWindow(reportEndDate, today = new Date()) {
  const currentDay = startOfLocalDay(today);
  const requestedEnd = parseInventoryDemandDate(reportEndDate);
  const endDate = requestedEnd && requestedEnd < currentDay ? requestedEnd : currentDay;
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (INVENTORY_DRR_WINDOW_DAYS - 1));

  return {
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
    start_date: toScottDate(startDate),
    end_date: toScottDate(endDate),
    days: INVENTORY_DRR_WINDOW_DAYS
  };
}

/** True once a newest-to-oldest batch has crossed the requested demand boundary. */
export function inventoryDemandRowsReachWindowStart(rows, window) {
  const start = parseInventoryDemandDate(window?.startDate);
  if (!start) return false;
  let oldest = null;
  for (const row of rows ?? []) {
    const date = parseInventoryDemandDate(row?.order_date ?? row?.date);
    if (date && (!oldest || date < oldest)) oldest = date;
  }
  return Boolean(oldest && oldest <= start);
}

function normalizeSkuKey(value) {
  const text = asString(value);
  return text ? text.toLowerCase().replace(/\s+/g, " ") : null;
}

function nestedSkuKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [value.id, value.rmp_sku_id, value.sku_id, value.sku, value.sku_code, value.rmp_sku_code, value.name]
    .map(normalizeSkuKey)
    .filter(Boolean);
}

/** Strongest-to-weakest identifiers available on an inventory response row. */
export function inventorySkuLookupKeys(row) {
  const direct = [
    row?.rmp_sku_id,
    row?.sku_id,
    row?.id,
    row?.sku_code,
    row?.rmp_sku_code,
    row?.sku,
    row?.rmp_sku_name,
    row?.name,
    row?.product_name
  ]
    .map(normalizeSkuKey)
    .filter(Boolean);
  return [...new Set([...direct, ...nestedSkuKeys(row?.rmp_sku)])];
}

/** A line id is deliberately excluded: it identifies the order line, not its SKU. */
export function orderSkuLookupKeys(row) {
  const direct = [
    row?.rmp_sku_id,
    row?.sku_id,
    row?.rmp_sku_code,
    row?.sku_code,
    row?.sku,
    row?.rmp_sku_name,
    row?.sku_name,
    row?.product_name
  ]
    .map(normalizeSkuKey)
    .filter(Boolean);
  return [...new Set([...direct, ...nestedSkuKeys(row?.rmp_sku)])];
}

/** Only realized demand counts; explicit terminal failure states always win. */
export function isCompletedInventoryDemand(row) {
  const status = `${row?.order_status ?? ""} ${row?.status ?? ""}`.toLowerCase();
  if (/cancel|fail|reject|void/.test(status)) return false;
  if (row?.actual_delivery_date || row?.dispatch_date) return true;
  if (/pending|overdue/.test(status)) return false;
  return /complete|dispatched|delivered|closed|fulfilled|shipped/.test(status);
}

function isInsideWindow(row, window) {
  const date = parseInventoryDemandDate(row?.order_date ?? row?.date);
  const start = parseInventoryDemandDate(window?.startDate);
  const end = parseInventoryDemandDate(window?.endDate);
  return Boolean(date && start && end && date >= start && date <= end);
}

/** Aggregate qualifying order quantities under every usable SKU alias on the line. */
export function buildOrderQuantityBySku(rows, window) {
  const totals = new Map();
  for (const row of rows ?? []) {
    if (!isCompletedInventoryDemand(row) || !isInsideWindow(row, window)) continue;
    const quantity = asPositiveNumber(row?.quantity ?? row?.total_quantity ?? row?.qty);
    if (quantity === undefined) continue;
    for (const key of orderSkuLookupKeys(row)) totals.set(key, (totals.get(key) ?? 0) + quantity);
  }
  return totals;
}

/** Fill missing 90-day sales only; direct inventory endpoint metrics remain authoritative. */
export function enrichInventoryWithQuantityMap(inventoryRows, quantityBySku) {
  return (inventoryRows ?? []).map((row) => {
    if (row?.drr !== undefined && row?.drr !== null && row?.drr !== "") return row;
    if (row?.three_month_sales !== undefined && row?.three_month_sales !== null) return row;
    if (row?.sales_qty_90d !== undefined && row?.sales_qty_90d !== null) return row;

    let quantity = 0;
    for (const key of inventorySkuLookupKeys(row)) {
      if (quantityBySku.has(key)) {
        quantity = quantityBySku.get(key);
        break;
      }
    }
    return { ...row, three_month_sales: quantity, sales_qty_90d: quantity };
  });
}

export function enrichInventoryWithOrderDemand(inventoryRows, orderRows, window) {
  return enrichInventoryWithQuantityMap(inventoryRows, buildOrderQuantityBySku(orderRows, window));
}
