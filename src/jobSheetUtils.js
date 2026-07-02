/** Job sheet size grid helpers (Production tracker). */

import { sizesFormToBreakdown, sumSizeForm } from "./orderAdminEditUtils";

import {

  getJobSheetSizeColumnsForType,

  getJobSheetSizeTypeLabel,

  inferGenderProductTypeFromSizeType,

  JOB_SHEET_LEGACY_SIZE_COLUMNS

} from "./jobSheetSizeTypeConfig";



export { JOB_SHEET_SIZE_TYPES, getJobSheetSizeTypeLabel, getJobSheetSizeColumnsForType, formatJobSheetSizeColumnHeader, JOB_SHEET_GENDERS, JOB_SHEET_PRODUCT_TYPES, getJobSheetGenderLabel, getJobSheetProductTypeOptions, getJobSheetProductTypeLabel, filterJobSheetSizeTypes, inferGenderProductTypeFromSizeType, JOB_SHEET_LEGACY_SIZE_COLUMNS } from "./jobSheetSizeTypeConfig";



export function isPetsJobSheetGender(gender) {
  return String(gender ?? "").trim() === "pets";
}



export function getJobSheetActiveColumns({ gender = "", sizeType = "" } = {}) {
  if (isPetsJobSheetGender(gender)) return JOB_SHEET_LEGACY_SIZE_COLUMNS;
  return getJobSheetSizeColumnsForType(sizeType);
}



/** @deprecated Use getJobSheetSizeColumnsForType(sizeType) */

export const JOB_SHEET_SIZE_COLUMNS = JOB_SHEET_LEGACY_SIZE_COLUMNS;



/** First job sheet order number when none exist yet. */

export const JOB_SHEET_ORDER_ID_START = 900;



export function emptyJobSheetSizesForm(sizeType = "", gender = "") {

  const columns = getJobSheetActiveColumns({ gender, sizeType });

  return Object.fromEntries(columns.map(({ key }) => [key, ""]));

}



export function newJobSheetExtraSizeRow() {

  return {

    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,

    label: "",

    qty: ""

  };

}



export function parseJobSheetSizeQty(raw) {

  const s = String(raw ?? "").trim();

  if (!s) return 0;

  const n = Number.parseInt(s, 10);

  return Number.isFinite(n) && n >= 0 ? n : 0;

}



export function sumJobSheetSizes(sizes, extraSizes = [], sizeType = "", gender = "") {

  const columns = getJobSheetActiveColumns({ gender, sizeType });

  let total = columns.reduce((acc, { key }) => acc + parseJobSheetSizeQty(sizes?.[key]), 0);

  if (Array.isArray(extraSizes)) {

    for (const row of extraSizes) {

      total += parseJobSheetSizeQty(row?.qty);

    }

  }

  return total;

}



export function jobSheetSizesToBreakdown(sizes, extraSizes = [], sizeType = "", gender = "") {

  const columns = getJobSheetActiveColumns({ gender, sizeType });

  const out = {};

  for (const { key } of columns) {

    const n = parseJobSheetSizeQty(sizes?.[key]);

    if (n > 0) out[key] = n;

  }

  if (Array.isArray(extraSizes)) {

    for (const row of extraSizes) {

      const label = String(row?.label ?? "").trim().toUpperCase();

      if (!label) continue;

      const n = parseJobSheetSizeQty(row?.qty);

      if (n > 0) out[label] = (out[label] ?? 0) + n;

    }

  }

  return out;

}



export function formatJobSheetOrderId(num) {

  const n = Number.parseInt(String(num), 10);

  if (!Number.isFinite(n) || n < 0) return String(JOB_SHEET_ORDER_ID_START).padStart(4, "0");

  return String(n).padStart(4, "0");

}



export function parseJobSheetOrderIdNumber(raw) {

  const digits = String(raw ?? "").replace(/\D/g, "");

  if (!digits) return null;

  const n = Number.parseInt(digits, 10);

  return Number.isFinite(n) ? n : null;

}



/** Next order id after max existing production job sheet id (floor 0900). */

export function computeNextJobSheetOrderId(existingOrderIds) {

  let max = JOB_SHEET_ORDER_ID_START - 1;

  for (const raw of existingOrderIds ?? []) {

    const n = parseJobSheetOrderIdNumber(raw);

    if (n != null && n > max) max = n;

  }

  return formatJobSheetOrderId(max + 1);

}



export function emptyJobSheetForm() {

  return {

    order_id: "",

    order_date: "",

    sales_incharge_name: "",

    customer_name: "",

    gender: "",

    product_type: "",

    size_type: "",

    rate_per_piece: "",

    total_quantity: "",

    sizes: emptyJobSheetSizesForm(),

    extraSizes: [],

    product_name: "",

    brand: "",

    color: "",

    fabric_type: "",

    branding: "no",

    branding_type: "",

    gsm: "",

    atta: "no",

    comments: "",

    delivery_required_on: ""

  };

}



