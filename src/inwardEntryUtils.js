import { supabase } from "./supabaseClient";
import { formatSizeBreakdownSummary } from "./orderViewUtils";
import { parseSizeQtyInput } from "./orderAdminEditUtils";

export const INWARD_PACKAGE_BUCKET = "inward-entry-packaging";
export const INWARD_MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const INWARD_SELECT_FIELDS =
  "id, grn_no, for_whom, supplier, invoice_no, product_material, department, individual_name, qty_received, bora_carton_unit, location_rack, received_by, remark, bill_photo_path, package_photo_path, size_breakdown, created_at, created_by";

export const INWARD_GRN_SELECT_FIELDS =
  "id, inward_entry_id, grn_no, for_whom, supplier, invoice_no, qty_received, bora_carton_unit, location_rack, received_by, remark, size_breakdown, grn_entry_detail, created_at, created_by";

export const INWARD_ENTRY_WITH_GRNS_SELECT = `${INWARD_SELECT_FIELDS}, inward_grn_entries(${INWARD_GRN_SELECT_FIELDS})`;

export const INWARD_DEPARTMENT_INDIVIDUAL = "Individual / Personal";

export const INWARD_ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

export const INWARD_DEPARTMENT_OPTIONS = [
  "Inventory",
  "Procurement",
  "Printing",
  "Production",
  "Sales",
  INWARD_DEPARTMENT_INDIVIDUAL
];

export function isInwardIndividualDepartment(department) {
  return trimField(department) === INWARD_DEPARTMENT_INDIVIDUAL;
}

export function formatInwardDepartmentDisplay(record) {
  const department = trimField(record?.department);
  if (!department) return "—";
  if (isInwardIndividualDepartment(department)) {
    const name = trimField(record?.individual_name);
    return name ? `${department} — ${name}` : department;
  }
  return department;
}

function trimField(value) {
  return String(value ?? "").trim();
}

export function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyInwardEntryForm() {
  return {
    entry_date: todayLocalISODate(),
    product_material: "",
    department: "",
    individual_name: ""
  };
}

export function emptyInwardGrnForm() {
  return {
    grn_no: "",
    for_whom: "",
    supplier: "",
    invoice_no: "",
    qty_received: "",
    bora_carton_unit: "",
    location_rack: "",
    received_by: "",
    remark: ""
  };
}

export function inwardGrnFormFromRecord(record) {
  return {
    grn_no: record?.grn_no ?? "",
    for_whom: record?.for_whom ?? "",
    supplier: record?.supplier ?? "",
    invoice_no: record?.invoice_no ?? "",
    qty_received: record?.qty_received ?? "",
    bora_carton_unit: record?.bora_carton_unit ?? "",
    location_rack: record?.location_rack ?? "",
    received_by: record?.received_by ?? "",
    remark: record?.remark ?? ""
  };
}

export function inwardGrnToInsertPayload(
  form,
  sizeBreakdown,
  inwardEntryId,
  sessionUserId,
  grnEntryDetail = null
) {
  const hasSizes = sizeBreakdown && Object.keys(sizeBreakdown).length > 0;
  const hasDetail =
    grnEntryDetail && typeof grnEntryDetail === "object" && !Array.isArray(grnEntryDetail);
  return {
    inward_entry_id: inwardEntryId,
    grn_no: trimField(form.grn_no),
    for_whom: trimField(form.for_whom),
    supplier: trimField(form.supplier),
    invoice_no: trimField(form.invoice_no),
    qty_received: trimField(form.qty_received),
    bora_carton_unit: trimField(form.bora_carton_unit),
    location_rack: trimField(form.location_rack),
    received_by: trimField(form.received_by),
    remark: trimField(form.remark),
    ...(hasSizes ? { size_breakdown: sizeBreakdown } : {}),
    ...(hasDetail ? { grn_entry_detail: grnEntryDetail } : {}),
    created_by: sessionUserId ?? null
  };
}

function legacyGrnFromInwardRecord(record) {
  if (!trimField(record?.grn_no)) return null;
  return {
    id: `legacy-${record.id}`,
    inward_entry_id: record.id,
    grn_no: record.grn_no,
    for_whom: record.for_whom,
    supplier: record.supplier,
    invoice_no: record.invoice_no,
    qty_received: record.qty_received,
    bora_carton_unit: record.bora_carton_unit,
    location_rack: record.location_rack,
    received_by: record.received_by,
    remark: record.remark,
    size_breakdown: record.size_breakdown,
    created_at: record.created_at,
    created_by: record.created_by
  };
}

