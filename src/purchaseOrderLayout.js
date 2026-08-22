/**
 * Purchase Order sheet cell ids from the layout sketch.
 * Do not render these labels in the UI. Fill content later by id.
 *
 * Sketch also marked the large bottom-right block "R21". That clashes with
 * the small top-right R21, so the large block is stored as R21B.
 *
 * Second table (below): C1–C8 / C11–C81 (extra line rows on hover +) /
 * C12–C82 / long C13 / print-only C23 (signature). Amount in words reads C82.
 * Do not render those labels.
 */
export const PURCHASE_ORDER_CELL_IDS = [
  "R1",
  "R11",
  "R12",
  "R21",
  "R22",
  "R31",
  "R32",
  "R41",
  "R42",
  "R2",
  "R3",
  "R21B"
];

export const PURCHASE_ORDER_TOP_CELL_IDS = PURCHASE_ORDER_CELL_IDS.filter(
  (id) => id !== "R2" && id !== "R3" && id !== "R21B"
);

/** Right 4×2 beside R1. Own grid — do not share rows with R2/R3. */
export const PURCHASE_ORDER_VOUCHER_CELL_IDS = [
  "R11",
  "R12",
  "R21",
  "R22",
  "R31",
  "R32",
  "R41",
  "R42"
];

export const PURCHASE_ORDER_C_HEADER_IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];

/** First goods line. Extra hover-inserted lines reuse these cols; ids stay in data-po-cell only. */
export const PURCHASE_ORDER_C_LINE_IDS = ["C11", "C21", "C31", "C41", "C51", "C61", "C71", "C81"];

export const PURCHASE_ORDER_C_TOTAL_IDS = ["C12", "C22", "C32", "C42", "C52", "C62", "C72", "C82"];

export const PURCHASE_ORDER_C_BASE_LINE_KEY = "base";

export const PURCHASE_ORDER_C_MAX_EXTRA_LINES = 8;

export const PURCHASE_ORDER_C_CELL_IDS = [
  ...PURCHASE_ORDER_C_HEADER_IDS,
  ...PURCHASE_ORDER_C_LINE_IDS,
  ...PURCHASE_ORDER_C_TOTAL_IDS,
  "C13",
  "C23"
];

export function purchaseOrderLineCellId(lineKey, colId) {
  return lineKey === PURCHASE_ORDER_C_BASE_LINE_KEY ? colId : `${colId}:${lineKey}`;
}

/** Sl No. column for a goods line. 0-based index → "1.", "2.", … */
export function purchaseOrderSlNoText(lineIndex) {
  return `${lineIndex + 1}.`;
}

/** Description of Goods body cells: C21 and extra C21:L* rows. */
export function isPurchaseOrderDescCell(id) {
  return id === "C21" || String(id).startsWith("C21:");
}

/** Due on body cells: C31 and extra C31:L* rows. */
export function isPurchaseOrderDueCell(id) {
  return id === "C31" || String(id).startsWith("C31:");
}

/** Quantity body cells: C41 and extra C41:L* rows. */
export function isPurchaseOrderQtyCell(id) {
  return id === "C41" || String(id).startsWith("C41:");
}

/** Rate body cells: C51 and extra C51:L* rows. */
export function isPurchaseOrderRateCell(id) {
  return id === "C51" || String(id).startsWith("C51:");
}

/** per body cells: C61 and extra C61:L* rows. */
export function isPurchaseOrderPerCell(id) {
  return id === "C61" || String(id).startsWith("C61:");
}

/** Amount body cells: C81 and extra C81:L* rows. */
export function isPurchaseOrderAmountCell(id) {
  return id === "C81" || String(id).startsWith("C81:");
}

/** Units in the Quantity dropdown. per column copies the pick, never the number. */
export const PURCHASE_ORDER_QTY_UNITS = ["PCS", "Kg", "Mtr", "Nos", "Roll", "Set"];

/** Quantity field: whole digits only. No decimal. */
export function sanitizePurchaseOrderQty(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Rate field: digits and one decimal, at most 2 places (e.g. 450.00). */
export function sanitizePurchaseOrderRate(raw) {
  const text = String(raw ?? "");
  let seenDot = false;
  let decimals = 0;
  let out = "";
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals += 1;
      }
      out += ch;
      continue;
    }
    if (ch === "." && !seenDot) {
      seenDot = true;
      out += ch;
    }
  }
  return out;
}

