import { profileDisplayName } from "./coordinatorSelectUtils";
import { PURCHASE_ORDER_C_BASE_LINE_KEY } from "./purchaseOrderLayout";
import {
  firstSeqForPurchaseOrderFy,
  purchaseOrderFinancialYearCode,
  purchaseOrderIstYmd
} from "./purchaseOrderVoucherUtils";
import { supabase } from "./supabaseClient";

export const PO_GENERATE_MANDATORY_MESSAGE = "Mandatory details are Missing";

function isPurchaseOrderFilled(value) {
  return String(value ?? "").trim().length > 0;
}

function isPurchaseOrderQtyFilled(value) {
  return Boolean(String(value ?? "").replace(/\D/g, ""));
}

function isPurchaseOrderRateFilled(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return Number.isFinite(Number(text));
}

function purchaseOrderGenerateLineKeys(snapshot) {
  if (snapshot?.lineKeys?.length) return snapshot.lineKeys;
  return [PURCHASE_ORDER_C_BASE_LINE_KEY];
}

/** Missing Supplier (Bill form), Description of Goods, Due on, Quantity, unit, or Rate. */
export function collectPurchaseOrderGenerateErrors(snapshot) {
  const supplier =
    !isPurchaseOrderFilled(snapshot?.supplierName) && !isPurchaseOrderFilled(snapshot?.supplierId);
  const lines = {};
  let hasLineError = false;
  for (const key of purchaseOrderGenerateLineKeys(snapshot)) {
    const desc = !isPurchaseOrderFilled(snapshot?.lineDescriptions?.[key]);
    const due = !isPurchaseOrderFilled(snapshot?.lineDueDates?.[key]);
    const qty = !isPurchaseOrderQtyFilled(snapshot?.lineQtys?.[key]);
    const unit = !isPurchaseOrderFilled(snapshot?.lineUnits?.[key]);
    const rate = !isPurchaseOrderRateFilled(snapshot?.lineRates?.[key]);
    if (desc || due || qty || unit || rate) {
      lines[key] = { desc, due, qty, unit, rate };
      hasLineError = true;
    }
  }
  return { supplier, lines, hasError: supplier || hasLineError };
}

export function isPurchaseOrderGenerateCellMissing(id, lineKey, fieldErrors) {
  if (!fieldErrors?.hasError) return false;
  if (id === "R3") return Boolean(fieldErrors.supplier);
  if (id === "C21" || String(id).startsWith("C21:")) return Boolean(fieldErrors.lines?.[lineKey]?.desc);
  if (id === "C31" || String(id).startsWith("C31:")) return Boolean(fieldErrors.lines?.[lineKey]?.due);
  if (id === "C41" || String(id).startsWith("C41:")) {
    const line = fieldErrors.lines?.[lineKey];
    return Boolean(line?.qty || line?.unit);
  }
  if (id === "C51" || String(id).startsWith("C51:")) return Boolean(fieldErrors.lines?.[lineKey]?.rate);
  return false;
}

export function isPurchaseOrderGenerateQtyMissing(lineKey, fieldErrors) {
  return Boolean(fieldErrors?.lines?.[lineKey]?.qty);
}

export function isPurchaseOrderGenerateUnitMissing(lineKey, fieldErrors) {
  return Boolean(fieldErrors?.lines?.[lineKey]?.unit);
}

export const PO_HISTORY_STATUS_PENDING = "pending";
export const PO_HISTORY_STATUS_PO_SENT = "po_sent";
export const PO_HISTORY_STATUS_PO_APPROVED = "po_approved";
export const PO_HISTORY_STATUS_COMPLETED = "completed";

