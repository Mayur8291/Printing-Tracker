import { useState } from "react";
import InventoryIcon from "../InventoryIcon";
import { useInventory } from "../InventoryDataContext";
import InventoryThresholdSettingsModal from "../modals/InventoryThresholdSettingsModal";

export default function InventoryAlertsPage({ openCreatePO, openSku }) {
  const { alerts, skus, suppliers, settings } = useInventory();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const critical = alerts.filter((a) => a.severity === "critical");
  const warn = alerts.filter((a) => a.severity === "warn");
  const criticalPct = Math.round((Number(settings?.critical_ratio) || 0.5) * 100);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts & reorder</h1>
          <p className="page-subtitle">
            <span style={{ color: "var(--danger)" }}>● {critical.length} critical</span> ·{" "}
            <span style={{ color: "var(--warning)" }}>● {warn.length} low</span>
            {skus.length === 0 && " · Add SKUs first — no demo data is loaded."}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
            <InventoryIcon name="settings" size={13} /> Threshold settings
          </button>
          <button type="button" className="btn primary" onClick={() => openCreatePO()}>
            <InventoryIcon name="bolt" size={13} /> Bulk reorder
          </button>
        </div>
      </div>

      <div className="inv-info-banner">
        <strong>Why do alerts appear?</strong> Each SKU you add can have a <em>reorder point</em>. When on-hand stock
        drops below that number, a low-stock alert shows. Critical alerts use your global rule (currently{" "}
        {criticalPct}% of reorder, or out of stock). SKUs with reorder point 0 are ignored. Old demo entries are gone —
        only your database SKUs count.
      </div>

      {alerts.length === 0 && (
        <div className="card inv-empty-hint" style={{ padding: 24, marginBottom: 16 }}>
          No alerts right now. Add SKUs under Fabrics / Trims / Apparel, set reorder points in{" "}
          <button type="button" className="btn sm" onClick={() => setSettingsOpen(true)}>
            Threshold settings
          </button>
          , or stock will look healthy until it drops.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <h3 className="card-title" style={{ color: "var(--danger)" }}>
              Critical · immediate action
            </h3>
            <p className="card-subtitle">Out of stock or below {criticalPct}% of reorder threshold</p>
          </div>
        </div>
        <div className="alert-list">
          {critical.length === 0 && <div className="inv-empty-hint">No critical alerts.</div>}
          {critical.map((a) => {
            const sku = skus.find((s) => s.id === a.id);
            const sup = suppliers.find((s) => s.id === a.supplier);
            return (
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
                    <span className="mono">{a.id}</span> · {a.message} · on hand <b>{a.stock.toLocaleString()}</b> / reorder at{" "}
                    <b>{a.reorder.toLocaleString()}</b>
                    {sup ? ` · supplier ${sup.name} (${sup.leadDays}d)` : ""}
                  </small>
                </div>
                <div className="a-actions">
                  <button type="button" className="btn sm" onClick={() => openSku(sku)}>
                    View
                  </button>
                  <button type="button" className="btn sm accent" onClick={() => openCreatePO(sku)}>
                    <InventoryIcon name="cart" size={11} /> Reorder
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title" style={{ color: "var(--warning)" }}>
              Low stock · plan reorder
            </h3>
            <p className="card-subtitle">Below reorder threshold but not yet critical</p>
          </div>
        </div>
        <div className="alert-list">
          {warn.length === 0 && <div className="inv-empty-hint">No low-stock warnings.</div>}
          {warn.map((a) => {
            const sku = skus.find((s) => s.id === a.id);
            const sup = suppliers.find((s) => s.id === a.supplier);
            return (
              <div className="alert-row" key={a.id}>
                <div className="a-icon warn">
                  <InventoryIcon name="warn" size={14} stroke={1.8} />
                </div>
                <div className="a-main">
                  <strong>
                    <span className="swatch" style={{ background: a.hex, width: 11, height: 11 }} />
                    {a.name}
                    {a.color ? ` · ${a.color}` : ""}
                  </strong>
                  <small>
                    <span className="mono">{a.id}</span> · on hand <b>{a.stock.toLocaleString()}</b> / reorder at{" "}
                    <b>{a.reorder.toLocaleString()}</b>
                    {sup ? ` · supplier ${sup.name}` : ""}
                  </small>
                </div>
                <div className="a-actions">
                  <button type="button" className="btn sm" onClick={() => openSku(sku)}>
                    View
                  </button>
                  <button type="button" className="btn sm" onClick={() => openCreatePO(sku)}>
                    Plan PO
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {settingsOpen && <InventoryThresholdSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