/** Blur format: 450 → 450.00. Empty stays empty. */
export function formatPurchaseOrderRate(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === ".") return "";
  const n = Number(text);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

/** Amount = Quantity × Rate, 2 decimals. Empty if either side is blank. */
export function formatPurchaseOrderLineAmount(qtyRaw, rateRaw) {
  const qtyText = String(qtyRaw ?? "").trim();
  const rateText = String(rateRaw ?? "").trim();
  if (!qtyText || !rateText || qtyText === "." || rateText === ".") return "";
  const qty = Number(qtyText);
  const rate = Number(rateText);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return "";
  return (qty * rate).toFixed(2);
}

/** Sum of each goods-line Amount. Null if no line has both qty and rate. */
export function sumPurchaseOrderLineAmounts(lineKeys, lineQtys, lineRates) {
  let sum = 0;
  let any = false;
  for (const key of lineKeys || []) {
    const text = formatPurchaseOrderLineAmount(lineQtys?.[key], lineRates?.[key]);
    if (!text) continue;
    const n = Number(text);
    if (!Number.isFinite(n)) continue;
    any = true;
    sum += n;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/** Sum of Quantity column whole numbers. Null if no line has a qty. */
export function sumPurchaseOrderQuantities(lineKeys, lineQtys) {
  let sum = 0;
  let any = false;
  for (const key of lineKeys || []) {
    const text = String(lineQtys?.[key] ?? "").replace(/\D/g, "");
    if (!text) continue;
    const n = Number(text);
    if (!Number.isFinite(n)) continue;
    any = true;
    sum += n;
  }
  return any ? sum : null;
}

/** C42 face: whole-number qty total. Empty until a line has qty. */
export function formatPurchaseOrderC42Display(total) {
  if (total == null || !Number.isFinite(Number(total))) return "";
  return String(Math.trunc(Number(total)));
}

/** C82 face: " ₹ 1000.00" on one line. Empty until there is a total. */
export function formatPurchaseOrderC82Display(total) {
  if (total == null || !Number.isFinite(Number(total))) return "";
  return `\u00A0₹\u00A0${Number(total).toFixed(2)}`;
}

/** 8 cols: col 2 is wide. 4 rows: middle tall, then C12–C82, then long C13. Do not render these ids. */
export const PURCHASE_ORDER_C_CELL_PLACEMENT = {
  C1: "col-start-1 row-start-1",
  C2: "col-start-2 row-start-1",
  C3: "col-start-3 row-start-1",
  C4: "col-start-4 row-start-1",
  C5: "col-start-5 row-start-1",
  C6: "col-start-6 row-start-1",
  C7: "col-start-7 row-start-1",
  C8: "col-start-8 row-start-1",
  C11: "col-start-1 row-start-2",
  C21: "col-start-2 row-start-2",
  C31: "col-start-3 row-start-2",
  C41: "col-start-4 row-start-2",
  C51: "col-start-5 row-start-2",
  C61: "col-start-6 row-start-2",
  C71: "col-start-7 row-start-2",
  C81: "col-start-8 row-start-2",
  C12: "col-start-1 row-start-3",
  C22: "col-start-2 row-start-3",
  C32: "col-start-3 row-start-3",
  C42: "col-start-4 row-start-3",
  C52: "col-start-5 row-start-3",
  C62: "col-start-6 row-start-3",
  C72: "col-start-7 row-start-3",
  C82: "col-start-8 row-start-3",
  C13: "col-start-1 col-end-9 row-start-4",
  C23: "col-start-4 col-end-9"
};

export const PURCHASE_ORDER_CELL_PLACEMENT = {
  R1: "col-start-1 col-end-2 row-start-1 row-end-5",
  R11: "col-start-2 col-end-3 row-start-1 row-end-2",
  R12: "col-start-3 col-end-4 row-start-1 row-end-2",
  R21: "col-start-2 col-end-3 row-start-2 row-end-3",
  R22: "col-start-3 col-end-4 row-start-2 row-end-3",
  R31: "col-start-2 col-end-3 row-start-3 row-end-4",
  R32: "col-start-3 col-end-4 row-start-3 row-end-4",
  R41: "col-start-2 col-end-3 row-start-4 row-end-5",
  R42: "col-start-3 col-end-4 row-start-4 row-end-5",
  R2: "",
  R3: "",
  R21B: "h-full min-h-0"
};

export function purchaseOrderCellPlacement(id) {
  return PURCHASE_ORDER_CELL_PLACEMENT[id] || PURCHASE_ORDER_C_CELL_PLACEMENT[id] || "";
}

/** Invoice block for cell R1. Only `company` is bold in the UI. */
export const PURCHASE_ORDER_R1_INVOICE = {
  heading: "Invoice To",
  company: "SCOTT INTERNATIONAL",
  lines: [
    "No 5/1-1 4th Cross, Nagappa Street, PG Halli, Bangalore-560003",
    "Head Office: Survey No. 64, Harokyathanahalli Village, Dasanapura Hobli, Next to Bhikshu Dham Jain Prayer Hall, Bangalore-562162",
    "Contact No-9886127815/9886127844",
    "GSTIN/UIN: 29AEFFS9902L1ZD",
    "State Name: Karnataka, Code: 29"
  ]
};

/** Consignee block for cell R2. Only `company` is bold in the UI. */
export const PURCHASE_ORDER_R2_CONSIGNEE = {
  heading: "Consignee (Ship to)",
  company: "SCOTT INTERNATIONAL",
  lines: [
    "No 5/1-1 4th Cross, Nagappa Street, PG Halli, Bangalore-560003",
    "Head Office: Survey No. 64, Harokyathanahalli Village, Dasanapura Hobli, Next to Bhikshu Dham Jain Prayer Hall, Bangalore-562162",
    "Contact No-9886127815/9886127844",
    "e-mail: finance.sagarfab@gmail.com",
    "GSTIN/UIN: 29AEFFS9902L1ZD",
    "State Name : Karnataka, Code: 29"
  ]
};

export const PURCHASE_ORDER_R3_HEADING = "Supplier (Bill form)";

export const PURCHASE_ORDER_PAYMENT_HEADING = "Mode/terms of Payment";
export const PURCHASE_ORDER_PAYMENT_VALUE = "30 days";

export const PURCHASE_ORDER_DELIVERY_HEADING = "Terms of Delivery";

export const PURCHASE_ORDER_OTHER_REF_HEADING = "Other References";
export const PURCHASE_ORDER_DISPATCH_HEADING = "Dispatched through";
export const PURCHASE_ORDER_DESTINATION_HEADING = "Destination";

/** R32 / R41 / R42: normal heading, bold typed value, cell grows with words. */
export const PURCHASE_ORDER_GROW_FIELD_HEADINGS = {
  R32: PURCHASE_ORDER_OTHER_REF_HEADING,
  R41: PURCHASE_ORDER_DISPATCH_HEADING,
  R42: PURCHASE_ORDER_DESTINATION_HEADING
};

export const PURCHASE_ORDER_EMPTY_GROW_NOTES = {
  R32: "",
  R41: "",
  R42: ""
};

export { PURCHASE_ORDER_VOUCHER_HEADING, PURCHASE_ORDER_DATED_HEADING, PURCHASE_ORDER_REFERENCE_HEADING } from "./purchaseOrderVoucherUtils";

export const PURCHASE_ORDER_AMOUNT_WORDS_HEADING = "Amount Chargable (in words):";

/** Print-only signature cell C23 (width C42–C82, height R22). Do not show on screen. */
export const PURCHASE_ORDER_C23_FOR_LABEL = "for SCOTT INTERNATIONAL";
export const PURCHASE_ORDER_C23_SIGN_LABEL = "Authorised Signatory";

/** Sheet title above the R/C table. Prints with the sheet. */
export const PURCHASE_ORDER_SHEET_TITLE = "PURCHASE ORDER";

/** C-table titles. Do not render the C1 / C22 ids. */
export const PURCHASE_ORDER_C_HEADINGS = {
  C1: "Sl No.",
  C2: "Description of Goods",
  C3: "Due on",
  C4: "Quantity",
  C5: "Rate",
  C6: "per",
  C7: "Disc %",
  C8: "Amount",
  C22: "Total"
};

/** Stored supplier fields shown under the R3 dropdown. No extra labels. */
export function purchaseOrderSupplierDetailLines(supplier) {
  if (!supplier) return [];
  return [
    supplier.address,
    supplier.contact,
    supplier.gstin,
    [supplier.city, supplier.country].filter(Boolean).join(", "),
    supplier.paymentTerms
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}


