import { supabase } from "./supabaseClient";
import { formatSizeBreakdownSummary } from "./orderViewUtils";
import { parseSizeQtyInput } from "./orderAdminEditUtils";

export const INWARD_PACKAGE_BUCKET = "inward-entry-packaging";
export const INWARD_MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const INWARD_SELECT_FIELDS =
  "id, grn_no, for_whom, supplier, invoice_no, product_material, qty_received, bora_carton_unit, location_rack, received_by, remark, package_photo_path, size_breakdown, created_at, created_by";

export const INWARD_ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function trimField(value) {
  return String(value ?? "").trim();
}

export function emptyInwardEntryForm() {
  return {
    grn_no: "",
    for_whom: "",
    supplier: "",
    invoice_no: "",
    product_material: "",
    qty_received: "",
    bora_carton_unit: "",
    location_rack: "",
    received_by: "",
    remark: ""
  };
}

export function inwardHasSizeBreakdown(record) {
  const breakdown = record?.size_breakdown;
  if (!breakdown || typeof breakdown !== "object") return false;
  return Object.values(breakdown).some((val) => parseSizeQtyInput(val) > 0);
}

export function formatInwardEntryCreatedAt(record) {
  const raw = record?.created_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function buildInwardEntryLabelRows(record) {
  const rows = [
    { label: "Entry #", value: record?.id ?? "—" },
    { label: "Date & time", value: formatInwardEntryCreatedAt(record) },
    { label: "GRN NO.", value: trimField(record?.grn_no) || "—" },
    { label: "For whom", value: trimField(record?.for_whom) || "—" },
    { label: "Supplier", value: trimField(record?.supplier) || "—" },
    { label: "Invoice No.", value: trimField(record?.invoice_no) || "—" },
    { label: "Product / Material", value: trimField(record?.product_material) || "—" },
    { label: "Qty received", value: trimField(record?.qty_received) || "—" },
    { label: "Bora / Carton unit", value: trimField(record?.bora_carton_unit) || "—" },
    { label: "Location / Rack", value: trimField(record?.location_rack) || "—" },
    { label: "Received by", value: trimField(record?.received_by) || "—" },
    { label: "Remark", value: trimField(record?.remark) || "—" }
  ];
  if (inwardHasSizeBreakdown(record)) {
    rows.push({
      label: "Sizes",
      value: formatSizeBreakdownSummary(record.size_breakdown)
    });
  }
  return rows;
}

export function packagePhotoPublicUrl(path) {
  if (!path?.trim()) return null;
  const { data } = supabase.storage.from(INWARD_PACKAGE_BUCKET).getPublicUrl(path.trim());
  return data?.publicUrl ?? null;
}

export function validateInwardPackagePhoto(file) {
  if (!file) return null;
  if (!INWARD_ALLOWED_PHOTO_TYPES.has(file.type)) {
    return "Photo must be JPEG, PNG, WebP, or GIF.";
  }
  if (file.size > INWARD_MAX_PHOTO_BYTES) {
    return "Photo must be 8 MB or smaller.";
  }
  return null;
}

export async function deleteInwardEntry(client, record) {
  const path = record?.package_photo_path?.trim();
  if (path) {
    await client.storage.from(INWARD_PACKAGE_BUCKET).remove([path]);
  }
  const { error } = await client.from("inward_entries").delete().eq("id", record.id);
  if (error) throw new Error(error.message);
}
