import { useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";

export default function InventoryPurchaseOrdersPage({ openCreatePO }) {
  const { pos, suppliers, warehouses } = useInventory();
  const [filter, setFilter] = useState("all");
  const statuses = ["all", "Draft", "Awaiting Approval", "Approved", "In Production", "In Transit", "Received"];
  const filtered = filter === "all" ? pos : pos.filter((p) => p.status === filter);

  const statusBadge = (s) => {
    const map = {
      Draft: "neutral",
      "Awaiting Approval": "warning",
      Approved: "info",
      "In Production": "info",
      "In Transit": "info",
      Received: "success"
    };
    return (
      <span className={`badge ${map[s]}`}>
        <span className="dot" />
        {s}
      </span>
    );
  };

  const totalValue = filtered.reduce((s, p) => s + p.value, 0);
  const totalQty = filtered.reduce((s, p) => s + p.qty, 0);
  const openValue = pos.filter((p) => p.status !== "Received").reduce((s, p) => s + p.value, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase orders</h1>
          <p className="page-subtitle">
            {pos.filter((p) => p.status !== "Received").length} open · ${(openValue / 1000).toFixed(0)}K on order across{" "}
            {suppliers.length} suppliers.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn">
            <InventoryIcon name="download" size={13} /> Export
          </button>
          <button type="button" className="btn primary" onClick={() => openCreatePO()}>
            <InventoryIcon name="plus" size={13} /> New PO
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div className="table-tabs">
            {statuses.map((s) => (
              <button key={s} type="button" className={`table-tab${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>
                {s === "all" ? "All" : s}
                <span className="tab-count">{s === "all" ? pos.length : pos.filter((p) => p.status === s).length}</span>
              </button>
            ))}
          </div>
          <div className="search-input">
            <InventoryIcon name="search" size={12} stroke={1.8} />
            <input placeholder="Search PO, supplier, SKU…" />
          </div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
            <b style={{ color: "var(--text)" }}>{filtered.length}</b> POs ·{" "}
            <b style={{ color: "var(--text)" }}>{totalQty.toLocaleString()}</b> units ·{" "}
            <b style={{ color: "var(--text)" }}>${totalValue.toLocaleString()}</b>
          </div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>PO #</th>
                <th>Supplier</th>
                <th>Status</th>
                <th className="right">Items</th>
                <th className="right">Qty</th>
                <th className="right">Value</th>
                <th>Warehouse</th>
                <th>Created</th>
                <th>ETA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const sup = suppliers.find((s) => s.id === p.supplier);
                const wh = warehouses.find((w) => w.id === p.warehouse);
                const isLate = new Date(p.eta) < new Date("2026-06-10") && p.status !== "Received";
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{sup?.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                        {sup?.city}, {sup?.country}
                      </div>
                    </td>
                    <td>{statusBadge(p.status)}</td>
                    <td className="num">{p.items}</td>
                    <td className="num">{p.qty.toLocaleString()}</td>
                    <td className="num">
                      <b>${p.value.toLocaleString()}</b>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{wh?.name}</span>
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>{p.created}</td>
                    <td>
                      <span style={{ color: isLate ? "var(--danger)" : "var(--text)" }}>{p.eta}</span>
                      {isLate && (
                        <span className="badge danger" style={{ marginLeft: 6 }}>
                          Late
                        </span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="icon-btn">
                        <InventoryIcon name="more" size={13} />
                      </button>
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
