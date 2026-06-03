import { supabase } from "./supabaseClient";

export const OC_PACKAGING_BUCKET = "outward-challan-packaging";
export const OC_MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const BRAND_LOGO_URL = "/brand-logo.png";

export const OC_SELECT_FIELDS =
  "id, oc_date, sender, product_material, purpose, mode_of_transport, sent_to, sender_contact, receiver_name, receiver_contact, quantity, bora_carton_count, barcode_value, barcode_payload, packaging_photo_path, created_at";

export const OC_ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

export const OC_TRANSPORT_MODES = [
  { value: "makali_vehicle", label: "Makali Vehicle" },
  { value: "porter_rapido", label: "Porter / Rapido" },
  { value: "transport", label: "Transport" },
  { value: "bus_service", label: "Bus Service" },
  { value: "other", label: "Other" }
];

export const OC_PRINT_LABEL_STYLES = `
  body{font-family:Helvetica,Arial,sans-serif;padding:24px;color:#0f172a;margin:0}
  .oc-label-brand{display:flex;align-items:center;gap:14px;margin:0 auto 20px;max-width:520px}
  .oc-label-brand img{width:56px;height:56px;object-fit:contain;flex-shrink:0}
  .oc-label-brand-name{font-family:Helvetica,"Helvetica Neue",Arial,sans-serif;font-weight:700;font-size:22px;letter-spacing:0.02em;color:#0f172a;line-height:1.2}
  .oc-print-subtitle{margin:0 auto 16px;max-width:520px;font-size:13px;color:#64748b;text-align:center}
  .barcode{text-align:center;margin:16px 0}
  table{border-collapse:collapse;width:100%;max-width:520px;margin:0 auto}
  th{text-align:left;padding:6px 12px 6px 0;color:#64748b;font-size:12px;font-weight:600;vertical-align:top}
  td{padding:6px 0;font-size:14px;font-weight:600;vertical-align:top}
`;

export function ocTransportLabel(value) {
  return OC_TRANSPORT_MODES.find((o) => o.value === value)?.label ?? value ?? "—";
}

export function emptyOutwardChallanForm() {
  return {
    sender: "",
    product_material: "",
    purpose: "",
    mode_of_transport: "makali_vehicle",
    sent_to: "",
    sender_contact: "",
    receiver_name: "",
    receiver_contact: "",
    quantity: "",
    bora_carton_count: ""
  };
}

function trimField(value) {
  return String(value ?? "").trim();
}

