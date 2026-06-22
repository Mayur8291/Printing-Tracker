import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  formatGrnCreatedAt,
  formatInwardDepartmentDisplay,
  getInwardGrnEntries,
  grnHasSizeBreakdown,
  INWARD_GRN_SELECT_FIELDS
} from "./inwardEntryUtils";
import {
  buildGrnStatChips,
  computeGrnTotals,
  emptyGrnBora,
  emptyGrnFabricLine,
  emptyGrnFormState,
  emptyGrnProduct,
  GRN_SIZE_KEYS,
  GRN_TYPE_APPAREL,
  GRN_TYPE_FABRIC,
  inwardGrnToInsertPayloadFromState,
  sanitizeGrnFabricInput,
  sanitizeGrnSizeInput,
  validateGrnForm
} from "./inwardGrnFormUtils";
import { printInwardGrnLabel } from "./inwardGrnPrint";
import { formatSizeBreakdownSummary } from "./orderViewUtils";

function trimField(value) {
  return String(value ?? "").trim();
}

export default function InwardGrnEntryPage({
  inwardRecord,
  sessionUserId,
  onBack,
  onSaved,
  canEdit = true
}) {
  const [grnEntries, setGrnEntries] = useState([]);
  const [loadingGrns, setLoadingGrns] = useState(false);
  const [formState, setFormState] = useState(emptyGrnFormState);
  const [submitting, setSubmitting] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const [error, setError] = useState("");

  const loadGrnEntries = useCallback(async (entryId) => {
    if (!entryId) {
      setGrnEntries([]);
      return;
    }
    setLoadingGrns(true);
    const { data, error: loadErr } = await supabase
      .from("inward_grn_entries")
      .select(INWARD_GRN_SELECT_FIELDS)
      .eq("inward_entry_id", entryId)
      .order("created_at", { ascending: true });
    setLoadingGrns(false);
    if (loadErr) {
      console.error(loadErr.message);
      setGrnEntries(getInwardGrnEntries(inwardRecord));
      return;
    }
    setGrnEntries(data ?? []);
  }, [inwardRecord]);

  useEffect(() => {
    if (!inwardRecord?.id) return;
    setFormState(emptyGrnFormState());
    setSubmitting(false);
    setPrintingId(null);
    setError("");
    void loadGrnEntries(inwardRecord.id);
  }, [inwardRecord?.id, loadGrnEntries]);

  const totals = useMemo(() => computeGrnTotals(formState), [formState]);
  const statChips = useMemo(
    () => buildGrnStatChips(formState, totals),
    [formState, totals]
  );
  const isApparel = formState.type === GRN_TYPE_APPAREL;

  const productLabel = trimField(inwardRecord?.product_material) || "—";
  const departmentLabel = formatInwardDepartmentDisplay(inwardRecord);
  const companyName = "Scott International";

  function updateHeader(field, value) {
    setFormState((prev) => ({
      ...prev,
      header: { ...prev.header, [field]: value }
    }));
  }

  function setType(type) {
    setFormState((prev) => ({ ...prev, type }));
  }

  function resetForm() {
    setFormState(emptyGrnFormState(formState.type));
    setError("");
  }

  function addBora() {
    setFormState((prev) => ({
      ...prev,
      boras: [
        ...prev.boras,
        emptyGrnBora(`Bora ${prev.boras.length + 1}`)
      ]
    }));
  }

  function removeBora(boraId) {
    setFormState((prev) => ({
      ...prev,
      boras: prev.boras.filter((bora) => bora.id !== boraId)
    }));
  }

  function updateBoraLabel(boraId, label) {
    setFormState((prev) => ({
      ...prev,
      boras: prev.boras.map((bora) => (bora.id === boraId ? { ...bora, label } : bora))
    }));
  }

  function addProduct(boraId) {
    setFormState((prev) => ({
      ...prev,
      boras: prev.boras.map((bora) =>
        bora.id === boraId
          ? { ...bora, products: [...bora.products, emptyGrnProduct()] }
          : bora
      )
    }));
  }

  function removeProduct(boraId, productId) {
    setFormState((prev) => ({
      ...prev,
      boras: prev.boras.map((bora) =>
        bora.id === boraId
          ? { ...bora, products: bora.products.filter((product) => product.id !== productId) }
          : bora
      )
    }));
  }

  function updateProductName(boraId, productId, name) {
    setFormState((prev) => ({
      ...prev,
      boras: prev.boras.map((bora) =>
        bora.id === boraId
          ? {
              ...bora,
              products: bora.products.map((product) =>
                product.id === productId ? { ...product, name } : product
              )
            }
          : bora
      )
    }));
  }

  function updateProductSize(boraId, productId, sizeKey, value) {
    const sanitized = sanitizeGrnSizeInput(value);
    setFormState((prev) => ({
      ...prev,
      boras: prev.boras.map((bora) =>
        bora.id === boraId
          ? {
              ...bora,
              products: bora.products.map((product) =>
                product.id === productId ? { ...product, [sizeKey]: sanitized } : product
              )
            }
          : bora
      )
    }));
  }

  function addFabricLine() {
    setFormState((prev) => ({
      ...prev,
      fabrics: [...prev.fabrics, emptyGrnFabricLine()]
    }));
  }

  function removeFabricLine(lineId) {
    setFormState((prev) => ({
      ...prev,
      fabrics: prev.fabrics.filter((row) => row.id !== lineId)
    }));
  }

  function updateFabricField(lineId, field, value) {
    const sanitized = sanitizeGrnFabricInput(field, value);
    setFormState((prev) => ({
      ...prev,
      fabrics: prev.fabrics.map((row) =>
        row.id === lineId ? { ...row, [field]: sanitized } : row
      )
    }));
  }

  async function handleSave(printAfterSave = false) {
    if (submitting || !canEdit) return;
    const validationError = validateGrnForm(formState);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = inwardGrnToInsertPayloadFromState(
        formState,
        inwardRecord.id,
        sessionUserId
      );
      const { data: inserted, error: insertErr } = await supabase
        .from("inward_grn_entries")
        .insert(payload)
        .select(INWARD_GRN_SELECT_FIELDS)
        .maybeSingle();
      if (insertErr) {
        throw new Error(
          insertErr.message.includes("inward_grn_entries")
            ? `${insertErr.message}\n\nRun migration 20260619120000_add_inward_grn_entries.sql on this Supabase project.`
            : insertErr.message
        );
      }
      if (!inserted) throw new Error("GRN entry was not saved.");

      await loadGrnEntries(inwardRecord.id);
      onSaved?.(inwardRecord);
      setFormState(emptyGrnFormState(formState.type));

      if (printAfterSave) {
        setPrintingId(inserted.id);
        try {
          await printInwardGrnLabel(inserted, inwardRecord);
        } finally {
          setPrintingId(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrint(grnRecord) {
    if (printingId != null) return;
    setPrintingId(grnRecord.id);
    try {
      await printInwardGrnLabel(grnRecord, inwardRecord);
    } finally {
      setPrintingId(null);
    }
  }

  if (!inwardRecord) return null;

  return (
    <div className="inward-grn-page">
      <header className="inward-grn-page-header">
        <div className="inward-grn-page-header-inner">
          <div className="inward-grn-page-header-left">
            <button
              type="button"
              className="inward-grn-page-back"
              onClick={onBack}
              aria-label="Back to inward list"
            >
              ← Back
            </button>
            <div className="inward-grn-page-brand">
              <span className="inward-grn-page-brand-icon" aria-hidden="true">
                G
              </span>
              <div className="inward-grn-page-brand-text">
                <h1 className="inward-grn-page-title">Goods Receipt — Inward</h1>
                <p className="inward-grn-page-subtitle">
                  {companyName} · Entry #{inwardRecord.id} · {productLabel} · {departmentLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="inward-grn-page-header-actions">
            <div
              className="inward-grn-type-toggle"
              role="group"
              aria-label="Receipt type"
            >
              <span
                className="inward-grn-type-toggle-thumb"
                style={{ transform: isApparel ? "translateX(0%)" : "translateX(100%)" }}
                aria-hidden="true"
              />
              <button
                type="button"
                className={`inward-grn-type-toggle-btn${isApparel ? " is-active" : ""}`}
                onClick={() => setType(GRN_TYPE_APPAREL)}
                disabled={!canEdit}
              >
                Apparel
              </button>
              <button
                type="button"
                className={`inward-grn-type-toggle-btn${!isApparel ? " is-active" : ""}`}
                onClick={() => setType(GRN_TYPE_FABRIC)}
                disabled={!canEdit}
              >
                Fabric
              </button>
            </div>
            <button
              type="button"
              className="inward-grn-page-reset-btn"
              onClick={resetForm}
              disabled={!canEdit || submitting}
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      <div className="inward-grn-page-body">
        {error ? (
          <p className="inward-grn-page-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="inward-grn-saved-section inward-grn-page-saved" aria-labelledby="inward-grn-page-saved-heading">
          <div className="inward-grn-saved-head">
            <h2 id="inward-grn-page-saved-heading" className="inward-grn-page-section-title">
              Saved GRN entries
            </h2>
            <span className="inward-grn-saved-count">
              {loadingGrns ? "Loading…" : `${grnEntries.length} saved`}
            </span>
          </div>
          {loadingGrns ? (
            <p className="inward-grn-saved-empty">Loading GRN entries…</p>
          ) : grnEntries.length === 0 ? (
            <p className="inward-grn-saved-empty">No GRN entries yet. Add one below.</p>
          ) : (
            <div className="inward-grn-saved-list inward-grn-page-saved-list">
              {grnEntries.map((grn) => (
                <article key={grn.id} className="inward-grn-saved-card">
                  <div className="inward-grn-saved-card-main">
                    <p className="inward-grn-saved-card-title">
                      <strong>{trimField(grn.grn_no) || "—"}</strong>
                      <span className="inward-grn-saved-card-meta">
                        {formatGrnCreatedAt(grn)}
                      </span>
                    </p>
                    <p className="inward-grn-saved-card-sub">
                      {trimField(grn.supplier) || "—"} · Qty {trimField(grn.qty_received) || "—"} ·{" "}
                      {trimField(grn.location_rack) || "—"}
                    </p>
                    {grnHasSizeBreakdown(grn) ? (
                      <p className="inward-grn-saved-card-sub">
                        Sizes: {formatSizeBreakdownSummary(grn.size_breakdown)}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="inward-grn-print-btn"
                    disabled={printingId === grn.id || submitting}
                    onClick={() => void handlePrint(grn)}
                  >
                    {printingId === grn.id ? "Preparing…" : "Print label"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="inward-grn-card" aria-labelledby="inward-grn-details-heading">
          <header className="inward-grn-card-head">
            <h2 id="inward-grn-details-heading" className="inward-grn-card-title">
              GRN Details
            </h2>
            <span className="inward-grn-card-meta">
              {isApparel ? "Apparel" : "Fabric"} inward
            </span>
          </header>
          <div className="inward-grn-details-grid">
            <label className="inward-grn-field">
              <span className="inward-grn-field-label">GRN No.</span>
              <input
                type="text"
                value={formState.header.grnNo}
                onChange={(e) => updateHeader("grnNo", e.target.value)}
                disabled={!canEdit}
                required
              />
            </label>
            <label className="inward-grn-field">
              <span className="inward-grn-field-label">Receipt Date</span>
              <input
                type="date"
                value={formState.header.date}
                onChange={(e) => updateHeader("date", e.target.value)}
                disabled={!canEdit}
              />
            </label>
            <label className="inward-grn-field">
              <span className="inward-grn-field-label">Invoice No.</span>
              <input
                type="text"
                value={formState.header.invoiceNo}
                onChange={(e) => updateHeader("invoiceNo", e.target.value)}
                placeholder="INV-0000"
                disabled={!canEdit}
              />
            </label>
            <label className="inward-grn-field inward-grn-field--span-2">
              <span className="inward-grn-field-label">Supplier</span>
              <input
                type="text"
                value={formState.header.supplier}
                onChange={(e) => updateHeader("supplier", e.target.value)}
                placeholder="Supplier name"
                disabled={!canEdit}
                required
              />
            </label>
            <label className="inward-grn-field">
              <span className="inward-grn-field-label">Storage Location</span>
              <input
                type="text"
                value={formState.header.location}
                onChange={(e) => updateHeader("location", e.target.value)}
                placeholder="e.g. Rack A-12"
                disabled={!canEdit}
                required
              />
            </label>
            <label className="inward-grn-field">
              <span className="inward-grn-field-label">For whom</span>
              <input
                type="text"
                value={formState.header.forWhom}
                onChange={(e) => updateHeader("forWhom", e.target.value)}
                disabled={!canEdit}
                required
              />
            </label>
            <label className="inward-grn-field">
              <span className="inward-grn-field-label">Received by</span>
              <input
                type="text"
                value={formState.header.receivedBy}
                onChange={(e) => updateHeader("receivedBy", e.target.value)}
                disabled={!canEdit}
                required
              />
            </label>
            <label className="inward-grn-field inward-grn-field--span-3">
              <span className="inward-grn-field-label">Remark</span>
              <input
                type="text"
                value={formState.header.remark}
                onChange={(e) => updateHeader("remark", e.target.value)}
                disabled={!canEdit}
              />
            </label>
          </div>
        </section>

        <div className="inward-grn-stat-chips" role="list" aria-label="GRN summary">
          {statChips.map((chip) => (
            <div key={chip.label} className="inward-grn-stat-chip" role="listitem">
              <span className="inward-grn-stat-chip-label">{chip.label}</span>
              <span className="inward-grn-stat-chip-value">
                {chip.value}
                {chip.unit ? <span className="inward-grn-stat-chip-unit"> {chip.unit}</span> : null}
              </span>
            </div>
          ))}
        </div>

        {isApparel ? (
          <>
            {totals.boraGroups.map((bora) => (
              <section key={bora.id} className="inward-grn-card inward-grn-bora-card">
                <header className="inward-grn-bora-head">
                  <div className="inward-grn-bora-head-main">
                    <span className="inward-grn-bora-seq">Bora {bora.seq}</span>
                    <input
                      type="text"
                      className="inward-grn-bora-label-input"
                      value={bora.label}
                      onChange={(e) => updateBoraLabel(bora.id, e.target.value)}
                      disabled={!canEdit}
                      aria-label={`Bora ${bora.seq} label`}
                    />
                    <span className="inward-grn-bora-total">{bora.total} pcs</span>
                  </div>
                  {formState.boras.length > 1 ? (
                    <button
                      type="button"
                      className="inward-grn-row-remove"
                      onClick={() => removeBora(bora.id)}
                      disabled={!canEdit}
                      aria-label={`Remove bora ${bora.seq}`}
                    >
                      ×
                    </button>
                  ) : null}
                </header>
                <div className="inward-grn-table-wrap">
                  <table className="inward-grn-product-table">
                    <thead>
                      <tr>
                        <th>Product / Style</th>
                        {GRN_SIZE_KEYS.map((size) => (
                          <th key={size}>{size}</th>
                        ))}
                        <th>Total</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {bora.products.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <input
                              type="text"
                              className="inward-grn-product-name"
                              value={product.name}
                              onChange={(e) =>
                                updateProductName(bora.id, product.id, e.target.value)
                              }
                              placeholder="e.g. Crew Tee — Navy"
                              disabled={!canEdit}
                            />
                          </td>
                          {GRN_SIZE_KEYS.map((size) => (
                            <td key={size}>
                              <input
                                type="text"
                                inputMode="numeric"
                                className="inward-grn-size-input"
                                value={product[size]}
                                onChange={(e) =>
                                  updateProductSize(bora.id, product.id, size, e.target.value)
                                }
                                placeholder="0"
                                disabled={!canEdit}
                              />
                            </td>
                          ))}
                          <td className="inward-grn-product-total">{product.total || 0}</td>
                          <td>
                            {bora.products.length > 1 ? (
                              <button
                                type="button"
                                className="inward-grn-row-remove"
                                onClick={() => removeProduct(bora.id, product.id)}
                                disabled={!canEdit}
                                aria-label="Remove product row"
                              >
                                ×
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Bora subtotal</td>
                        {GRN_SIZE_KEYS.map((size) => (
                          <td key={size} className="inward-grn-size-subtotal">
                            {bora.sizeTotals[size]}
                          </td>
                        ))}
                        <td className="inward-grn-product-total">{bora.total}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="inward-grn-bora-foot">
                  <button
                    type="button"
                    className="inward-grn-add-row-btn"
                    onClick={() => addProduct(bora.id)}
                    disabled={!canEdit}
                  >
                    + Add product
                  </button>
                </div>
              </section>
            ))}

            <button
              type="button"
              className="inward-grn-add-bora-btn"
              onClick={addBora}
              disabled={!canEdit}
            >
              + Add bora
            </button>

            <section className="inward-grn-card inward-grn-totals-card">
              <div className="inward-grn-table-wrap">
                <table className="inward-grn-totals-table">
                  <tbody>
                    <tr className="inward-grn-totals-row">
                      <td className="inward-grn-totals-label">
                        GRN Total — {totals.totalBoras} boras · {totals.totalProducts} products
                      </td>
                      {GRN_SIZE_KEYS.map((size) => (
                        <td key={size} className="inward-grn-totals-size">
                          <span className="inward-grn-totals-size-key">{size}</span>
                          <span className="inward-grn-totals-size-val">{totals.sizeTotals[size]}</span>
                        </td>
                      ))}
                      <td className="inward-grn-totals-grand">
                        <span className="inward-grn-totals-size-key">Total</span>
                        <span className="inward-grn-totals-size-val">{totals.grandPieces}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="inward-grn-card inward-grn-fabric-card">
            <div className="inward-grn-table-wrap">
              <table className="inward-grn-fabric-table">
                <thead>
                  <tr>
                    <th>Fabric Type</th>
                    <th>Colour</th>
                    <th>GSM</th>
                    <th>Rolls/Than</th>
                    <th>Kgs</th>
                    <th>Lot / Batch</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {formState.fabrics.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="text"
                          className="inward-grn-fabric-type"
                          value={row.ftype}
                          onChange={(e) => updateFabricField(row.id, "ftype", e.target.value)}
                          placeholder="e.g. Single Jersey"
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={row.color}
                          onChange={(e) => updateFabricField(row.id, "color", e.target.value)}
                          placeholder="Colour"
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="inward-grn-fabric-num"
                          value={row.gsm}
                          onChange={(e) => updateFabricField(row.id, "gsm", e.target.value)}
                          placeholder="0"
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="inward-grn-fabric-num"
                          value={row.rolls}
                          onChange={(e) => updateFabricField(row.id, "rolls", e.target.value)}
                          placeholder="0"
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="inward-grn-fabric-num"
                          value={row.kgs}
                          onChange={(e) => updateFabricField(row.id, "kgs", e.target.value)}
                          placeholder="0.0"
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={row.lot}
                          onChange={(e) => updateFabricField(row.id, "lot", e.target.value)}
                          placeholder="Lot / batch"
                          disabled={!canEdit}
                        />
                      </td>
                      <td>
                        {formState.fabrics.length > 1 ? (
                          <button
                            type="button"
                            className="inward-grn-row-remove"
                            onClick={() => removeFabricLine(row.id)}
                            disabled={!canEdit}
                            aria-label="Remove fabric line"
                          >
                            ×
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>{totals.fabricLines} lots received</td>
                    <td className="inward-grn-fabric-foot-num">{totals.totalRolls}</td>
                    <td className="inward-grn-fabric-foot-num">{totals.totalKgsDisplay}</td>
                    <td className="inward-grn-fabric-foot-unit">kg total</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="inward-grn-fabric-foot">
              <button
                type="button"
                className="inward-grn-add-row-btn inward-grn-add-row-btn--full"
                onClick={addFabricLine}
                disabled={!canEdit}
              >
                + Add fabric line
              </button>
            </div>
          </section>
        )}

        {canEdit ? (
          <div className="inward-grn-page-actions">
            <button
              type="button"
              className="inward-grn-save-btn"
              disabled={submitting || printingId != null}
              onClick={() => void handleSave(false)}
            >
              {submitting ? "Saving…" : "Save GRN"}
            </button>
            <button
              type="button"
              className="inward-grn-save-print-btn inward-grn-save-btn--primary"
              disabled={submitting || printingId != null}
              onClick={() => void handleSave(true)}
            >
              {submitting ? "Saving…" : "Save & print label"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
