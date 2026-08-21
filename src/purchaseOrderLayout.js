/**
 * Purchase Order sheet cell ids from the layout sketch.
 * Do not render these labels in the UI. Fill content later by id.
 *
 * Sketch also marked the large bottom-right block "R21". That clashes with
 * the small top-right R21, so the large block is stored as R21B.
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
  R2: "col-start-1 col-end-2 row-start-5 row-end-7",
  R3: "col-start-1 col-end-2 row-start-7 row-end-9",
  R21B: "col-start-2 col-end-4 row-start-5 row-end-9"
};

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

export { PURCHASE_ORDER_VOUCHER_HEADING, PURCHASE_ORDER_DATED_HEADING, PURCHASE_ORDER_REFERENCE_HEADING } from "./purchaseOrderVoucherUtils";

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


