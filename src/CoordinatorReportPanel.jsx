import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line
} from "recharts";

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#64748b"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODateLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Monday-start week containing `anchor` (local). */
function weekRangeFromDate(anchorISO) {
  const [y, m, day] = anchorISO.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  const dow = d.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startISO: toISODateLocal(start), endISO: toISODateLocal(end) };
}

function monthRangeFromMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { startISO: toISODateLocal(start), endISO: toISODateLocal(end) };
}

/** Inclusive calendar-month span; if start > end, swaps. */
function monthRangeFromMonths(ymStart, ymEnd) {
  const [y1, m1] = ymStart.split("-").map(Number);
  const [y2, m2] = ymEnd.split("-").map(Number);
  let ys = y1;
  let ms = m1;
  let ye = y2;
  let me = m2;
  if (ys * 12 + ms > ye * 12 + me) {
    [ys, ms, ye, me] = [ye, me, ys, ms];
  }
  const ymLo = `${ys}-${pad2(ms)}`;
  const ymHi = `${ye}-${pad2(me)}`;
  const start = new Date(ys, ms - 1, 1);
  const end = new Date(ye, me, 0);
  return { startISO: toISODateLocal(start), endISO: toISODateLocal(end), ymLo, ymHi };
}

function eachMonthBetween(ymLo, ymHi) {
  const [y1, m1] = ymLo.split("-").map(Number);
  const [y2, m2] = ymHi.split("-").map(Number);
  const out = [];
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function orderInRange(order, startISO, endISO) {
  const od = order.order_date;
  if (!od || typeof od !== "string") return false;
  return od >= startISO && od <= endISO;
}

function coordinatorLabel(order) {
  const n = String(order.coordinator_name ?? "").trim();
  return n || "—";
}

/** Names from coordinators table, stable order (e.g. API `order("name")`). */
function catalogCoordinatorNames(coordinators) {
  const catalog = Array.isArray(coordinators) ? coordinators : [];
  const names = [];
  const seen = new Set();
  for (const row of catalog) {
    const n = String(row?.name ?? "").trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return { names, inCatalog: new Set(names) };
}

function buildPieRows(orders, startISO, endISO, coordinators) {
  const { names: catalogNames, inCatalog } = catalogCoordinatorNames(coordinators);
  const map = new Map();
  for (const n of catalogNames) map.set(n, 0);
  for (const o of orders) {
    if (!orderInRange(o, startISO, endISO)) continue;
    const c = coordinatorLabel(o);
    if (!map.has(c)) map.set(c, 0);
    map.set(c, map.get(c) + 1);
  }
  if (catalogNames.length === 0) {
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }
  const out = [];
  for (const n of catalogNames) out.push({ name: n, value: map.get(n) ?? 0 });
  const extras = [...map.keys()]
    .filter((n) => !inCatalog.has(n))
    .sort((a, b) => a.localeCompare(b));
  for (const n of extras) out.push({ name: n, value: map.get(n) ?? 0 });
  return out;
}

/** Hour bucket for single-day line (uses created_at). */
function hourKey(iso) {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.getHours();
}

function lineChartKeys(filteredOrders, coordinators) {
  const { names } = catalogCoordinatorNames(coordinators);
  if (names.length) return names;
  const coords = new Set();
  for (const o of filteredOrders) coords.add(coordinatorLabel(o));
  return [...coords].sort().slice(0, 8);
}

function buildLineRowsDay(orders, dayISO, coordinators) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const filtered = orders.filter((o) => o.order_date === dayISO);
  const keys = lineChartKeys(filtered, coordinators);
  const rows = hours.map((h) => {
    const row = { period: `${pad2(h)}:00` };
    for (const c of keys) row[c] = 0;
    row.__other = 0;
    return row;
  });
  for (const o of filtered) {
    const hk = hourKey(o.created_at);
    if (hk == null) continue;
    const c = coordinatorLabel(o);
    const row = rows[hk];
    if (keys.includes(c)) row[c] += 1;
    else row.__other += 1;
  }
  return { rows, keys, hasOther: filtered.some((o) => !keys.includes(coordinatorLabel(o))) };
}

function eachDayBetween(startISO, endISO) {
  const [ys, ms, ds] = startISO.split("-").map(Number);
  const [ye, me, de] = endISO.split("-").map(Number);
  const out = [];
  const cur = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  while (cur <= end) {
    out.push(toISODateLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function buildLineRowsByOrderDate(orders, startISO, endISO, coordinators) {
  const days = eachDayBetween(startISO, endISO);
  const filtered = orders.filter((o) => orderInRange(o, startISO, endISO));
  const keys = lineChartKeys(filtered, coordinators);
  const rows = days.map((day) => {
    const row = { period: day.slice(5) };
    for (const c of keys) row[c] = 0;
    row.__other = 0;
    return row;
  });
  const dayIndex = Object.fromEntries(days.map((d, i) => [d, i]));
  for (const o of filtered) {
    const idx = dayIndex[o.order_date];
    if (idx == null) continue;
    const c = coordinatorLabel(o);
    const row = rows[idx];
    if (keys.includes(c)) row[c] += 1;
    else row.__other += 1;
  }
  return { rows, keys, hasOther: filtered.some((o) => !keys.includes(coordinatorLabel(o))) };
}

function ymFromOrderDate(od) {
  if (!od || typeof od !== "string" || od.length < 7) return null;
  return od.slice(0, 7);
}

function buildLineRowsByMonth(orders, startISO, endISO, monthKeys, coordinators) {
  const filtered = orders.filter((o) => orderInRange(o, startISO, endISO));
  const keys = lineChartKeys(filtered, coordinators);
  const rows = monthKeys.map((ym) => {
    const row = { period: ym };
    for (const c of keys) row[c] = 0;
    row.__other = 0;
    return row;
  });
  const idxByYm = Object.fromEntries(monthKeys.map((ym, i) => [ym, i]));
  for (const o of filtered) {
    const ym = ymFromOrderDate(o.order_date);
    const idx = ym == null ? null : idxByYm[ym];
    if (idx == null) continue;
    const c = coordinatorLabel(o);
    const row = rows[idx];
    if (keys.includes(c)) row[c] += 1;
    else row.__other += 1;
  }
  return { rows, keys, hasOther: filtered.some((o) => !keys.includes(coordinatorLabel(o))) };
}

export default function CoordinatorReportPanel({ orders, coordinators = [] }) {
  const [period, setPeriod] = useState("month");
  const [anchorDate, setAnchorDate] = useState(() => {
    const d = new Date();
    return toISODateLocal(d);
  });
  const [anchorMonth, setAnchorMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });
  const [monthRangeStart, setMonthRangeStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });
  const [monthRangeEnd, setMonthRangeEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });
  const [chartType, setChartType] = useState("pie");

  const { startISO, endISO, label, lineMonthKeys } = useMemo(() => {
    if (period === "day") {
      return { startISO: anchorDate, endISO: anchorDate, label: anchorDate, lineMonthKeys: null };
    }
    if (period === "week") {
      const { startISO: s, endISO: e } = weekRangeFromDate(anchorDate);
      return { startISO: s, endISO: e, label: `${s} → ${e}`, lineMonthKeys: null };
    }
    if (period === "month") {
      const { startISO: s, endISO: e } = monthRangeFromMonth(anchorMonth);
      return { startISO: s, endISO: e, label: anchorMonth, lineMonthKeys: null };
    }
    const { startISO: s, endISO: e, ymLo, ymHi } = monthRangeFromMonths(monthRangeStart, monthRangeEnd);
    return {
      startISO: s,
      endISO: e,
      label: `${ymLo} → ${ymHi}`,
      lineMonthKeys: eachMonthBetween(ymLo, ymHi)
    };
  }, [period, anchorDate, anchorMonth, monthRangeStart, monthRangeEnd]);

  const pieData = useMemo(
    () => buildPieRows(orders, startISO, endISO, coordinators),
    [orders, startISO, endISO, coordinators]
  );

  const pieSlices = useMemo(() => pieData.filter((d) => d.value > 0), [pieData]);

  const linePack = useMemo(() => {
    if (period === "day") return buildLineRowsDay(orders, anchorDate, coordinators);
    if (lineMonthKeys?.length)
      return buildLineRowsByMonth(orders, startISO, endISO, lineMonthKeys, coordinators);
    return buildLineRowsByOrderDate(orders, startISO, endISO, coordinators);
  }, [orders, period, anchorDate, startISO, endISO, lineMonthKeys, coordinators]);

  const totalInRange = pieData.reduce((a, b) => a + b.value, 0);

  return (
    <div className="coordinator-report">
      <div className="coordinator-report-toolbar">
        <div className="coordinator-report-group">
          <span className="coordinator-report-label">Period</span>
          <div className="coordinator-report-segment" role="group" aria-label="Time period">
            <button
              type="button"
              className={period === "day" ? "is-active" : ""}
              onClick={() => setPeriod("day")}
            >
              Day
            </button>
            <button
              type="button"
              className={period === "week" ? "is-active" : ""}
              onClick={() => setPeriod("week")}
            >
              Week
            </button>
            <button
              type="button"
              className={period === "month" ? "is-active" : ""}
              onClick={() => setPeriod("month")}
            >
              Month
            </button>
            <button
              type="button"
              className={period === "month_range" ? "is-active" : ""}
              onClick={() => setPeriod("month_range")}
            >
              Month range
            </button>
          </div>
        </div>
        {period === "month" ? (
          <label className="coordinator-report-field">
            Month
            <input type="month" value={anchorMonth} onChange={(e) => setAnchorMonth(e.target.value)} />
          </label>
        ) : period === "month_range" ? (
          <div className="coordinator-report-range-fields">
            <label className="coordinator-report-field">
              From
              <input type="month" value={monthRangeStart} onChange={(e) => setMonthRangeStart(e.target.value)} />
            </label>
            <label className="coordinator-report-field">
              To
              <input type="month" value={monthRangeEnd} onChange={(e) => setMonthRangeEnd(e.target.value)} />
            </label>
          </div>
        ) : (
          <label className="coordinator-report-field">
            {period === "week" ? "Week containing" : "Date"}
            <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
          </label>
        )}
        <div className="coordinator-report-group">
          <span className="coordinator-report-label">Chart</span>
          <div className="coordinator-report-segment" role="group" aria-label="Chart type">
            <button type="button" className={chartType === "pie" ? "is-active" : ""} onClick={() => setChartType("pie")}>
              Pie
            </button>
            <button type="button" className={chartType === "line" ? "is-active" : ""} onClick={() => setChartType("line")}>
              Line
            </button>
          </div>
        </div>
      </div>
      <p className="coordinator-report-summary">
        <strong>{totalInRange}</strong> orders with <code>order_date</code> in range <strong>{label}</strong> (by coordinator).
      </p>
      {chartType === "pie" ? (
        <div className="coordinator-report-chart-wrap">
          {pieSlices.length === 0 ? (
            <p className="coordinator-report-empty">
              {totalInRange === 0
                ? "No orders in this range. Table below lists coordinators (including 0 orders)."
                : "No data for pie chart."}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <PieChart>
                <Tooltip formatter={(value, name) => [`${value} orders`, name]} />
                <Legend />
                <Pie data={pieSlices} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120}>
                  {pieSlices.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : (
        <div className="coordinator-report-chart-wrap">
          {linePack.rows.length === 0 ? (
            <p className="coordinator-report-empty">No time buckets in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={linePack.rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                <Tooltip />
                <Legend />
                {linePack.keys.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
                {linePack.hasOther ? (
                  <Line type="monotone" dataKey="__other" name="Other" stroke="#94a3b8" strokeWidth={2} dot={{ r: 2 }} />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
      <div className="coordinator-report-table-wrap">
        <table className="coordinator-report-table">
          <thead>
            <tr>
              <th>Coordinator</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {pieData.length === 0 ? (
              <tr>
                <td colSpan={2}>No coordinators and no orders in this range.</td>
              </tr>
            ) : (
              pieData.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.value}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