/** Backend status keys with History labels and badge colors. */
export const PO_HISTORY_STATUS_META = {
  [PO_HISTORY_STATUS_PENDING]: {
    label: "Pending",
    className: "border-amber-200 bg-amber-50 text-amber-800"
  },
  [PO_HISTORY_STATUS_PO_SENT]: {
    label: "PO sent",
    className: "border-sky-200 bg-sky-50 text-sky-800"
  },
  [PO_HISTORY_STATUS_PO_APPROVED]: {
    label: "PO Approved",
    className: "border-violet-200 bg-violet-50 text-violet-800"
  },
  [PO_HISTORY_STATUS_COMPLETED]: {
    label: "Completed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800"
  }
};

export const PO_HISTORY_STATUS_ORDER = [
  PO_HISTORY_STATUS_PENDING,
  PO_HISTORY_STATUS_PO_SENT,
  PO_HISTORY_STATUS_PO_APPROVED,
  PO_HISTORY_STATUS_COMPLETED
];

/** Open panel list — not Completed (Completed is History after backend update). */
export const PO_OPEN_STATUSES = [
  PO_HISTORY_STATUS_PENDING,
  PO_HISTORY_STATUS_PO_SENT,
  PO_HISTORY_STATUS_PO_APPROVED
];

export const PO_HISTORY_VISIBLE_STATUSES = [PO_HISTORY_STATUS_COMPLETED];

export function purchaseOrderHistoryStatusMeta(status) {
  return PO_HISTORY_STATUS_META[status] || PO_HISTORY_STATUS_META[PO_HISTORY_STATUS_PENDING];
}

export function parsePurchaseOrderVoucherCode(code) {
  const match = /^PO\/(\d{2}-\d{2})\/(\d+)$/.exec(String(code || "").trim());
  if (!match) return null;
  return { fyCode: match[1], seq: Number(match[2]) };
}

async function currentCoordinatorName() {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return "";
    const { data } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    return profileDisplayName(data);
  } catch {
    return "";
  }
}

function historyPayload(snapshot, coordinatorName) {
  const qtyRaw = snapshot?.quantity;
  const qty = qtyRaw == null || qtyRaw === "" ? null : Math.trunc(Number(qtyRaw));
  return {
    generated_at: new Date().toISOString(),
    supplier_name: String(snapshot?.supplierName || "").trim() || null,
    coordinator_name: coordinatorName || null,
    po_date: String(snapshot?.datedLabel || "").trim() || null,
    quantity: Number.isFinite(qty) ? qty : null,
    status: PO_HISTORY_STATUS_PO_SENT,
    sheet_snapshot: snapshot || null
  };
}

export function mapPurchaseOrderHistoryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    voucherCode: row.voucher_code || "",
    supplierName: row.supplier_name || "",
    coordinatorName: row.coordinator_name || "",
    poDate: row.po_date || "",
    quantity: row.quantity,
    status: row.status || PO_HISTORY_STATUS_PENDING,
    generatedAt: row.generated_at || null,
    snapshot: row.sheet_snapshot || null
  };
}

const HISTORY_SELECT =
  "id, voucher_code, supplier_name, coordinator_name, po_date, quantity, status, generated_at, sheet_snapshot";

/** Mark the reserved voucher as a generated PO. History lists this row after. */
export async function generatePurchaseOrderHistory(snapshot) {
  if (collectPurchaseOrderGenerateErrors(snapshot).hasError) {
    throw new Error(PO_GENERATE_MANDATORY_MESSAGE);
  }
  const voucherCode = String(snapshot?.voucherCode || "").trim();
  if (!voucherCode) {
    throw new Error("Voucher number missing. Open Create new PO first.");
  }

  let userId = null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    userId = auth?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const coordinatorName = await currentCoordinatorName();
  const payload = historyPayload(snapshot, coordinatorName);

  const { data: updated, error: updateError } = await supabase
    .from("dashboard_purchase_orders")
    .update(payload)
    .eq("voucher_code", voucherCode)
    .select("id")
    .maybeSingle();

  if (!updateError && updated?.id) return updated;

  if (updateError && !/could not find|schema cache|PGRST204|PGRST205/i.test(updateError.message || "")) {
    throw new Error(updateError.message);
  }

  const parsed = parsePurchaseOrderVoucherCode(voucherCode);
  const fyCode = parsed?.fyCode || purchaseOrderFinancialYearCode();
  const seq = parsed?.seq || firstSeqForPurchaseOrderFy(fyCode);
  const { data: inserted, error: insertError } = await supabase
    .from("dashboard_purchase_orders")
    .insert({
      voucher_code: voucherCode,
      fy_code: fyCode,
      seq,
      created_by: userId,
      ...payload
    })
    .select("id")
    .maybeSingle();

  if (insertError) throw new Error(insertError.message);
  return inserted;
}

