import { useCallback, useEffect, useMemo, useState } from "react";
import InventoryIcon from "./inventory/InventoryIcon";
import RefillPrintingInventoryModal from "./RefillPrintingInventoryModal";
import PrintingDeptThresholdModal from "./PrintingDeptThresholdModal";
import {
  buildMovementHistoryDayGroups,
  fetchPrintingDeptInventoryHistory,
  fetchPrintingDeptInventoryState,
  fetchPrintingDeptThresholds,
  inventoryItemsFromState,
  isPrintingMaterialLowStock,
  issuePrintingDeptMaterial,
  materialLabel,
  materialUnit,
  MATERIAL_SHORT_CODE,
  notifyPrintingLowStockIfNeeded,
  PRINTING_UTILIZATION_MATERIAL_KEYS,
  refillPrintingDeptMaterial
} from "./printingDeptInventoryUtils";
import "./inventory/inventory.css";

function formatMovementTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatQty(value, maxFractionDigits = 2) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

function formatNetChange(net) {
  const abs = formatQty(Math.abs(net));
  return net > 0 ? `+${abs}` : `-${abs}`;
}

export default function PrintingDeptInventoryPanel({
  sessionUserId,
  canEdit = false,
  isAdmin = false,
  teamProfiles = []
}) {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("refill");
  const [modalMaterialKey, setModalMaterialKey] = useState("");
  const [expandedDay, setExpandedDay] = useState(null);
  const [thresholdModalOpen, setThresholdModalOpen] = useState(false);
  const [thresholds, setThresholds] = useState({});

  const profileById = useMemo(() => {
    const map = new Map();
    for (const profile of teamProfiles) {
      if (profile?.id) map.set(profile.id, profile);
    }
    return map;
  }, [teamProfiles]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextState, nextHistory, nextThresholds] = await Promise.all([
        fetchPrintingDeptInventoryState(),
        fetchPrintingDeptInventoryHistory(200),
        fetchPrintingDeptThresholds()
      ]);
      setState(nextState);
      setHistory(nextHistory);
      setThresholds(nextThresholds);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => inventoryItemsFromState(state), [state]);
  const inkItems = items.filter((item) => item.group === "Ink");
  const materialItems = items.filter((item) => item.group === "Materials");

  const historyDayGroups = useMemo(() => buildMovementHistoryDayGroups(history, { days: 90 }), [history]);

  function performerName(userId) {
    const profile = profileById.get(userId);
    const name = profile?.full_name?.trim();
    const email = profile?.email?.trim();
    return name || email || "User";
  }

  function openMovement(mode, materialKey = "") {
    setModalMode(mode);
    setModalMaterialKey(materialKey);
    setModalOpen(true);
  }

  function toggleDay(date) {
    setExpandedDay((current) => (current === date ? null : date));
  }

  function handleDayHeadKeyDown(event, date) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDay(date);
    }
  }

  async function handleMovementSubmit({ materialKey, quantity, note, mode }) {
    if (!canEdit || !sessionUserId) {
      throw new Error("You do not have permission to update printing inventory.");
    }
    if (mode === "issue") {
      const result = await issuePrintingDeptMaterial({
        materialKey,
        quantityUsed: quantity,
        userId: sessionUserId,
        note
      });
      await notifyPrintingLowStockIfNeeded({
        materialKey,
        previousStock: result.previousStock,
        newStock: result.quantityAfter,
        userId: sessionUserId
      });
    } else {
      const result = await refillPrintingDeptMaterial({
        materialKey,
        quantityAdded: quantity,
        userId: sessionUserId,
        note
      });
      await notifyPrintingLowStockIfNeeded({
        materialKey,
        previousStock: result.previousStock,
        newStock: result.quantityAfter,
        userId: sessionUserId
      });
    }
    await load();
  }

  function renderStockActions(item, allowIssue = true) {
    if (!canEdit) return null;
    return (
      <div className="printing-dept-stock-actions">
        {allowIssue ? (
          <button type="button" className="btn sm danger" onClick={() => openMovement("issue", item.key)}>
            Use
          </button>
        ) : null}
        <button type="button" className="btn sm printing-dept-refill-link" onClick={() => openMovement("refill", item.key)}>
          Refill
        </button>
      </div>
    );
  }

  return (
    <div className="inventory-dashboard printing-dept-inventory">
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Inventory</h1>
            <p className="page-subtitle">
              Printing consumables · refill stock or record daily usage (ink, rolls, powder)
            </p>
          </div>
          {canEdit || isAdmin ? (
            <div className="page-actions printing-dept-page-actions">
              {isAdmin ? (
                <button type="button" className="btn" onClick={() => setThresholdModalOpen(true)}>
                  <InventoryIcon name="warn" size={13} /> Thresholds
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" className="btn primary" onClick={() => openMovement("refill", "")}>
                  <InventoryIcon name="plus" size={13} /> Refill
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="printing-dept-inv-error" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? <p className="printing-dept-inv-loading">Loading inventory…</p> : null}

        {!loading ? (
          <>
            <div className="kpi-grid printing-dept-ink-grid">
              {inkItems.map((item) => {
                const lowStock = isPrintingMaterialLowStock(item.quantity, thresholds[item.key]);
                return (
                <div className={`kpi printing-dept-ink-kpi${lowStock ? " printing-dept-kpi--low" : ""}`} key={item.key}>
                  <div className="printing-dept-ink-swatch" style={{ background: item.color }} aria-hidden />
                  <p className="kpi-label">{item.label}</p>
                  <p className="kpi-value">
                    {formatQty(item.quantity)} <span className="printing-dept-unit">{item.unit}</span>
                  </p>
                  {lowStock ? <p className="printing-dept-low-badge">Low stock</p> : null}
                  {renderStockActions(item)}
                </div>
              );
              })}
            </div>

            <div className="kpi-grid" style={{ marginTop: 16 }}>
              {materialItems.map((item) => {
                const lowStock = isPrintingMaterialLowStock(item.quantity, thresholds[item.key]);
                return (
                <div className={`kpi${lowStock ? " printing-dept-kpi--low" : ""}`} key={item.key}>
                  <p className="kpi-label">{item.label}</p>
                  <p className="kpi-value">
                    {formatQty(item.quantity)} <span className="printing-dept-unit">{item.unit}</span>
                  </p>
                  {lowStock ? <p className="printing-dept-low-badge">Low stock</p> : null}
                  {renderStockActions(item, PRINTING_UTILIZATION_MATERIAL_KEYS.has(item.key))}
                </div>
              );
              })}
            </div>

            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-header">
                <h3 className="card-title">Movement history</h3>
                <p className="card-subtitle">Click a date to see all refills and usage for that day</p>
              </div>

              {!historyDayGroups.length ? (
                <p className="printing-dept-history-empty">No movements recorded yet.</p>
              ) : (
                <div className="printing-dept-history-days">
                  {historyDayGroups.map((day) => {
                    const isOpen = expandedDay === day.date;
                    return (
                      <div key={day.date} className={`printing-dept-history-day${isOpen ? " is-open" : ""}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          className="printing-dept-history-day-head"
                          onClick={() => toggleDay(day.date)}
                          onKeyDown={(event) => handleDayHeadKeyDown(event, day.date)}
                          aria-expanded={isOpen}
                        >
                          <span className="printing-dept-history-date">{day.dateLabel}</span>
                          <span className="printing-dept-history-overview">
                            {day.overviewChanges.length ? (
                              day.overviewChanges.map((change) => (
                                <span
                                  key={`${change.materialKey}-${change.direction}`}
                                  className={`printing-dept-delta ${change.net > 0 ? "up" : "down"}`}
                                >
                                  {change.shortCode} {formatNetChange(change.net)}
                                </span>
                              ))
                            ) : (
                              <span className="printing-dept-delta neutral">No movement</span>
                            )}
                          </span>
                          <span className="printing-dept-history-closing">
                            <span className="printing-dept-history-closing-label">Closing</span>
                            {day.closingStocks.map((stock, index) => (
                              <span key={stock.materialKey} className="printing-dept-closing-item">
                                {index > 0 ? " " : null}
                                {stock.shortCode}-{formatQty(stock.value)}
                              </span>
                            ))}
                          </span>
                          <InventoryIcon name={isOpen ? "chev_u" : "chev_d"} size={14} className="printing-dept-history-chev" />
                        </div>

                        {isOpen ? (
                          <div className="printing-dept-history-day-body">
                            <div className="table-wrap">
                              <table className="t">
                                <thead>
                                  <tr>
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th>Material</th>
                                    <th className="right">Qty</th>
                                    <th className="right">Stock after</th>
                                    <th>By</th>
                                    <th>Note</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {day.entries.map((row) => {
                                    const isIssue = (row.movement_type ?? "refill") === "issue";
                                    const shortCode = MATERIAL_SHORT_CODE[row.material_key] ?? materialLabel(row.material_key);
                                    return (
                                      <tr key={row.id}>
                                        <td>{formatMovementTime(row.created_at)}</td>
                                        <td>
                                          <span className={`badge ${isIssue ? "danger" : "success"}`}>
                                            <span className="dot" />
                                            {isIssue ? "Used" : "Refill"}
                                          </span>
                                        </td>
                                        <td>{shortCode}</td>
                                        <td className={`right mono ${isIssue ? "printing-dept-qty-down" : "printing-dept-qty-up"}`}>
                                          {isIssue ? "−" : "+"}
                                          {formatQty(row.quantity_added)} {materialUnit(row.material_key)}
                                        </td>
                                        <td className="right mono">
                                          {formatQty(row.quantity_after)} {materialUnit(row.material_key)}
                                        </td>
                                        <td>{performerName(row.refilled_by)}</td>
                                        <td>{row.note?.trim() ? row.note : "—"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      <RefillPrintingInventoryModal
        open={modalOpen}
        mode={modalMode}
        defaultMaterialKey={modalMaterialKey}
        onClose={() => setModalOpen(false)}
        onSubmit={handleMovementSubmit}
      />

      <PrintingDeptThresholdModal
        open={thresholdModalOpen && isAdmin}
        state={state}
        sessionUserId={sessionUserId}
        isAdmin={isAdmin}
        onClose={() => {
          setThresholdModalOpen(false);
          void load();
        }}
      />
    </div>
  );
}
