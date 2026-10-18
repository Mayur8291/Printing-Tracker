import { supabase } from "./supabaseClient";

export const PURCHASE_ORDER_VOUCHER_HEADING = "Voucher No.";
export const PURCHASE_ORDER_DATED_HEADING = "Dated";
export const PURCHASE_ORDER_REFERENCE_HEADING = "Reference No. & date.";

/** First serial in FY 26-27 so the first sheet matches PO/26-27/392. Later years start at 1. */
export const PURCHASE_ORDER_FY_26_27_FIRST_SEQ = 392;

const SESSION_VOUCHER_KEY = "scott-dashboard-po-current-voucher";
const LOCAL_SEQ_KEY = "scott-dashboard-po-voucher-seq";

function voucherRecord(code, createdAt) {
  return { code, createdAt: createdAt || null };
}

function twoDigitYear(year) {
  return String(year).slice(-2).padStart(2, "0");
}

function isMissingTableError(error) {
  const msg = String(error?.message ?? "");
  return (
    error?.code === "PGRST205" ||
    /dashboard_purchase_orders|could not find the table|schema cache/i.test(msg)
  );
}

function isUniqueConflict(error) {
  const msg = String(error?.message ?? "");
  return error?.code === "23505" || /duplicate key|unique/i.test(msg);
}

/**
 * Indian accounting year: 1 Apr YYYY → 31 Mar YYYY+1.
 * Code is YY-(YY+1), e.g. 1 Apr 2026–31 Mar 2027 → 26-27.
 * Calendar date is taken in Asia/Kolkata so the flip is 1 Apr IST, not local PC time.
 */
export function purchaseOrderFinancialYearCode(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startYear = month >= 4 ? year : year - 1;
  return `${twoDigitYear(startYear)}-${twoDigitYear(startYear + 1)}`;
}

export function formatPurchaseOrderVoucher(fyCode, seq) {
  return `PO/${fyCode}/${seq}`;
}

function purchaseOrderIstDateParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "2-digit"
  }).formatToParts(new Date(date));
}

/** PO creation date in IST, e.g. 21-Aug-26. */
export function formatPurchaseOrderDated(date = new Date()) {
  const parts = purchaseOrderIstDateParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = (parts.find((part) => part.type === "month")?.value || "").replace(".", "");
  const year = parts.find((part) => part.type === "year")?.value;
  return `${day}-${month}-${year}`;
}

/** Due on cell, e.g. 14-Aug -26. */
export function formatPurchaseOrderDueOn(date = new Date()) {
  const parts = purchaseOrderIstDateParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = (parts.find((part) => part.type === "month")?.value || "").replace(".", "");
  const year = parts.find((part) => part.type === "year")?.value;
  return `${day}-${month} -${year}`;
}

export function purchaseOrderIstYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(date));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/** Due on may be today (IST) or later. Past IST days are blocked. */
export function isPurchaseOrderDueOnAllowed(date) {
  if (!date) return false;
  return purchaseOrderIstYmd(date) >= purchaseOrderIstYmd(new Date());
}

export function firstSeqForPurchaseOrderFy(fyCode) {
  return fyCode === "26-27" ? PURCHASE_ORDER_FY_26_27_FIRST_SEQ : 1;
}

export function readSessionPurchaseOrder() {
  try {
    const raw = sessionStorage.getItem(SESSION_VOUCHER_KEY);
    if (!raw) return null;
    if (raw.startsWith("PO/")) return voucherRecord(raw, null);
    const parsed = JSON.parse(raw);
    if (!parsed?.code) return null;
    return voucherRecord(parsed.code, parsed.createdAt || null);
  } catch {
    return null;
  }
}

export function writeSessionPurchaseOrder(record) {
  try {
    sessionStorage.setItem(SESSION_VOUCHER_KEY, JSON.stringify(voucherRecord(record.code, record.createdAt)));
  } catch {
    /* private mode */
  }
}

function allocateLocalVoucher(fyCode) {
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem(LOCAL_SEQ_KEY) || "{}") || {};
  } catch {
    map = {};
  }
  const next = Number(map[fyCode] || firstSeqForPurchaseOrderFy(fyCode) - 1) + 1;
  map[fyCode] = next;
  try {
    localStorage.setItem(LOCAL_SEQ_KEY, JSON.stringify(map));
  } catch {
    /* private mode */
  }
  const record = voucherRecord(formatPurchaseOrderVoucher(fyCode, next), new Date().toISOString());
  writeSessionPurchaseOrder(record);
  return record;
}

async function insertVoucherRow(fyCode, seq, userId) {
  const code = formatPurchaseOrderVoucher(fyCode, seq);
  const { data, error } = await supabase
    .from("dashboard_purchase_orders")
    .insert({
      voucher_code: code,
      fy_code: fyCode,
      seq,
      created_by: userId || null
    })
    .select("voucher_code, created_at")
    .maybeSingle();
  return {
    record: data ? voucherRecord(data.voucher_code, data.created_at) : voucherRecord(code, new Date().toISOString()),
    error
  };
}

export async function loadPurchaseOrderByVoucher(code) {
  if (!code) return null;
  const withGenerated = await supabase
    .from("dashboard_purchase_orders")
    .select("voucher_code, created_at, generated_at")
    .eq("voucher_code", code)
    .maybeSingle();
  if (!withGenerated.error && withGenerated.data) {
    const record = voucherRecord(withGenerated.data.voucher_code, withGenerated.data.created_at);
    record.generatedAt = withGenerated.data.generated_at || null;
    return record;
  }
  const { data, error } = await supabase
    .from("dashboard_purchase_orders")
    .select("voucher_code, created_at")
    .eq("voucher_code", code)
    .maybeSingle();
  if (error || !data) return null;
  return voucherRecord(data.voucher_code, data.created_at);
}

/** Reserve the next PO/YY-YY/N for the current Indian FY. Plus and first sheet load call this. */
export async function allocatePurchaseOrderVoucher(now = new Date()) {
  const fyCode = purchaseOrderFinancialYearCode(now);
  let userId = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase
      .from("dashboard_purchase_orders")
      .select("seq")
      .eq("fy_code", fyCode)
      .order("seq", { ascending: false })
      .limit(1);

    if (error) {
      if (isMissingTableError(error)) {
        console.warn("PO voucher table missing — using local sequence until migration is on staging.");
        return allocateLocalVoucher(fyCode);
      }
      console.warn("PO voucher read:", error.message);
      return allocateLocalVoucher(fyCode);
    }

    const next = (data?.[0]?.seq ?? firstSeqForPurchaseOrderFy(fyCode) - 1) + 1;
    const { record, error: insertError } = await insertVoucherRow(fyCode, next, userId);
    if (!insertError) {
      writeSessionPurchaseOrder(record);
      return record;
    }
    if (isMissingTableError(insertError)) {
      console.warn("PO voucher table missing — using local sequence until migration is on staging.");
      return allocateLocalVoucher(fyCode);
    }
    if (isUniqueConflict(insertError)) continue;
    console.warn("PO voucher insert:", insertError.message);
    return allocateLocalVoucher(fyCode);
  }

  return allocateLocalVoucher(fyCode);
}
