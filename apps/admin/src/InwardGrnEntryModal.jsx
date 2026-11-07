import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  emptyInwardGrnForm,
  formatInwardDepartmentDisplay,
  formatGrnCreatedAt,
  getInwardGrnEntries,
  grnHasSizeBreakdown,
  INWARD_GRN_SELECT_FIELDS,
  inwardGrnToInsertPayload
} from "./inwardEntryUtils";
import { printInwardGrnLabel } from "./inwardGrnPrint";
import { OrderAdminSizeFields } from "./OrderAdminDetailFields";
import { emptySizesForm, sizesFormToBreakdown } from "./orderAdminEditUtils";
import { formatSizeBreakdownSummary } from "./orderViewUtils";

function trimField(value) {
  return String(value ?? "").trim();
}

function resetGrnFormState() {
  return {
    form: emptyInwardGrnForm(),
    sizes: emptySizesForm(),
    extraSizes: []
  };
}

export default function InwardGrnEntryModal({
  open,
  inwardRecord,
  sessionUserId,
  onClose,
  onSaved
}) {
  const [grnEntries, setGrnEntries] = useState([]);
  const [loadingGrns, setLoadingGrns] = useState(false);
  const [form, setForm] = useState(emptyInwardGrnForm);
  const [sizes, setSizes] = useState(emptySizesForm);
  const [extraSizes, setExtraSizes] = useState([]);
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
    if (!open || !inwardRecord?.id) return;
    const fresh = resetGrnFormState();
    setForm(fresh.form);
    setSizes(fresh.sizes);
    setExtraSizes(fresh.extraSizes);
    setSubmitting(false);
    setPrintingId(null);
    setError("");
    void loadGrnEntries(inwardRecord.id);
  }, [open, inwardRecord?.id, loadGrnEntries]);

  if (!open || !inwardRecord) return null;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function clearNewGrnForm() {
    const fresh = resetGrnFormState();
    setForm(fresh.form);
    setSizes(fresh.sizes);
    setExtraSizes(fresh.extraSizes);
  }

  function validateForm() {
    if (!trimField(form.grn_no)) return "GRN NO. is required.";
    if (!trimField(form.for_whom)) return "For whom is required.";
    if (!trimField(form.supplier)) return "Supplier is required.";
    if (!trimField(form.qty_received)) return "Qty received is required.";
    if (!trimField(form.bora_carton_unit)) return "Bora / Carton unit is required.";
    if (!trimField(form.location_rack)) return "Location / Rack stored is required.";
    if (!trimField(form.received_by)) return "Received by is required.";
    return null;
  }

  async function handleSave(printAfterSave = false) {
    if (submitting) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const sizeBreakdown = sizesFormToBreakdown(sizes, extraSizes);
      const payload = inwardGrnToInsertPayload(
        form,
        sizeBreakdown,
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
      clearNewGrnForm();

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

  const productLabel = trimField(inwardRecord.product_material) || "—";
  const departmentLabel = formatInwardDepartmentDisplay(inwardRecord);

  return (
    <div className="image-modal-backdrop create-order-modal-backdrop" onClick={onClose}>
      <div
        className="create-order-modal create-oc-modal inward-grn-modal"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inward-grn-modal-title"
      >
        <div className="create-order-modal-head">
          <div>
            <h2 id="inward-grn-modal-title">GRN entries</h2>
            <p className="inward-grn-modal-lead">
              Entry #{inwardRecord.id} · {productLabel} · {departmentLabel}
            </p>
          </div>
          <button
            type="button"
            className="order-detail-close create-order-modal-close"
            aria-label="Close GRN entries"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="create-order-modal-body">
          {error ? (
            <p className="create-oc-error" role="alert">
              {error}
            </p>
          ) : null}

          <section className="inward-grn-saved-section" aria-labelledby="inward-grn-saved-heading">
            <div className="inward-grn-saved-head">
              <h3 id="inward-grn-saved-heading">Saved GRN entries</h3>
              <span className="inward-grn-saved-count">
                {loadingGrns ? "Loading…" : `${grnEntries.length} saved`}
              </span>
            </div>
            {loadingGrns ? (
              <p className="inward-grn-saved-empty">Loading GRN entries…</p>
            ) : grnEntries.length === 0 ? (
              <p className="inward-grn-saved-empty">No GRN entries yet. Add one below.</p>
            ) : (
              <div className="inward-grn-saved-list">
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

          <section className="inward-grn-new-section" aria-labelledby="inward-grn-new-heading">
            <h3 id="inward-grn-new-heading">Add GRN entry</h3>
            <form className="order-form order-form--modal create-oc-form" onSubmit={(e) => e.preventDefault()}>
              <div className="order-form-cell">
                <label htmlFor="grn-grn-no">GRN NO.</label>
                <input
                  id="grn-grn-no"
                  type="text"
                  value={form.grn_no}
                  onChange={(e) => updateField("grn_no", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-for-whom">For whom</label>
                <input
                  id="grn-for-whom"
                  type="text"
                  value={form.for_whom}
                  onChange={(e) => updateField("for_whom", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-supplier">Supplier</label>
                <input
                  id="grn-supplier"
                  type="text"
                  value={form.supplier}
                  onChange={(e) => updateField("supplier", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-invoice">Invoice No.</label>
                <input
                  id="grn-invoice"
                  type="text"
                  value={form.invoice_no}
                  onChange={(e) => updateField("invoice_no", e.target.value)}
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-qty">Qty received</label>
                <input
                  id="grn-qty"
                  type="text"
                  inputMode="decimal"
                  value={form.qty_received}
                  onChange={(e) => updateField("qty_received", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-bora">Bora / Carton unit</label>
                <input
                  id="grn-bora"
                  type="text"
                  value={form.bora_carton_unit}
                  onChange={(e) => updateField("bora_carton_unit", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-location">Location / Rack stored</label>
                <input
                  id="grn-location"
                  type="text"
                  value={form.location_rack}
                  onChange={(e) => updateField("location_rack", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell">
                <label htmlFor="grn-received-by">Received by</label>
                <input
                  id="grn-received-by"
                  type="text"
                  value={form.received_by}
                  onChange={(e) => updateField("received_by", e.target.value)}
                  required
                />
              </div>
              <div className="order-form-cell order-form-span-3">
                <label htmlFor="grn-remark">Remark</label>
                <input
                  id="grn-remark"
                  type="text"
                  value={form.remark}
                  onChange={(e) => updateField("remark", e.target.value)}
                />
              </div>
              <div className="order-form-cell order-form-span-3">
                <div className="order-size-compact create-inward-sizes" aria-labelledby="grn-sizes-heading">
                  <span id="grn-sizes-heading" className="order-size-compact-heading create-oc-field-label">
                    Sizes <span className="create-inward-sizes-optional">(optional)</span>
                  </span>
                  <OrderAdminSizeFields
                    draft={{ sizes, extraSizes }}
                    onPatch={(patch) => {
                      if (patch.sizes) setSizes(patch.sizes);
                      if (patch.extraSizes) setExtraSizes(patch.extraSizes);
                    }}
                  />
                </div>
              </div>

              <div className="order-form-span-3 inward-grn-submit-row">
                <button
                  type="button"
                  className="create-oc-generate-btn"
                  disabled={submitting || printingId != null}
                  onClick={() => void handleSave(false)}
                >
                  {submitting ? "Saving…" : "Save GRN"}
                </button>
                <button
                  type="button"
                  className="inward-grn-save-print-btn"
                  disabled={submitting || printingId != null}
                  onClick={() => void handleSave(true)}
                >
                  {submitting ? "Saving…" : "Save & print label"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
