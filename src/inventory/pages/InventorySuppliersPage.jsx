import { useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

export default function InventorySuppliersPage() {
  const { suppliers } = useInventory();
  const [view, setView] = useState("grid");
  const countries = [...new Set(suppliers.map((s) => s.country))].length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">
            {suppliers.length} active suppliers across {countries} countries.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            <button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>
              <InventoryIcon name="grid" size={12} />
            </button>
            <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
              <InventoryIcon name="list" size={12} />
            </button>
          </div>
          <button type="button" className="btn primary">
            <InventoryIcon name="plus" size={13} /> Add supplier
          </button>
        </div>
      </div>

      {view === "grid" ? (
        <div className="entity-grid">
          {suppliers.map((s) => (
            <div className="entity-card" key={s.id}>
              <div className="entity-card-head">
                <div>
                  <h3>{s.name}</h3>
                  <p className="sub">
                    {s.city}, {s.country} · <span className="mono">{s.id}</span>
                  </p>
                </div>
                <span className="badge neutral" style={{ gap: 3 }}>
                  <InventoryIcon name="star" size={10} stroke={2} />
                  {s.rating}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.contact}</div>
              <div className="stats">
                <div className="stat">
                  <strong>{s.openPOs}</strong>
                  <span>Open POs</span>
                </div>
                <div className="stat">
                  <strong>{s.leadDays}d</strong>
                  <span>Lead time</span>
                </div>
                <div className="stat">
                  <strong>${(s.ytdSpend / 1e6).toFixed(2)}M</strong>
                  <span>YTD spend</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <table className="t">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Location</th>
                <th className="right">Lead time</th>
                <th>Payment</th>
                <th className="right">Rating</th>
                <th className="right">Open POs</th>
                <th className="right">YTD spend</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }} className="mono">
                      {s.id}
                    </div>
                  </td>
                  <td>
                    {s.city}, {s.country}
                  </td>
                  <td className="num">{s.leadDays}d</td>
                  <td>{s.paymentTerms}</td>
                  <td className="num">★ {s.rating}</td>
                  <td className="num">{s.openPOs}</td>
                  <td className="num">
                    <b>${(s.ytdSpend / 1000).toFixed(0)}K</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
