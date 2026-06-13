/** Default dealers (seeded in DB migration). */
export const DEFAULT_DEALERS = [
  { key: "organic_clothing", label: "ORGANIC CLOTHING" },
  { key: "dazzle_export", label: "DAZZLE EXPORT" },
  { key: "jpm_international", label: "JPM INTERNATIONAL" },
  { key: "as_international", label: "AS INTERNATIONAL" },
  { key: "tshirt_inc", label: "T-SHIRT INC" },
  { key: "skr_world", label: "SKR WORLD" },
  { key: "corporate_house", label: "The Corporate House" },
  { key: "promo_corp", label: "The Promo Corp" },
  { key: "s_prime_cor", label: "S PRIME COR" },
  { key: "swag_shack", label: "SWAG-SHACK" }
];

export const DEALER_CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#64748b",
  "#f97316",
  "#0f172a",
  "#14b8a6",
  "#a855f7",
  "#eab308"
];

export const DEALER_REPORT_SELECT = "id, report_date, month_key, dealer_amounts, total, created_at, updated_at";
export const DEALERS_SELECT = "id, name, dealer_key, sort_order, is_active, sales_target";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function normalizeDealerRows(rows) {
  return normalizeAllDealerRows(rows).filter((r) => r.isActive);
}

export function normalizeAllDealerRows(rows) {
  return (rows ?? [])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
    .map((r) => ({
      id: r.id,
      key: String(r.dealer_key ?? "").trim(),
      label: String(r.name ?? "").trim(),
      isActive: r.is_active !== false,
      salesTarget: Number(r.sales_target) || 0
    }))
    .filter((r) => r.key && r.label);
}

function humanizeDealerKey(key) {
  return String(key ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Active dealers plus removed dealers that still have saved report amounts. */
export function buildReportDealerColumns(allDealers, entries) {
  const active = (allDealers ?? []).filter((d) => d.isActive);
  const byKey = new Map((allDealers ?? []).map((d) => [d.key, d]));
  const activeKeys = new Set(active.map((d) => d.key));
  const historicalKeys = new Set();

  for (const row of entries ?? []) {
    const json = row.dealer_amounts;
    if (!json || typeof json !== "object" || Array.isArray(json)) continue;
    for (const [key, value] of Object.entries(json)) {
      if (Number(value) > 0) historicalKeys.add(key);
    }
  }

  const inactiveWithData = [...historicalKeys]
    .filter((key) => !activeKeys.has(key))
    .map((key) => {
      const known = byKey.get(key);
      return (
        known ?? {
          id: null,
          key,
          label: humanizeDealerKey(key),
          isActive: false
        }
      );
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...active, ...inactiveWithData];
}

export function slugifyDealerKey(name) {
  const base = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `dealer_${Date.now()}`;
}

export function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseISODateLocal(iso) {
  const [y, m, d] = String(iso ?? "").split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODateLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Monday-start week containing anchor date (local). */
export function weekRangeFromDate(anchorISO) {
  const d = parseISODateLocal(anchorISO || todayLocalISODate());
  if (Number.isNaN(d.getTime())) {
    return weekRangeFromDate(todayLocalISODate());
  }
  const dow = d.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startISO: toISODateLocal(start), endISO: toISODateLocal(end) };
}

export function currentWeekRange() {
  return weekRangeFromDate(todayLocalISODate());
}

export function normalizeDateRange(fromISO, toISO) {
  const fallback = todayLocalISODate();
  const a = String(fromISO ?? "").trim() || fallback;
  const b = String(toISO ?? "").trim() || a;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function formatShortDateLabel(isoDate) {
  const raw = String(isoDate ?? "").trim();
  if (!raw) return "—";
  const [y, m, d] = raw.split("-").map(Number);
  if (!y || !m || !d) return raw;
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

export function formatDateRangeLabel(fromISO, toISO) {
  const { from, to } = normalizeDateRange(fromISO, toISO);
  const fromLbl = formatShortDateLabel(from);
  const toLbl = formatShortDateLabel(to);
  if (from === to) return fromLbl;
  return `${fromLbl} – ${toLbl}`;
}

export function currentMonthKey() {
  return todayLocalISODate().slice(0, 7);
}

export function monthKeyFromDate(isoDate) {
  return String(isoDate ?? "").slice(0, 7);
}

export function formatMonthLabel(monthKey) {
  const [y, m] = String(monthKey ?? "").split("-").map(Number);
  if (!y || !m) return "—";
  return `${MONTH_NAMES[m - 1] ?? m}-${y}`;
}

export function formatReportDateHeading(isoDate) {
  const raw = String(isoDate ?? "").trim();
  if (!raw) return "—";
  const [y, m, d] = raw.split("-").map(Number);
  if (!y || !m || !d) return raw;
  const dt = new Date(y, m - 1, d);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const weekday = WEEKDAY_NAMES[dt.getDay()] ?? "";
  return `${dd}.${mm}.${y} – ${weekday}`;
}

export function formatChartDateLabel(isoDate) {
  const raw = String(isoDate ?? "").trim();
  if (!raw) return "";
  const [, m, d] = raw.split("-").map(Number);
  if (!m || !d) return raw;
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

export function parseDealerAmount(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/[,₹\s]/g, "");
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Format amount for editable inputs — Indian grouping (e.g. 1,00,00,000). */
export function formatDealerAmountInput(raw) {
  const n = parseDealerAmount(raw);
  if (!n) return "";
  return n.toLocaleString("en-IN");
}

export function getAmountFromRecord(record, dealerKey) {
  if (!record || !dealerKey) return 0;
  const json = record.dealer_amounts;
  if (json && typeof json === "object" && !Array.isArray(json) && json[dealerKey] != null) {
    return Number(json[dealerKey]) || 0;
  }
  if (record[dealerKey] != null) return Number(record[dealerKey]) || 0;
  return 0;
}

export function sumDealerFormValues(values, dealers) {
  return (dealers ?? []).reduce((acc, { key }) => acc + parseDealerAmount(values?.[key]), 0);
}

export function emptyDealerForm(dealers, reportDate = todayLocalISODate()) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  const values = Object.fromEntries(list.map(({ key }) => [key, ""]));
  return {
    report_date: reportDate,
    month_key: monthKeyFromDate(reportDate),
    values
  };
}

export function dealerRecordToForm(record, dealers) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  if (!record) return emptyDealerForm(list);
  const values = Object.fromEntries(
    list.map(({ key }) => [key, String(getAmountFromRecord(record, key) || "")])
  );
  return {
    report_date: record.report_date ?? todayLocalISODate(),
    month_key: record.month_key ?? monthKeyFromDate(record.report_date),
    values
  };
}

export function buildDealerPayload(form, dealers, sessionUserId, existingAmounts = null) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  const dealer_amounts =
    existingAmounts && typeof existingAmounts === "object" && !Array.isArray(existingAmounts)
      ? { ...existingAmounts }
      : {};
  for (const { key } of list) {
    dealer_amounts[key] = parseDealerAmount(form.values?.[key]);
  }
  const total = Object.values(dealer_amounts).reduce((a, b) => a + (Number(b) || 0), 0);
  return {
    report_date: form.report_date,
    month_key: monthKeyFromDate(form.report_date),
    dealer_amounts,
    total,
    created_by: sessionUserId ?? null
  };
}

export function buildDealerChartRows(records, dealers) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  const sorted = [...(records ?? [])].sort((a, b) =>
    String(a.report_date).localeCompare(String(b.report_date))
  );
  return sorted.map((row) => {
    const point = {
      period: formatChartDateLabel(row.report_date),
      report_date: row.report_date
    };
    for (const { key, label } of list) {
      point[label] = getAmountFromRecord(row, key);
    }
    point.Total = Number(row.total) || 0;
    return point;
  });
}

/** One bar per reporting day — daily total amount. */
export function buildDealerDailyTotalRows(records) {
  return [...(records ?? [])]
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)))
    .map((row) => ({
      report_date: row.report_date,
      label: formatChartDateLabel(row.report_date),
      total: Number(row.total) || 0
    }));
}

