import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar
} from "recharts";

const BAR_COLORS = {
  revenue: "#3b82f6",
  cost: "#f59e0b",
  net: "#10b981"
};

function toMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(v) {
  return toMoney(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function productLabel(o) {
  const n = String(o.product_name ?? "").trim();
  return n || "—";
}

function inRange(o, fromISO, toISO) {
  const d = String(o.order_date ?? "").trim();
  if (!d) return false;
  if (fromISO && d < fromISO) return false;
  if (toISO && d > toISO) return false;
  return true;
}

const SORT_OPTIONS = [
  { id: "revenue", label: "Revenue" },
  { id: "net", label: "Net profit" },
  { id: "orders", label: "Order count" },
  { id: "qty", label: "Quantity" }
];

export default function ProductRevenuePanel({ orders }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("revenue");

  const rows = useMemo(() => {
    const map = new Map();
    for (const o of orders ?? []) {
      if (!inRange(o, dateFrom, dateTo)) continue;
      const key = productLabel(o);
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          orders: 0,
          qty: 0,
          revenue: 0,
          printingCost: 0
        });
      }
      const row = map.get(key);
      row.orders += 1;
      row.qty += Number.parseInt(o.qty, 10) || 0;
      row.revenue += toMoney(o.order_cost);
      row.printingCost += toMoney(o.printing_cost);
    }
    const list = [...map.values()].map((r) => ({
      ...r,
      net: r.revenue - r.printingCost,
      avgRevenue: r.orders > 0 ? r.revenue / r.orders : 0
    }));
    return list.sort((a, b) => {
      switch (sortBy) {
        case "net":
          return b.net - a.net || b.revenue - a.revenue;
        case "orders":
          return b.orders - a.orders || b.revenue - a.revenue;
        case "qty":
          return b.qty - a.qty || b.revenue - a.revenue;
        case "revenue":
        default:
          return b.revenue - a.revenue || b.orders - a.orders;
      }
    });
  }, [orders, dateFrom, dateTo, sortBy]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.orders += r.orders;
        acc.qty += r.qty;
        acc.revenue += r.revenue;
        acc.printingCost += r.printingCost;
        acc.net += r.net;
        return acc;
      },
      { orders: 0, qty: 0, revenue: 0, printingCost: 0, net: 0 }
    );
  }, [rows]);

  const topProducts = rows.slice(0, 3).filter((r) => r.revenue > 0);
  const underPerformers = rows
    .filter((r) => r.orders > 0)
    .slice(-3)
    .reverse()
    .filter((r) => r.revenue <= (totals.revenue / Math.max(1, rows.length)) * 0.5);

  const chartData = rows.slice(0, 12).map((r) => ({
    name: r.name.length > 18 ? `${r.name.slice(0, 16)}…` : r.name,
    Revenue: Number(r.revenue.toFixed(2)),
    "Printing cost": Number(r.printingCost.toFixed(2)),
    Net: Number(r.net.toFixed(2))
  }));

  return (
    <div className="product-revenue-report">
      <div className="product-revenue-toolbar">
        <label>
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            setDateFrom("");
            setDateTo("");
          }}
        >
          Clear
        </button>
        <label>
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="product-revenue-summary" role="status">
        <div>
          <span>Products</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span>Orders</span>
          <strong>{totals.orders}</strong>
        </div>
        <div>
          <span>Total qty</span>
          <strong>{totals.qty}</strong>
        </div>
        <div>
          <span>Revenue</span>
          <strong>{formatMoney(totals.revenue)}</strong>
        </div>
        <div>
          <span>Printing cost</span>
          <strong>{formatMoney(totals.printingCost)}</strong>
        </div>
        <div className={totals.net < 0 ? "is-negative" : "is-positive"}>
          <span>Net</span>
          <strong>{formatMoney(totals.net)}</strong>
        </div>
      </div>

      {topProducts.length > 0 ? (
        <div className="product-revenue-callouts">
          <div className="product-revenue-callout product-revenue-callout--top">
            <h4>Top performers</h4>
            <ul>
              {topProducts.map((r, i) => (
                <li key={r.name}>
                  <span className="product-revenue-rank">#{i + 1}</span>
                  <span className="product-revenue-callout-name">{r.name}</span>
                  <span className="product-revenue-callout-value">{formatMoney(r.revenue)}</span>
                </li>
              ))}
            </ul>
          </div>
          {underPerformers.length > 0 ? (
            <div className="product-revenue-callout product-revenue-callout--bottom">
              <h4>Needs attention</h4>
              <ul>
                {underPerformers.map((r) => (
                  <li key={`u-${r.name}`}>
                    <span className="product-revenue-callout-name">{r.name}</span>
                    <span className="product-revenue-callout-value">
                      {formatMoney(r.revenue)} <em>· {r.orders} orders</em>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {chartData.length > 0 ? (
        <div className="product-revenue-chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} dy={12} height={60} />
              <YAxis tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(v) => formatMoney(v)} />
              <Legend />
              <Bar dataKey="Revenue" fill={BAR_COLORS.revenue} />
              <Bar dataKey="Printing cost" fill={BAR_COLORS.cost} />
              <Bar dataKey="Net" fill={BAR_COLORS.net} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="product-revenue-table-wrap">
        <table className="product-revenue-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Orders</th>
              <th>Qty</th>
              <th>Revenue</th>
              <th>Printing cost</th>
              <th>Net</th>
              <th>Avg / order</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  No orders in this date range have an Order cost recorded yet. Set the values in
                  the Create / Edit order form for them to appear here.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.name}>
                  <td>{i + 1}</td>
                  <td className="product-revenue-name">{r.name}</td>
                  <td>{r.orders}</td>
                  <td>{r.qty}</td>
                  <td className="product-revenue-money">{formatMoney(r.revenue)}</td>
                  <td className="product-revenue-money">{formatMoney(r.printingCost)}</td>
                  <td
                    className={`product-revenue-money ${r.net < 0 ? "is-negative" : "is-positive"}`}
                  >
                    {formatMoney(r.net)}
                  </td>
                  <td className="product-revenue-money">{formatMoney(r.avgRevenue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