export function getInwardGrnEntries(record) {
  const embedded = record?.inward_grn_entries;
  if (Array.isArray(embedded) && embedded.length) {
    return [...embedded].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  const legacy = legacyGrnFromInwardRecord(record);
  return legacy ? [legacy] : [];
}

export function inwardHasGrnDetails(record) {
  return getInwardGrnEntries(record).length > 0;
}

export function formatInwardGrnListSummary(record) {
  const grns = getInwardGrnEntries(record);
  if (!grns.length) return "";
  if (grns.length === 1) return trimField(grns[0].grn_no) || "1 GRN";
  return `${grns.length} GRNs`;
}

export function grnHasSizeBreakdown(grnRecord) {
  const breakdown = grnRecord?.size_breakdown;
  if (!breakdown || typeof breakdown !== "object") return false;
  return Object.values(breakdown).some((val) => parseSizeQtyInput(val) > 0);
}

export function inwardHasSizeBreakdown(record) {
  return getInwardGrnEntries(record).some((grn) => grnHasSizeBreakdown(grn));
}

export function formatGrnCreatedAt(grnRecord) {
  const raw = grnRecord?.created_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function buildInwardGrnLabelRows(grnRecord, inwardRecord) {
  const rows = [
    { label: "Inward entry #", value: inwardRecord?.id ?? "—" },
    { label: "GRN #", value: grnRecord?.id ?? "—" },
    { label: "GRN NO.", value: trimField(grnRecord?.grn_no) || "—" },
    { label: "Product / Material", value: trimField(inwardRecord?.product_material) || "—" },
    { label: "Department", value: formatInwardDepartmentDisplay(inwardRecord) },
    { label: "For whom", value: trimField(grnRecord?.for_whom) || "—" },
    { label: "Supplier", value: trimField(grnRecord?.supplier) || "—" },
    { label: "Invoice No.", value: trimField(grnRecord?.invoice_no) || "—" },
    { label: "Qty received", value: trimField(grnRecord?.qty_received) || "—" },
    { label: "Bora / Carton unit", value: trimField(grnRecord?.bora_carton_unit) || "—" },
    { label: "Location / Rack", value: trimField(grnRecord?.location_rack) || "—" },
    { label: "Received by", value: trimField(grnRecord?.received_by) || "—" },
    { label: "Remark", value: trimField(grnRecord?.remark) || "—" },
    { label: "Created", value: formatGrnCreatedAt(grnRecord) }
  ];
  if (grnHasSizeBreakdown(grnRecord)) {
    rows.push({
      label: "Sizes",
      value: formatSizeBreakdownSummary(grnRecord.size_breakdown)
    });
  }
  return rows;
}


export function formatInwardEntryCreatedAt(record) {
  const raw = record?.created_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function formatInwardEntryDateLabel(isoDate) {
  const raw = String(isoDate ?? "").trim();
  if (!raw) return "—";
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function formatInwardEntryListDate(record) {
  const raw = record?.created_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function buildInwardEntryLabelRows(record) {
  return [
    { label: "Entry #", value: record?.id ?? "—" },
    { label: "Date", value: formatInwardEntryListDate(record) },
    { label: "Product / Material", value: trimField(record?.product_material) || "—" },
    { label: "Department", value: formatInwardDepartmentDisplay(record) },
    {
      label: "GRN entries",
      value: inwardHasGrnDetails(record) ? formatInwardGrnListSummary(record) : "None yet"
    }
  ];
}

export function inwardStoragePhotoPublicUrl(path) {
  if (!path?.trim()) return null;
  const { data } = supabase.storage.from(INWARD_PACKAGE_BUCKET).getPublicUrl(path.trim());
  return data?.publicUrl ?? null;
}

/** @deprecated use inwardStoragePhotoPublicUrl */
export function packagePhotoPublicUrl(path) {
  return inwardStoragePhotoPublicUrl(path);
}

export function inwardBillPhotoPath(record) {
  const bill = trimField(record?.bill_photo_path);
  if (bill) return bill;
  const legacy = trimField(record?.package_photo_path);
  if (legacy && legacy.includes("/bill.")) return legacy;
  return null;
}

export function inwardPackagePhotoPath(record) {
  const pkg = trimField(record?.package_photo_path);
  if (!pkg || pkg.includes("/bill.")) return null;
  return pkg;
}

export function formatInwardPhotoUploadStatus(record) {
  const hasBill = Boolean(inwardBillPhotoPath(record));
  const hasPackage = Boolean(inwardPackagePhotoPath(record));
  if (hasBill && hasPackage) return "Bill & package";
  if (hasBill) return "Bill";
  if (hasPackage) return "Package";
  return "—";
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
  const paths = [inwardBillPhotoPath(record), inwardPackagePhotoPath(record)].filter(Boolean);
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length) {
    await client.storage.from(INWARD_PACKAGE_BUCKET).remove(uniquePaths);
  }
  const { error } = await client.from("inward_entries").delete().eq("id", record.id);
  if (error) throw new Error(error.message);
}
