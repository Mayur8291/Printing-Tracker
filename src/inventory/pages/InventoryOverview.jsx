import Sparkline from "../components/Sparkline";
import StackedBar from "../components/StackedBar";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";
import { formatRelative, usdFmt } from "../inventoryUtils";

export default function InventoryOverview({ setActive, openSku, openNewSku, openCreatePO }) {
  const { fabrics, trims, apparel, alerts, movements, pos, suppliers, warehouses, skus } = useInventory();
  const inventoryValue =
    fabrics.reduce((s, f) => s + f.stock * f.cost, 0) +
    trims.reduce((s, t) => s + t.stock * t.cost, 0) +
    apparel.reduce((s, a) => s + a.totalStock * a.cost, 0);

  const openPOValue = pos.filter((p) => p.status !== "Received").reduce((s, p) => s + p.value, 0);
  const openPOCount = pos.filter((p) => p.status !== "Received").length;
  const totalUnits = skus.reduce((s, item) => s + Number(item.stock ?? item.totalStock ?? 0), 0);
  const fmt = (n) => n.toLocaleString();

  const kpis = [
    {
      label: "Inventory Value",
      value: usdFmt(inventoryValue),
      delta: "+4.2%",
      dir: "up",
      spark: [40, 42, 41, 44, 46, 47, 48, 49, 51, 52, 50, 54, 55, 57]
    },
    {
      label: "SKUs On Hand",
      value: fmt(skus.length),
      sub: skus.length ? `· ${fmt(totalUnits)} units on hand` : "· Add SKUs to get started",
      delta: "+18",
      dir: "up",
      spark: [30, 32, 34, 33, 36, 38, 40, 41, 42, 43, 45, 44, 46, 47]
    },
    {
      label: "Reorder Alerts",
      value: alerts.length.toString(),
      delta: "+3 today",
      dir: "down",
      spark: [4, 4, 6, 5, 7, 6, 8, 7, 9, 10, 11, 10, 12, 13],
      color: "var(--danger)"
    },
    {
      label: "Open Purchase Orders",
      value: fmt(openPOCount),
      sub: `· ${usdFmt(openPOValue)} on order`,
      delta: "+2 this wk",
      dir: "up",
      spark: [3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9]
    }
  ];

  const fabricBy = fabrics.reduce((acc, f) => {
    const cat = f.tags?.includes("denim")
      ? "Denim"
      : f.tags?.includes("knit")
        ? "Knit"
        : f.tags?.includes("linen")
          ? "Linen"
          : f.tags?.includes("wool")
            ? "Wool"
            : f.tags?.includes("shirting")
              ? "Shirting"
              : "Other Wovens";
    acc[cat] = (acc[cat] || 0) + f.stock;
    return acc;
  }, {});

  const fabricBars = Object.entries(fabricBy)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      segments: [
        {
          label,
          value,
          color: {
            Denim: "#3a4b8a",
            Knit: "#5b4ce5",
            Linen: "#a14a2a",
            Wool: "#5e2330",
            Shirting: "#1c66d6",
            "Other Wovens": "#6c7252"
          }[label]
        }
      ]
    }));

  const recentMoves = movements.slice(0, 7);
  const topAlerts = alerts.filter((a) => a.severity === "critical").slice(0, 5);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            {warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"} · Live from database{" "}
            <span className="pulse" style={{ marginLeft: 6, verticalAlign: "middle" }} />
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn">
            <InventoryIcon name="download" size={13} /> Export
          </button>
          <button type="button" className="btn primary" onClick={() => openNewSku("fabric")}>
            <InventoryIcon name="plus" size={13} /> New SKU
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <p className="kpi-label">{k.label}</p>
            <p className="kpi-value">{k.value}</p>
            <div className="kpi-meta">
              {k.delta && (
                <span className={`kpi-delta ${k.dir}`}>
                  {k.dir === "up" ? "↑" : "↓"} {k.delta}
                </span>
              )}
              {k.sub ? <span>{k.sub}</span> : <span>vs last 14d</span>}
            </div>
            <div className="kpi-spark">
              <Sparkline data={k.spark} color={k.color || "var(--accent)"} />
            </div>
          </div>
        ))}
      </div>

      <div className="split">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Fabric stock by category</h3>
                <p className="card-subtitle">Total meters in 5 warehouses</p>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setActive("fabrics")}>
                View all <InventoryIcon name="chev_r" size={12} />
              </button>
            </div>
            <StackedBar rows={fabricBars} />
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Recent stock movements</h3>
                <p className="card-subtitle">Live feed across all warehouses</p>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setActive("movements")}>
                View all <InventoryIcon name="chev_r" size={12} />
              </button>
            </div>
            <div style={{ padding: "4px 16px 12px" }}>
              {recentMoves.map((m) => {
                const cls = m.type === "IN" ? "in" : m.type === "ADJUST" ? "adj" : "out";
                const sign = m.qty > 0 ? "+" : "";
                return (
                  <div className="history-row" key={m.id}>
                    <div className={`h-icon ${cls}`}>
                      <InventoryIcon
                        name={m.type === "IN" ? "arrow_d" : m.type === "OUT" ? "arrow_u" : m.type === "TRANSFER" ? "swap" : "edit"}
                        size={12}
                        stroke={2}
                      />
                    </div>
                    <div className="h-text">
                      <span>{m.skuName}</span>
                      <small>
                        {m.reason} · {m.user} · {formatRelative(new Date(m.ts))} · ref {m.ref}
                      </small>
                    </div>
                    <div className={`h-qty ${m.qty > 0 ? "pos" : "neg"}`}>
                      {sign}
                      {m.qty.toLocaleString()} {m.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Critical reorder alerts</h3>
                <p className="card-subtitle">{topAlerts.length} items need attention</p>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setActive("alerts")}>
                All alerts <InventoryIcon name="chev_r" size={12} />
              </button>
            </div>
            <div className="alert-list">
              {topAlerts.map((a) => (
                <div className="alert-row" key={a.id}>
                  <div className="a-icon">
                    <InventoryIcon name="warn" size={14} stroke={1.8} />
                  </div>
                  <div className="a-main">
                    <strong>
                      <span className="swatch" style={{ background: a.hex, width: 11, height: 11 }} />
                      {a.name}
                      {a.color ? ` · ${a.color}` : ""}
                    </strong>
                    <small>
                      {a.id} · {a.message} · on hand <b>{a.stock.toLocaleString()}</b> / reorder at{" "}
                      <b>{a.reorder.toLocaleString()}</b>
                    </small>
                  </div>
                  <div className="a-actions">
                    <button type="button" className="btn sm accent" onClick={() => openCreatePO()}>
                      Reorder
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Incoming shipments</h3>
                <p className="card-subtitle">{openPOCount} POs · arriving next 30 days</p>
              </div>
            </div>
            <div style={{ padding: "4px 16px 14px" }}>
              {pos.filter((p) => p.status === "In Transit")
                .slice(0, 4)
                .map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplier);
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 0",
                        borderBottom: "1px solid var(--border)"
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: "var(--info-soft)",
                          color: "var(--info)",
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0
                        }}
                      >
                        <InventoryIcon name="truck" size={14} stroke={1.7} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                        <div style={{ fontWeight: 500, fontSize: 12.5 }}>{p.id}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          {sup?.name} · {sup?.city} · {p.qty.toLocaleString()} units
                        </div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12 }}>
                        <div style={{ fontWeight: 500 }}>{usdFmt(p.value)}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>ETA {p.eta}</div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