/** Horizontal bar chart rows — range total per dealer, highest first. */
export function buildDealerRangeTotalRows(records, dealers) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  return list
    .map(({ key, label }) => {
      let total = 0;
      for (const row of records ?? []) {
        total += getAmountFromRecord(row, key);
      }
      return { dealerName: label, dealerKey: key, total };
    })
    .sort((a, b) => b.total - a.total || a.dealerName.localeCompare(b.dealerName));
}

/** Bar chart: X = dealer names, one bar series per date (legend). */
export function buildDealerBarChartPivot(records, dealers) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  const sortedRecords = [...(records ?? [])].sort((a, b) =>
    String(a.report_date).localeCompare(String(b.report_date))
  );
  const dateSeries = sortedRecords.map((row) => ({
    key: row.report_date,
    label: formatChartDateLabel(row.report_date)
  }));
  const rows = list.map(({ key, label }) => {
    const point = { dealerName: label, dealerKey: key };
    for (const rec of sortedRecords) {
      point[rec.report_date] = getAmountFromRecord(rec, key);
    }
    return point;
  });
  return { rows, dateSeries };
}

export function normalizeMonthRange(fromMonth, toMonth) {
  const a = String(fromMonth ?? "").trim();
  const b = String(toMonth ?? "").trim();
  if (!a && !b) {
    const cur = currentMonthKey();
    return { from: cur, to: cur };
  }
  if (!a) return { from: b, to: b };
  if (!b) return { from: a, to: a };
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function formatMonthRangeLabel(fromMonth, toMonth) {
  const { from, to } = normalizeMonthRange(fromMonth, toMonth);
  if (from === to) return formatMonthLabel(from);
  return `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`;
}

export function computeDealerColumnTotals(entries, dealers) {
  const list = dealers?.length ? dealers : DEFAULT_DEALERS;
  const byKey = Object.fromEntries(list.map(({ key }) => [key, 0]));
  let total = 0;
  for (const row of entries ?? []) {
    total += Number(row.total) || 0;
    for (const { key } of list) {
      byKey[key] += getAmountFromRecord(row, key);
    }
  }
  return { byKey, total };
}

export function targetFormFromDealers(dealers) {
  return Object.fromEntries(
    (dealers ?? [])
      .filter((d) => d.isActive !== false)
      .map(({ key, salesTarget }) => [key, salesTarget > 0 ? String(salesTarget) : ""])
  );
}

export function formatDealerNumber(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-IN");
}
