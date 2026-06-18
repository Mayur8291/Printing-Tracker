import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  emptyInwardEntryForm,
  formatInwardEntryDateLabel,
  INWARD_DEPARTMENT_OPTIONS,
  INWARD_PACKAGE_BUCKET,
  INWARD_SELECT_FIELDS,
  isInwardIndividualDepartment,
  validateInwardPackagePhoto
} from "./inwardEntryUtils";
import { insertInwardEntryTagNotifications } from "./inwardEntryNotificationUtils";
import InwardUserTagPicker from "./InwardUserTagPicker";

function trimField(value) {
  return String(value ?? "").trim();
}

function revokeBlobUrl(url) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

export default function CreateInwardEntryModal({ open, onClose, sessionUserId, onCreated }) {
  const [form, setForm] = useState(() => emptyInwardEntryForm());
  const [billFile, setBillFile] = useState(null);
  const [billPreview, setBillPreview] = useState("");
  const [packageFile, setPackageFile] = useState(null);
  const [packagePreview, setPackagePreview] = useState("");
  const [taggedUserIds, setTaggedUserIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const billInputRef = useRef(null);
  const packageInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setForm(emptyInwardEntryForm());
    setBillFile(null);
    setBillPreview("");
    setPackageFile(null);
    setPackagePreview("");
    setTaggedUserIds([]);
    setSubmitting(false);
    setError("");
    return () => {
      revokeBlobUrl(billPreview);
      revokeBlobUrl(packagePreview);
    };
  }, [open]);

  if (!open) return null;

  function updateField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "department" && !isInwardIndividualDepartment(value)) {
        next.individual_name = "";
      }
      return next;
    });
  }

  const showIndividualName = isInwardIndividualDepartment(form.department);

  function onPhotoPick(kind, e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const msg = validateInwardPackagePhoto(file);
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    const previewUrl = URL.createObjectURL(file);
    if (kind === "bill") {
      setBillFile(file);
      setBillPreview((prev) => {
        revokeBlobUrl(prev);
        return previewUrl;
      });
    } else {
      setPackageFile(file);
      setPackagePreview((prev) => {
        revokeBlobUrl(prev);
        return previewUrl;
      });
    }
  }

  function validateForm() {
    if (!trimField(form.product_material)) return "Product / Material is required.";
    if (!trimField(form.department)) return "Department is required.";
    if (showIndividualName && !trimField(form.individual_name)) {
      return "Individual name is required.";
    }
    return null;
  }

  async function uploadInwardPhoto(entryId, file, kind) {
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const path = `${entryId}/${kind}.${ext.replace(/[^a-z0-9]/gi, "") || "jpg"}`;
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
      const { data: inserted, error: insertErr } = await supabase
        .from("inward_entries")
        .insert({
          product_material: trimField(form.product_material),
          department: trimField(form.department),
          individual_name: showIndividualName ? trimField(form.individual_name) : "",
          created_by: sessionUserId ?? null
        })
        .select(INWARD_SELECT_FIELDS)
        .maybeSingle();

      if (insertErr) {
        throw new Error(
          insertErr.message.includes("inward_entries") ||
            insertErr.message.includes("department") ||
            insertErr.message.includes("bill_photo_path")
            ? `${insertErr.message}\n\nRun the latest Supabase migration (inward_entries) if this persists.`
            : insertErr.message
        );
      }
      if (!inserted?.id) {
        throw new Error(
          "Entry was not saved. Check that you can edit the Dispatch tab and that inward_entries migrations are applied."
        );
      }

      const photoUpdate = {};
      if (billFile) {
        photoUpdate.bill_photo_path = await uploadInwardPhoto(inserted.id, billFile, "bill");
      }
      if (packageFile) {
        photoUpdate.package_photo_path = await uploadInwardPhoto(inserted.id, packageFile, "package");
      }

      let saved = inserted;
      if (Object.keys(photoUpdate).length) {
        const { data: updated, error: updateErr } = await supabase
          .from("inward_entries")
          .update(photoUpdate)
          .eq("id", inserted.id)
          .select(INWARD_SELECT_FIELDS)
          .maybeSingle();
        if (updateErr) throw new Error(updateErr.message);
        saved = updated ?? { ...inserted, ...photoUpdate };
      }

      if (taggedUserIds.length && sessionUserId) {
        await insertInwardEntryTagNotifications(supabase, {
          inwardEntryId: saved.id,
          taggedUserIds,
          taggedByUserId: sessionUserId,
          productMaterial: saved.product_material,
          department: saved.department,
          grnNo: saved.grn_no
        });
      }

      onCreated?.(saved);
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
        className="create-order-modal create-oc-modal create-inward-modal--compact"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-inward-modal-title"
      >
        <div className="create-order-modal-head">
          <h2 id="create-inward-modal-title">Make entry</h2>
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

          <form className="order-form order-form--modal create-oc-form create-inward-form" onSubmit={(e) => e.preventDefault()}>
            <div className="order-form-cell">
              <label htmlFor="inward-date">Date</label>
              <input
                id="inward-date"
                type="text"
                readOnly
                className="order-form-readonly-input"
                value={formatInwardEntryDateLabel(form.entry_date)}
                aria-readonly="true"
              />
            </div>
            <div className="order-form-cell order-form-span-2">
              <label htmlFor="inward-product">Product / Material</label>
              <input
                id="inward-product"
                type="text"
                value={form.product_material}
                onChange={(e) => updateField("product_material", e.target.value)}
                placeholder="Product / material name"
                required
              />
            </div>
            <div className="order-form-cell order-form-span-2">
              <label htmlFor="inward-department">Department</label>
              <select
                id="inward-department"
                value={form.department}
                onChange={(e) => updateField("department", e.target.value)}
                required
              >
                <option value="">Select department</option>
                {INWARD_DEPARTMENT_OPTIONS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
            {showIndividualName ? (
              <div className="order-form-cell order-form-span-2 create-inward-individual-cell">
                <label htmlFor="inward-individual-name">Individual name</label>
                <input
                  id="inward-individual-name"
                  type="text"
                  value={form.individual_name}
                  onChange={(e) => updateField("individual_name", e.target.value)}
                  placeholder="Enter individual name"
                  required
                />
              </div>
            ) : null}
            <div className="order-form-cell order-form-span-3 create-inward-tag-cell">
              <InwardUserTagPicker
                selectedIds={taggedUserIds}
                onChange={setTaggedUserIds}
                excludeUserId={sessionUserId}
              />
            </div>
            <div className="order-form-cell order-form-span-3 create-inward-photos-cell">
              <span className="create-oc-field-label">Bill &amp; package photos</span>
              <div className="create-inward-photos-row">
                <div className="create-inward-photo-block">
                  <span className="create-inward-photo-label">Bill</span>
                  <div className="create-oc-photo-row">
                    <button
                      type="button"
                      className="create-oc-photo-tap create-inward-photo-tap"
                      onClick={() => billInputRef.current?.click()}
                      aria-label="Upload bill image"
                    >
                      {billPreview ? (
                        <img src={billPreview} alt="Bill preview" />
                      ) : (
                        <span className="create-inward-bill-placeholder">Tap to upload bill</span>
                      )}
                    </button>
                    <input
                      ref={billInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="create-oc-photo-input"
                      onChange={(e) => onPhotoPick("bill", e)}
                      tabIndex={-1}
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="create-inward-photo-block">
                  <span className="create-inward-photo-label">Package</span>
                  <div className="create-oc-photo-row">
                    <button
                      type="button"
                      className="create-oc-photo-tap create-inward-photo-tap"
                      onClick={() => packageInputRef.current?.click()}
                      aria-label="Upload package photo"
                    >
                      {packagePreview ? (
                        <img src={packagePreview} alt="Package preview" />
                      ) : (
                        <span className="create-inward-bill-placeholder">Tap to upload package</span>
                      )}
                    </button>
                    <input
                      ref={packageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="create-oc-photo-input"
                      onChange={(e) => onPhotoPick("package", e)}
                      tabIndex={-1}
                      aria-hidden
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