/** Map saved size_breakdown into job sheet size grid (standard + extra rows). */

export function jobSheetSizeBreakdownToForm(breakdown, sizeType = "", gender = "") {

  const columns = getJobSheetActiveColumns({ gender, sizeType });

  const sizes = emptyJobSheetSizesForm(sizeType, gender);

  const extraSizes = [];

  if (!breakdown || typeof breakdown !== "object") return { sizes, extraSizes };



  const standardKeys = new Set(columns.map(({ key }) => key));

  for (const [key, val] of Object.entries(breakdown)) {

    const n = parseJobSheetSizeQty(val);

    if (n <= 0) continue;

    const normalizedKey = String(key).trim().toUpperCase();

    if (standardKeys.has(normalizedKey)) {

      sizes[normalizedKey] = String(n);

    } else {

      extraSizes.push({

        id: `extra-${normalizedKey}-${Math.random().toString(36).slice(2, 9)}`,

        label: normalizedKey,

        qty: String(n)

      });

    }

  }

  return { sizes, extraSizes };

}



/** Pre-fill job sheet create form from an existing production printing order. */

export function jobSheetFormFromOrder(order, { nextOrderId, orderDate }) {

  const sizeType = String(order?.size_type ?? "").trim();

  const inferred = inferGenderProductTypeFromSizeType(sizeType);

  const { sizes, extraSizes } = jobSheetSizeBreakdownToForm(order?.size_breakdown, sizeType, order?.gender);

  const colorList = Array.isArray(order?.colors) ? order.colors : [];

  const colorText = colorList.map((c) => String(c ?? "").trim()).filter(Boolean).join(", ");

  const qty = Number(order?.qty);

  const rate =

    order?.rate_per_piece != null && order?.rate_per_piece !== ""

      ? String(order.rate_per_piece)

      : "";



  return {

    ...emptyJobSheetForm(),

    order_id: nextOrderId,

    order_date: orderDate,

    sales_incharge_name:

      String(order?.sales_incharge_name ?? order?.coordinator_name ?? "").trim() || "",

    customer_name: String(order?.customer_name ?? "").trim(),

    gender: String(order?.gender ?? inferred.gender ?? "").trim(),

    product_type: String(order?.product_type ?? inferred.productType ?? "").trim(),

    size_type: sizeType,

    rate_per_piece: rate,

    total_quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : "",

    sizes,

    extraSizes,

    product_name: String(order?.product_name ?? "").trim(),

    brand: String(order?.brand ?? "").trim(),

    color: colorText,

    fabric_type: String(order?.fabric_type ?? "").trim(),

    branding: order?.branding ? "yes" : "no",

    branding_type: String(order?.branding_type ?? "").trim(),

    gsm: String(order?.gsm ?? "").trim(),

    atta: order?.atta ? "yes" : "no",

    comments: String(order?.remarks ?? "").trim(),

    delivery_required_on:

      String(order?.due_date ?? order?.expected_handover_to_printing ?? "").trim() || ""

  };

}



/** Pre-fill job sheet form from in-progress create printing order fields. */

export function jobSheetFormFromPrintingOrderForm(form, { nextOrderId, orderDate }) {

  const breakdown = sizesFormToBreakdown(form?.sizes, form?.extraSizes);

  const { sizes, extraSizes } = jobSheetSizeBreakdownToForm(breakdown);

  const colorList = Array.isArray(form?.colors) ? form.colors : [];

  const colorText = colorList.map((c) => String(c ?? "").trim()).filter(Boolean).join(", ");

  const qtyTotal = sumSizeForm(form?.sizes, form?.extraSizes);



  return {

    ...emptyJobSheetForm(),

    order_id: nextOrderId,

    order_date: orderDate,

    sales_incharge_name: String(form?.coordinator_name ?? form?.owner_name ?? "").trim() || "",

    customer_name: String(form?.customer_name ?? "").trim(),

    total_quantity: qtyTotal > 0 ? String(qtyTotal) : "",

    sizes,

    extraSizes,

    product_name: String(form?.product_name ?? "").trim(),

    color: colorText,

    comments: String(form?.remarks ?? "").trim(),

    delivery_required_on: String(form?.expected_handover_to_printing ?? "").trim() || ""

  };

}



export function parseJobSheetRate(raw) {

  const s = String(raw ?? "").trim().replace(",", ".");

  if (!s) return null;

  const n = Number.parseFloat(s);

  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;

}

