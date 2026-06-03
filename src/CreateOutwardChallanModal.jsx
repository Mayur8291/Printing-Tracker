import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  buildOutwardChallanBarcodePayload,
  emptyOutwardChallanForm,
  OC_PACKAGING_BUCKET,
  OC_SELECT_FIELDS,
  OC_TRANSPORT_MODES,
  sanitizePhoneDigits,
  validateOcPackagingPhoto
} from "./outwardChallanUtils";
import { buildOcQrValue } from "./outwardChallanQr";

function trimField(value) {
  return String(value ?? "").trim();
}

export default function CreateOutwardChallanModal({ open, onClose, sessionUserId, onCreated }) {
  const [form, setForm] = useState(emptyOutwardChallanForm);
  const [packagingFile, setPackagingFile] = useState(null);
  const [packagingPreview, setPackagingPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setForm(emptyOutwardChallanForm());
    setPackagingFile(null);
    setPackagingPreview("");
    setSubmitting(false);
    setError("");
    return () => {
      if (packagingPreview.startsWith("blob:")) {
        URL.revokeObjectURL(packagingPreview);
      }
    };
  }, [open]);

  if (!open) return null;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateContactField(key, value) {
    updateField(key, sanitizePhoneDigits(value));
  }

  function onPackagingPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const msg = validateOcPackagingPhoto(file);
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setPackagingFile(file);
    setPackagingPreview((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function validateForm() {
    if (!trimField(form.sender)) return "Sender is required.";
    if (!trimField(form.product_material)) return "Product / Material is required.";
    if (!trimField(form.purpose)) return "Purpose is required.";
    if (!form.mode_of_transport) return "Mode of transport is required.";
    if (!trimField(form.sent_to)) return "Sent to is required.";
    if (!trimField(form.receiver_name)) return "Receiver name is required.";
    if (!sanitizePhoneDigits(form.sender_contact)) return "Sender contact number is required.";
    if (!sanitizePhoneDigits(form.receiver_contact)) return "Receiver contact number is required.";
    if (!trimField(form.quantity)) return "Quantity is required.";
    if (!trimField(form.bora_carton_count)) return "No. of Bora / Carton is required.";
    return null;
  }

  function formToRowPayload(id, createdAt) {
    return {
      id,
      created_at: createdAt ?? null,
      sender: trimField(form.sender),
      product_material: trimField(form.product_material),
      purpose: trimField(form.purpose),
      mode_of_transport: form.mode_of_transport,
      sent_to: trimField(form.sent_to),
      sender_contact: sanitizePhoneDigits(form.sender_contact),
      receiver_name: trimField(form.receiver_name),
      receiver_contact: sanitizePhoneDigits(form.receiver_contact),
      quantity: trimField(form.quantity),
      bora_carton_count: trimField(form.bora_carton_count)
    };
  }

  async function uploadPackagingPhoto(challanId, file) {
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const path = `${challanId}/packaging.${ext.replace(/[^a-z0-9]/gi, "") || "jpg"}`;
    const { error: uploadErr } = await supabase.storage
      .from(OC_PACKAGING_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (uploadErr) throw new Error(uploadErr.message);
    return path;
  }

  async function handleSaveAndGenerateQr() {
    if (submitting) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const stamp = Date.now();
      const provisional = `OCTEMP${String(stamp).slice(-10)}`;

      const { data: inserted, error: insertErr } = await supabase
        .from("outward_challans")
        .insert({
          sender: trimField(form.sender),
          product_material: trimField(form.product_material),
          purpose: trimField(form.purpose),
          mode_of_transport: form.mode_of_transport,
          sent_to: trimField(form.sent_to),
          sender_contact: sanitizePhoneDigits(form.sender_contact),
          receiver_name: trimField(form.receiver_name),
          receiver_contact: sanitizePhoneDigits(form.receiver_contact),
          quantity: trimField(form.quantity),
          bora_carton_count: trimField(form.bora_carton_count),
          barcode_value: provisional,
          created_by: sessionUserId ?? null
        })
        .select(OC_SELECT_FIELDS)
        .maybeSingle();

      if (insertErr) {
        throw new Error(
          insertErr.message.includes("outward_challans")
            ? `${insertErr.message}\n\nRun the latest Supabase migration (outward_challans) if this persists.`
            : insertErr.message
        );
      }
      if (!inserted?.id) {
        throw new Error(
          "OC was not saved. Check that you can edit the Dispatch tab and that outward_challans migrations are applied."
        );
      }

      const rowForQr = formToRowPayload(inserted.id, inserted.created_at);
      const qrValue = buildOcQrValue(rowForQr);
      const barcodePayload = {
        ...buildOutwardChallanBarcodePayload(rowForQr),
        qr_value: qrValue,
        scan_value: qrValue
      };

      let packagingPath = null;
      if (packagingFile) {
        packagingPath = await uploadPackagingPhoto(inserted.id, packagingFile);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("outward_challans")
        .update({
          barcode_value: qrValue,
          barcode_payload: barcodePayload,
          ...(packagingPath ? { packaging_photo_path: packagingPath } : {})
        })
        .eq("id", inserted.id)
        .select(OC_SELECT_FIELDS)
        .maybeSingle();

      if (updateErr) {
        throw new Error(
          updateErr.message.includes("single JSON")
            ? `${updateErr.message}\n\nRun supabase db push for latest outward_challans migrations.`
            : updateErr.message
        );
      }

      const saved = updated ?? {
        ...inserted,
        ...rowForQr,
        barcode_value: qrValue,
        barcode_payload: barcodePayload,
        packaging_photo_path: packagingPath ?? inserted.packaging_photo_path
      };

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
        className="create-order-modal create-oc-modal"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-oc-modal-title"
      >
        <div className="create-order-modal-head">
          <h2 id="create-oc-modal-title">Create New OC</h2>
          <button
            type="button"
            className="order-detail-close create-order-modal-close"
            aria-label="Close create OC"
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
            <p className="create-oc-auto-date-note order-form-span-3">
              Date and time are recorded automatically. A QR code preview opens after save.
            </p>
            <div className="order-form-cell">
              <label htmlFor="oc-sender">Sender</label>
              <input
                id="oc-sender"
                type="text"
                value={form.sender}
                onChange={(e) => updateField("sender", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-product">Product / Material</label>
              <input
                id="oc-product"
                type="text"
                value={form.product_material}
                onChange={(e) => updateField("product_material", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-purpose">Purpose</label>
              <input
                id="oc-purpose"
                type="text"
                value={form.purpose}
                onChange={(e) => updateField("purpose", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-transport">Mode of transport</label>
              <select
                id="oc-transport"
                value={form.mode_of_transport}
                onChange={(e) => updateField("mode_of_transport", e.target.value)}
                required
              >
                {OC_TRANSPORT_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-sent-to">Sent to</label>
              <input
                id="oc-sent-to"
                type="text"
                value={form.sent_to}
                onChange={(e) => updateField("sent_to", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-receiver-name">Receiver name</label>
              <input
                id="oc-receiver-name"
                type="text"
                value={form.receiver_name}
                onChange={(e) => updateField("receiver_name", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-sender-contact">Sender contact number</label>
              <input
                id="oc-sender-contact"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel"
                value={form.sender_contact}
                onChange={(e) => updateContactField("sender_contact", e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  updateContactField("sender_contact", e.clipboardData?.getData("text") ?? "");
                }}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-receiver-contact">Receiver contact number</label>
              <input
                id="oc-receiver-contact"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel"
                value={form.receiver_contact}
                onChange={(e) => updateContactField("receiver_contact", e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  updateContactField("receiver_contact", e.clipboardData?.getData("text") ?? "");
                }}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-quantity">Quantity</label>
              <input
                id="oc-quantity"
                type="text"
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => updateField("quantity", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="oc-bora-carton">No. of Bora / Carton</label>
              <input
                id="oc-bora-carton"
                type="text"
                inputMode="numeric"
                value={form.bora_carton_count}
                onChange={(e) => updateField("bora_carton_count", e.target.value)}
                required
              />
            </div>
            <div className="order-form-cell order-form-span-3 create-oc-photo-cell">
              <span className="create-oc-field-label">Upload packaging photo</span>
              <div className="create-oc-photo-row">
                <button
                  type="button"
                  className="create-oc-photo-tap"
                  onClick={() => photoInputRef.current?.click()}
                >
                  {packagingPreview ? (
                    <img src={packagingPreview} alt="Packaging preview" />
                  ) : (
                    <span className="create-oc-photo-hint">Tap to upload packaging photo</span>
                  )}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="create-oc-photo-input"
                  onChange={onPackagingPick}
                  tabIndex={-1}
                  aria-hidden
                />
              </div>
            </div>

            <div className="order-form-span-3 create-oc-submit-row">
              <button
                type="button"
                className="create-oc-generate-btn"
                disabled={submitting}
                onClick={() => handleSaveAndGenerateQr()}
              >
                {submitting ? "Saving…" : "Save & generate QR"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