/** Contact fields: digits only (0-9). */
export function sanitizePhoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatOcCreatedAt(record) {
  const raw = record?.created_at ?? record?.barcode_payload?.created_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function ocBarcodeDateToken(record) {
  const raw = record?.created_at ?? record?.barcode_payload?.created_at;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${y}${m}${day}${h}${min}`;
    }
  }
  return String(record.oc_date ?? "").replace(/-/g, "");
}

/** Strip to CODE128-safe compact token (A-Z 0-9). */
function barcodeToken(value, maxLen = 16) {
  const t = trimField(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!t) return "NA";
  return t.slice(0, maxLen);
}

export function getOcBarcodeScanValue(record) {
  const fromPayload = record?.barcode_payload?.scan_value;
  if (fromPayload) return fromPayload;
  if (record?.barcode_value && !String(record.barcode_value).startsWith("OCTEMP")) {
    return record.barcode_value;
  }
  return buildOutwardChallanBarcodeScanValue(record);
}

/** Scannable barcode string including key shipment data. */
export function buildOutwardChallanBarcodeScanValue(record) {
  const id = String(record.id ?? 0).padStart(6, "0");
  const date = ocBarcodeDateToken(record);
  const qty = barcodeToken(record.quantity, 12);
  const bora = barcodeToken(record.bora_carton_count, 8);
  const sender = barcodeToken(record.sender, 10);
  const sentTo = barcodeToken(record.sent_to, 10);
  const receiver = barcodeToken(record.receiver_name, 10);
  const product = barcodeToken(record.product_material, 12);
  return `OC${id}D${date}Q${qty}B${bora}F${sender}T${sentTo}R${receiver}P${product}`;
}

/** Human-readable line under the barcode image. */
export function buildOutwardChallanBarcodeCaption(record) {
  const id = String(record.id ?? "").padStart(6, "0");
  const qty = trimField(record.quantity) || "—";
  const bora = trimField(record.bora_carton_count) || "—";
  return `OC #${id} | ${formatOcCreatedAt(record)} | Qty ${qty} | Bora/Ctn ${bora}`;
}

/** Full payload stored in DB and shown on printed label. */
export function buildOutwardChallanBarcodePayload(record) {
  return {
    id: record.id,
    created_at: record.created_at ?? null,
    sender: trimField(record.sender),
    product_material: trimField(record.product_material),
    purpose: trimField(record.purpose),
    mode_of_transport: record.mode_of_transport,
    mode_of_transport_label: ocTransportLabel(record.mode_of_transport),
    sent_to: trimField(record.sent_to),
    sender_contact: sanitizePhoneDigits(record.sender_contact),
    receiver_name: trimField(record.receiver_name),
    receiver_contact: sanitizePhoneDigits(record.receiver_contact),
    quantity: trimField(record.quantity),
    bora_carton_count: trimField(record.bora_carton_count),
    scan_value: buildOutwardChallanBarcodeScanValue(record)
  };
}

export function buildOcLabelRows(record) {
  const payload = record.barcode_payload ?? buildOutwardChallanBarcodePayload(record);
  return [
    { label: "OC #", value: String(payload.id ?? record.id ?? "—") },
    { label: "Created", value: formatOcCreatedAt({ created_at: payload.created_at ?? record.created_at }) },
    { label: "Sender", value: payload.sender || "—" },
    { label: "Product / Material", value: payload.product_material || "—" },
    { label: "Purpose", value: payload.purpose || "—" },
    {
      label: "Mode of transport",
      value: payload.mode_of_transport_label || ocTransportLabel(record.mode_of_transport)
    },
    { label: "Sent to", value: payload.sent_to || "—" },
    { label: "Receiver name", value: payload.receiver_name || "—" },
    { label: "Quantity", value: payload.quantity || "—" },
    { label: "No. of Bora / Carton", value: payload.bora_carton_count || "—" },
    { label: "Sender contact", value: payload.sender_contact || "—" },
    { label: "Receiver contact", value: payload.receiver_contact || "—" }
  ];
}

export function resolveBrandLogoUrl() {
  if (typeof window === "undefined") return BRAND_LOGO_URL;
  return `${window.location.origin}${BRAND_LOGO_URL}`;
}

export function renderOcBrandHeaderHtml() {
  const logoUrl = resolveBrandLogoUrl();
  return `<div class="oc-label-brand">
    <img src="${logoUrl}" alt="Scott International logo" width="56" height="56" />
    <span class="oc-label-brand-name">Scott International</span>
  </div>`;
}

export function packagingPhotoPublicUrl(path) {
  if (!path?.trim()) return "";
  const { data } = supabase.storage.from(OC_PACKAGING_BUCKET).getPublicUrl(path.trim());
  return data?.publicUrl ?? "";
}

export function validateOcPackagingPhoto(file) {
  if (!file) return null;
  if (!OC_ALLOWED_PHOTO_TYPES.has(file.type)) {
    return "Photo must be JPEG, PNG, WebP, or GIF.";
  }
  if (file.size > OC_MAX_PHOTO_BYTES) {
    return "Photo must be 8 MB or smaller.";
  }
  return null;
}

/** Plain-text QR payload — readable in any camera app (no URL). */
export function buildOcQrText(record) {
  const lines = [
    "SCOTT INTERNATIONAL",
    "OUTWARD CHALLAN",
    "",
    `OC #: ${record?.id ?? "—"}`,
    `Created: ${formatOcCreatedAt(record)}`,
    `Sender: ${trimField(record?.sender) || "—"}`,
    `Product / Material: ${trimField(record?.product_material) || "—"}`,
    `Purpose: ${trimField(record?.purpose) || "—"}`,
    `Mode of transport: ${ocTransportLabel(record?.mode_of_transport)}`,
    `Sent to: ${trimField(record?.sent_to) || "—"}`,
    `Receiver name: ${trimField(record?.receiver_name) || "—"}`,
    `Sender contact: ${sanitizePhoneDigits(record?.sender_contact) || "—"}`,
    `Receiver contact: ${sanitizePhoneDigits(record?.receiver_contact) || "—"}`,
    `Quantity: ${trimField(record?.quantity) || "—"}`,
    `No. of Bora / Carton: ${trimField(record?.bora_carton_count) || "—"}`
  ];
  return lines.join("\n");
}

/** Delete OC row and packaging photo (admin only — enforced by RLS). */
export async function deleteOutwardChallan(client, record) {
  const path = record?.packaging_photo_path?.trim();
  if (path) {
    await client.storage.from(OC_PACKAGING_BUCKET).remove([path]);
  }
  const { error } = await client.from("outward_challans").delete().eq("id", record.id);
  if (error) throw new Error(error.message);
}
