import { useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

export default function InventoryMovementsPage({ openNewSku }) {
  const { movements } = useInventory();
  const [type, setType] = useState("all");
  const filtered = type === "all" ? movements : movements.filter((m) => m.type === type);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock movements</h1>
          <p className="page-subtitle">Immutable audit log · last 28 events shown.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn">
            <InventoryIcon name="download" size={13} /> Export CSV
          </button>
          <button type="button" className="btn primary" onClick={() => openNewSku?.("fabric")}>
            <InventoryIcon name="plus" size={13} /> New SKU
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div className="table-tabs">
            {["all", "IN", "OUT", "TRANSFER", "ADJUST"].map((t) => (
              <button key={t} type="button" className={`table-tab${type === t ? " active" : ""}`} onClick={() => setType(t)}>
                {t === "all" ? "All" : t}
                <span className="tab-count">
                  {t === "all" ? movements.length : movements.filter((m) => m.type === t).length}
                </span>
              </button>
            ))}
          </div>
          <div className="search-input">
            <InventoryIcon name="search" size={12} stroke={1.8} />
            <input placeholder="Search SKU, user, ref…" />
          </div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Type</th>
                <th>SKU</th>
                <th className="right">Qty</th>
                <th>Reason</th>
                <th>Reference</th>
                <th>From → To</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const typeColor = m.type === "IN" ? "success" : m.type === "OUT" ? "danger" : m.type === "TRANSFER" ? "info" : "warning";
                const dt = new Date(m.ts);
                return (
                  <tr key={m.id} style={{ cursor: "default" }}>
                    <td>
                      <div style={{ fontSize: 12.5 }}>
                        {dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                        {dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${typeColor}`}>
                        <span className="dot" />
                        {m.type}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 12.5 }}>{m.skuName}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                        {m.sku}
                      </div>
                    </td>
                    <td className="num">
                      <span style={{ color: m.qty > 0 ? "var(--success)" : "var(--danger)", fontWeight: 500 }}>
                        {m.qty > 0 ? "+" : ""}
                        {m.qty.toLocaleString()} {m.unit}
                      </span>
                    </td>
                    <td>{m.reason}</td>
                    <td className="mono">{m.ref}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {m.type === "TRANSFER" ? `${m.fromWh} → ${m.toWh}` : m.fromWh}
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          className="avatar"
                          style={{
                            width: 20,
                            height: 20,
                            fontSize: 9,
                            background: "linear-gradient(135deg, #5b4ce5, #8b7eff)"
                          }}
                        >
                          {m.user
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </span>
                        {m.user}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
