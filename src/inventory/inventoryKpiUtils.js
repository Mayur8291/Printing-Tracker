import { deriveAlerts } from "./inventoryDbUtils";

const KPI_DAYS = 14;

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(date = new Date()) {
  const d = startOfLocalDay(date);
  d.setDate(d.getDate() + 1);
  d.setMilliseconds(-1);
  return d;
}

/** Last N calendar days (oldest → newest), each at end-of-day. */
export function buildKpiDayEnds(days = KPI_DAYS) {
  const today = startOfLocalDay();
  const ends = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    ends.push(i === 0 ? new Date() : endOfLocalDay(day));
  }
  return ends;
}

function skuStock(sku) {
  return Number(sku?.stock ?? sku?.totalStock ?? 0);
}

function skuUnitCost(sku) {
  return Number(sku?.cost ?? 0);
}

/** Undo movements after `endMs` to estimate per-SKU stock at that time. */
export function stockBySkuAt(endMs, skus, movements) {
  const map = new Map();
  for (const sku of skus) {
    if (sku?._uuid) map.set(sku._uuid, skuStock(sku));
  }
  for (const mov of movements) {
    const ts = new Date(mov.ts).getTime();
    if (ts <= endMs) continue;
    const id = mov.skuUuid;
    if (!id) continue;
    const prev = map.get(id) ?? 0;
    map.set(id, Math.max(0, prev - Number(mov.qty)));
  }
  return map;
}

function inventoryValueFromStockMap(stockMap, skus) {
  const costById = new Map(skus.map((s) => [s._uuid, skuUnitCost(s)]));
  let total = 0;
  for (const [id, qty] of stockMap.entries()) {
    total += qty * (costById.get(id) ?? 0);
  }
  return total;
}

function skuCountAt(endMs, skus) {
  return skus.filter((sku) => {
    const created = sku.created_at ? new Date(sku.created_at).getTime() : 0;
    return !created || created <= endMs;
  }).length;
}

function alertsCountAt(endMs, skus, settings, movements) {
  const stockMap = stockBySkuAt(endMs, skus, movements);
  const snapshot = skus
    .filter((sku) => stockMap.has(sku._uuid))
    .map((sku) => ({
      ...sku,
      stock: stockMap.get(sku._uuid),
      totalStock: stockMap.get(sku._uuid)
    }));
  return deriveAlerts(snapshot, settings).length;
}

function openPoCountAt(endMs, pos) {
  return pos.filter((po) => {
    if (po.status === "Received") return false;
    const created = po.created_at ? new Date(po.created_at).getTime() : endMs;
    return created <= endMs;
  }).length;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function fmtDeltaPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtDeltaAbs(delta, suffix = "") {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}${suffix}`;
}

function seriesMinFloor(values) {
  const max = Math.max(...values, 0);
  if (max === 0) return values.map(() => 0);
  return values;
}

/**
 * Live KPI cards for inventory overview (14-day sparklines + deltas).
 */
export function buildInventoryOverviewKpis({
  skus = [],
  movements = [],
  settings,
  pos = [],
  inventoryValue,
  openPOCount,
  openPOValue,
  alertCount
}) {
  const dayEnds = buildKpiDayEnds(KPI_DAYS);

  const valueSeries = seriesMinFloor(
    dayEnds.map((end) => inventoryValueFromStockMap(stockBySkuAt(end.getTime(), skus, movements), skus))
  );
  const skuSeries = seriesMinFloor(dayEnds.map((end) => skuCountAt(end.getTime(), skus)));
  const alertSeries = seriesMinFloor(
    dayEnds.map((end) => alertsCountAt(end.getTime(), skus, settings, movements))
  );
  const poSeries = seriesMinFloor(dayEnds.map((end) => openPoCountAt(end.getTime(), pos)));

  const first = 0;
  const last = dayEnds.length - 1;
  const prev = Math.max(0, last - 1);

  const valuePct = fmtDeltaPct(pctChange(valueSeries[last], valueSeries[first]));
  const skuDelta = fmtDeltaAbs(skuSeries[last] - skuSeries[first]);
  const alertsTodayDelta = alertSeries[last] - alertSeries[prev];
  const poWeekDelta = poSeries[last] - (poSeries[Math.max(0, last - 7)] ?? poSeries[first]);

  const totalUnits = skus.reduce((s, item) => s + skuStock(item), 0);
  const fmt = (n) => n.toLocaleString();

  return [
    {
      label: "Inventory Value",
      value: inventoryValue,
      delta: valuePct,
      dir: (valueSeries[last] ?? 0) >= (valueSeries[first] ?? 0) ? "up" : "down",
      sub: "vs last 14d",
      spark: valueSeries,
      sparkColor: undefined
    },
    {
      label: "SKUs On Hand",
      value: fmt(skus.length),
      delta: skuDelta,
      dir: (skuSeries[last] ?? 0) >= (skuSeries[first] ?? 0) ? "up" : "down",
      sub: skus.length ? `· ${fmt(totalUnits)} units on hand` : "· Add SKUs to get started",
      spark: skuSeries,
      sparkColor: undefined
    },
    {
      label: "Reorder Alerts",
      value: String(alertCount),
      delta: alertsTodayDelta !== 0 ? fmtDeltaAbs(alertsTodayDelta, " today") : null,
      dir: alertsTodayDelta <= 0 ? "up" : "down",
      sub: "vs last 14d",
      spark: alertSeries,
      sparkColor: "#ef4444"
    },
    {
      label: "Open Purchase Orders",
      value: fmt(openPOCount),
      delta: poWeekDelta !== 0 ? fmtDeltaAbs(poWeekDelta, " this wk") : null,
      dir: (poSeries[last] ?? 0) >= (poSeries[Math.max(0, last - 7)] ?? 0) ? "up" : "down",
      sub: `· ${openPOValue} on order`,
      spark: poSeries,
      sparkColor: undefined
    }
  ];
}

export function kpiMovementsSinceIso(days = KPI_DAYS) {
  const since = startOfLocalDay();
  since.setDate(since.getDate() - (days - 1));
  return since.toISOString();
}
