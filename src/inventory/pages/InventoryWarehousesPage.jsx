import { useMemo, useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

function buildBins(seed) {
  const bins = [];
  let r = seed;
  for (let i = 0; i < 80; i++) {
    r = (r * 9301 + 49297) % 233280;
    const fillType = r / 233280;
    bins.push(fillType < 0.15 ? "full" : fillType < 0.55 ? "filled" : "empty");
  }
  return bins;
}

export default function InventoryWarehousesPage() {
  const { warehouses, skus, pos } = useInventory();
  const [selected, setSelected] = useState(warehouses[0]?.id || "");
  const wh = warehouses.find((w) => w.id === selected) || warehouses[0];
  const skusHere = skus.filter((s) => s.wh === selected);
  const utilPct = wh?.capacity ? Math.round((wh.used / wh.capacity) * 100) : 0;
  const bins = useMemo(() => buildBins((selected || "x").length * 17), [selected]);

  if (!warehouses.length) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Warehouses</h1>
            <p className="page-subtitle">No warehouses yet. Add one in Supabase or via admin tools.</p>
          </div>
        </div>
        <div className="card inv-empty-hint" style={{ padding: 24 }}>
          Create a row in <span className="mono">inventory_warehouses</span> to get started.
        </div>
      </div>
    );
  }

  if (!wh) {
    return null;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Warehouses</h1>
          <p className="page-subtitle">
            {warehouses.length} facilities · {warehouses.reduce((s, w) => s + w.used, 0).toLocaleString()} of{" "}
            {warehouses.reduce((s, w) => s + w.capacity, 0).toLocaleString()} pallets used.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn primary">
            <InventoryIcon name="plus" size={13} /> Add warehouse
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {warehouses.map((w) => {
            const pct = Math.round((w.used / w.capacity) * 100);
            const isActive = w.id === selected;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelected(w.id)}
                className="card"
                style={{
                  cursor: "pointer",
                  padding: 12,
                  textAlign: "left",
                  border: `1px solid ${isActive ? "var(--text)" : "var(--border)"}`,
                  background: isActive ? "var(--bg-subtle)" : "var(--bg-elevated)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{w.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{w.city}</div>
                  </div>
                  <span className="badge neutral" style={{ fontSize: 10 }}>
                    {w.type}
                  </span>
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-muted)" }}>
                  {w.used.toLocaleString()} / {w.capacity.toLocaleString()} pallets · {pct}%
                </div>
                <div style={{ marginTop: 4, height: 4, background: "var(--bg-subtle)", borderRadius: 2, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: pct > 85 ? "var(--warning)" : "var(--accent)"
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <div className="card">
          <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>{wh.name}</h2>
                <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12.5 }}>
                  <span className="mono">{wh.id}</span> · {wh.city} · {wh.type}
                </p>
              </div>
              <button type="button" className="btn sm">
                <InventoryIcon name="map" size={12} /> Layout
              </button>
            </div>

            <div className="grid-3" style={{ marginTop: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Utilization
                </div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{utilPct}%</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {wh.used.toLocaleString()} of {wh.capacity.toLocaleString()} pallets
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  SKUs stored
                </div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{skusHere.length}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  across {[...new Set(skusHere.map((s) => (s.bin || "").slice(0, 3)))].length} zones
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Inbound (next 14d)
                </div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>
                  {pos.filter((p) => p.warehouse === wh?.id && p.status !== "Received").length}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>POs scheduled</div>
              </div>
            </div>
          </div>

          <div style={{ padding: 18, borderBottom: "1px solid var(--border)" }}>
            <h4
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                margin: "0 0 6px",
                fontWeight: 500
              }}
            >
              Bin map · zone A
            </h4>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>
              Hover bins to see contents. Click an empty bin to assign a SKU.
            </p>
            <div className="bin-grid">
              {bins.map((state, i) => {
                const col = (i % 10) + 1;
                const row = Math.floor(i / 10) + 1;
                const label = `A-${row.toString().padStart(2, "0")}-${col.toString().padStart(2, "0")}`;
                return (
                  <div key={i} className={`bin ${state}`} title={label}>
                    {state === "empty" ? "" : `A${row}${col}`}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11.5, color: "var(--text-muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span className="bin" style={{ width: 12, height: 12 }} /> Empty
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span className="bin filled" style={{ width: 12, height: 12 }} /> Partial
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span className="bin full" style={{ width: 12, height: 12 }} /> Full
              </span>
            </div>
          </div>

          <div style={{ padding: 18 }}>
            <h4
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                margin: "0 0 10px",
                fontWeight: 500
              }}
            >
              Top SKUs in this warehouse
            </h4>
            <table className="t" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Bin</th>
                  <th className="right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {skusHere.slice(0, 6).map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.id}</td>
                    <td>
                      {s.name} · {s.color}
                    </td>
                    <td className="mono">{s.bin || "—"}</td>
                    <td className="num">
                      {(s.stock ?? s.totalStock).toLocaleString()} {s.unit || "pc"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