export async function listGeneratedPurchaseOrders() {
  const { data, error } = await supabase
    .from("dashboard_purchase_orders")
    .select(HISTORY_SELECT)
    .not("generated_at", "is", null)
    .order("generated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapPurchaseOrderHistoryRow).filter(Boolean);
}

export async function updatePurchaseOrderHistoryStatus(id, status) {
  if (!PO_HISTORY_STATUS_META[status]) {
    throw new Error("Unknown purchase-order status.");
  }
  const { error } = await supabase
    .from("dashboard_purchase_orders")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

const PO_DATED_MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

/** Dated face (`22-Aug-26`) or `generated_at` → `YYYY-MM-DD` for From/To compare. */
export function purchaseOrderHistoryDateKey(row) {
  const label = String(row?.poDate || "").trim();
  const match = /^(\d{1,2})-([A-Za-z]{3})\.?-(\d{2})$/.exec(label);
  if (match) {
    const month = PO_DATED_MONTHS[match[2].toLowerCase()];
    if (month != null) {
      const year = 2000 + Number(match[3]);
      const day = Number(match[1]);
      if (year >= 2000 && day >= 1 && day <= 31) {
        return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  if (row?.generatedAt) return purchaseOrderIstYmd(row.generatedAt);
  return "";
}

/** Token after the last `/` — `392` from `PO/26-27/392`. */
export function purchaseOrderVoucherSeqToken(code) {
  const text = String(code || "").trim();
  if (!text) return "";
  const parts = text.split("/");
  return parts[parts.length - 1] || "";
}

/** Exact match (trim + case-insensitive) on seq, full voucher, supplier, or coordinator. */
export function purchaseOrderHistoryMatchesSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const seq = purchaseOrderVoucherSeqToken(row?.voucherCode).toLowerCase();
  const full = String(row?.voucherCode || "").trim().toLowerCase();
  const supplier = String(row?.supplierName || "").trim().toLowerCase();
  const coordinator = String(row?.coordinatorName || "").trim().toLowerCase();
  return seq === q || full === q || supplier === q || coordinator === q;
}

export function purchaseOrderHistoryInDateRange(row, dateFrom, dateTo) {
  const from = String(dateFrom || "").trim();
  const to = String(dateTo || "").trim();
  if (!from && !to) return true;
  const key = purchaseOrderHistoryDateKey(row);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export function purchaseOrderHistoryMatchesCoordinator(row, coordinator) {
  const wanted = String(coordinator || "").trim();
  if (!wanted || wanted === "all") return true;
  return String(row?.coordinatorName || "").trim() === wanted;
}

export function uniquePurchaseOrderHistoryCoordinators(rows) {
  const names = new Set();
  for (const row of rows || []) {
    const name = String(row?.coordinatorName || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function purchaseOrderHistoryMatchesStatuses(row, statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return true;
  return statuses.includes(row?.status);
}

export function filterPurchaseOrderHistoryRows(
  rows,
  { dateFrom, dateTo, searchQuery, coordinator, statuses } = {}
) {
  return (rows || []).filter(
    (row) =>
      purchaseOrderHistoryMatchesStatuses(row, statuses) &&
      purchaseOrderHistoryInDateRange(row, dateFrom, dateTo) &&
      purchaseOrderHistoryMatchesSearch(row, searchQuery) &&
      purchaseOrderHistoryMatchesCoordinator(row, coordinator)
  );
}
