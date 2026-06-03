import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  emptyInwardEntryForm,
  INWARD_PACKAGE_BUCKET,
  INWARD_SELECT_FIELDS,
  validateInwardPackagePhoto
} from "./inwardEntryUtils";
import { OrderAdminSizeFields } from "./OrderAdminDetailFields";
import { emptySizesForm, sizesFormToBreakdown } from "./orderAdminEditUtils";

function trimField(value) {
  return String(value ?? "").trim();
}

export default function CreateInwardEntryModal({ open, onClose, sessionUserId, onCreated }) {
  const [form, setForm] = useState(emptyInwardEntryForm);
  const [sizes, setSizes] = useState(emptySizesForm);
  const [extraSizes, setExtraSizes] = useState([]);
  const [packageFile, setPackageFile] = useState(null);
  const [packagePreview, setPackagePreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setForm(emptyInwardEntryForm());
    setSizes(emptySizesForm());
    setExtraSizes([]);
    setPackageFile(null);
    setPackagePreview("");
    setSubmitting(false);
    setError("");
    return () => {
      if (packagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(packagePreview);
      }
    };
  }, [open]);

  if (!open) return null;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onPackagePick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const msg = validateInwardPackagePhoto(file);
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setPackageFile(file);
    setPackagePreview((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function validateForm() {
    if (!trimField(form.grn_no)) return "GRN NO. is required.";
    if (!trimField(form.for_whom)) return "For whom is required.";
    if (!trimField(form.supplier)) return "Supplier is required.";
    if (!trimField(form.product_material)) return "Product / Material name is required.";
    if (!trimField(form.qty_received)) return "Qty received is required.";
    if (!trimField(form.bora_carton_unit)) return "Bora / Carton unit is required.";
    if (!trimField(form.location_rack)) return "Location / Rack stored is required.";
    if (!trimField(form.received_by)) return "Received by is required.";
    return null;
  }

  async function uploadPackagePhoto(entryId, file) {
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const path = `${entryId}/package.${ext.replace(/[^a-z0-9]/gi, "") || "jpg"}`;
    const { error: uploadErr } = await supabase.storage
      .from(INWARD_PACKAGE_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (uploadErr) throw new Error(uploadErr.message);
    return path;
  }

  async function handleSubmit() {
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
      const hasSizes = Object.keys(sizeBreakdown).length > 0;
      const { data: inserted, error: insertErr } = await supabase
        .from("inward_entries")
        .insert({
          grn_no: trimField(form.grn_no),
          for_whom: trimField(form.for_whom),
          supplier: trimField(form.supplier),
          invoice_no: trimField(form.invoice_no),
          product_material: trimField(form.product_material),
          qty_received: trimField(form.qty_received),
          bora_carton_unit: trimField(form.bora_carton_unit),
          location_rack: trimField(form.location_rack),
          received_by: trimField(form.received_by),
          remark: trimField(form.remark),
          ...(hasSizes ? { size_breakdown: sizeBreakdown } : {}),
          created_by: sessionUserId ?? null
        })
        .select(INWARD_SELECT_FIELDS)
        .maybeSingle();

      if (insertErr) {
        throw new Error(
          insertErr.message.includes("inward_entries")
            ? `${insertErr.message}\n\nRun the latest Supabase migration (inward_entries) if this persists.`
            : insertErr.message
        );
      }
      if (!inserted?.id) {
        throw new Error(
          "Entry was not saved. Check that you can edit the Dispatch tab and that inward_entries migrations are applied."
        );
      }

      let packagePath = null;
      if (packageFile) {
        packagePath = await uploadPackagePhoto(inserted.id, packageFile);
        const { data: updated, error: updateErr } = await supabase
          .from("inward_entries")
          .update({ package_photo_path: packagePath })
          .eq("id", inserted.id)
          .select(INWARD_SELECT_FIELDS)
          .maybeSingle();
        if (updateErr) throw new Error(updateErr.message);
        onCreated?.(updated ?? { ...inserted, package_photo_path: packagePath });
      } else {
        onCreated?.(inserted);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="image-modal-backdrop create-order-modal-backdrop" onClick={onClose}>
      <div
        className="create-order-modal create-oc-modal"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-inward-modal-title"
      >
        <div className="create-order-modal-head">
          <h2 id="create-inward-modal-title">Inward entry</h2>
          <button
            type="button"
            className="order-detail-close create-order-modal-close"
            aria-label="Close inward entry form"
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

          <form className="order-form order-form--modal create-oc-form" onSubmit={(e) => e.preventDefault()}>
            <div className="order-form-cell">
              <label htmlFor="inward-grn">GRN NO.</label>
              <input
                id="inward-grn"
                type="text"
                value={form.grn_no}
                onChange={(e) => updateField("grn_no", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-for-whom">For whom</label>
              <input
                id="inward-for-whom"
                type="text"
                value={form.for_whom}
                onChange={(e) => updateField("for_whom", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-supplier">Supplier</label>
              <input
                id="inward-supplier"
                type="text"
                value={form.supplier}
                onChange={(e) => updateField("supplier", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-invoice">Invoice No.</label>
              <input
                id="inward-invoice"
                type="text"
                value={form.invoice_no}
                onChange={(e) => updateField("invoice_no", e.target.value)}
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-product">Product / Material name</label>
              <input
                id="inward-product"
                type="text"
                value={form.product_material}
                onChange={(e) => updateField("product_material", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-qty">Qty received</label>
              <input
                id="inward-qty"
                type="text"
                inputMode="decimal"
                value={form.qty_received}
                onChange={(e) => updateField("qty_received", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-bora">Bora / Carton unit</label>
              <input
                id="inward-bora"
                type="text"
                value={form.bora_carton_unit}
                onChange={(e) => updateField("bora_carton_unit", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-location">Location / Rack stored</label>
              <input
                id="inward-location"
                type="text"
                value={form.location_rack}
                onChange={(e) => updateField("location_rack", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="inward-received-by">Received by</label>
              <input
                id="inward-received-by"
                type="text"
                value={form.received_by}
                onChange={(e) => updateField("received_by", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell order-form-span-3">
              <label htmlFor="inward-remark">Remark</label>
              <input
                id="inward-remark"
                type="text"
                value={form.remark}
                onChange={(e) => updateField("remark", e.target.value)}
              />
            </div>
            <div className="order-form-cell order-form-span-3 create-oc-photo-sizes-cell">
              <div className="create-oc-photo-sizes-row">
                <div className="create-oc-photo-block">
                  <span className="create-oc-field-label">Upload package</span>
                  <div className="create-oc-photo-row">
                    <button
                      type="button"
                      className="create-oc-photo-tap"
                  onClick={() => photoInputRef.current?.click()}
                  aria-label="Upload package photo"
                >
                  {packagePreview ? (
                    <img src={packagePreview} alt="Package preview" />
                  ) : null}
                </button>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="create-oc-photo-input"
                      onChange={onPackagePick}
                      tabIndex={-1}
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="create-oc-sizes-block">
                  <div className="order-size-compact create-inward-sizes" aria-labelledby="inward-sizes-heading">
                    <span id="inward-sizes-heading" className="order-size-compact-heading create-oc-field-label">
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
              </div>
            </div>

            <div className="order-form-span-3 create-oc-submit-row">
              <button
                type="button"
                className="create-oc-generate-btn"
                disabled={submitting}
                onClick={() => handleSubmit()}
              >
                {submitting ? "Saving…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
