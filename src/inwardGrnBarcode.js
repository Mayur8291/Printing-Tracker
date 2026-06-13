import JsBarcode from "jsbarcode";

function trimField(value) {
  return String(value ?? "").trim();
}

export function sanitizeProductForBarcode(value, maxLen = 28) {
  return trimField(value).replace(/,/g, " ").slice(0, maxLen) || "Product";
}

export function sanitizeQtyForBarcode(value) {
  const qty = trimField(value).replace(/[^0-9.]/g, "");
  return qty || "0";
}

export function buildProductQtyBarcodeValue(productMaterial, qtyValue) {
  const product = sanitizeProductForBarcode(productMaterial);
  const qty = sanitizeQtyForBarcode(qtyValue);
  return `${product}, Qty ${qty}`;
}

/**
 * Scanned text shows product name and qty (e.g. "Cotton Shirt, Qty 500").
 * Kept compact — product trimmed, qty digits only.
 */
export function buildInwardGrnBarcodeValue(grnRecord, inwardRecord) {
  return buildProductQtyBarcodeValue(
    inwardRecord?.product_material,
    grnRecord?.qty_received
  );
}

/** GRN number shown directly below the barcode on the printed label. */
export function buildInwardGrnBarcodeGrnLine(grnRecord) {
  const grnNo = trimField(grnRecord?.grn_no);
  return grnNo ? `GRN NO.: ${grnNo}` : "GRN NO.: —";
}

/** Renders CODE128 barcode; bars only (scan text shown in caption). */
export function renderCode128BarcodeSvg(value) {
  const scan = String(value ?? "").trim();
  if (!scan || typeof document === "undefined") return "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, scan, {
    format: "CODE128",
    width: 1.2,
    height: 52,
    displayValue: false,
    margin: 8
  });
  return new XMLSerializer().serializeToString(svg);
}

export const renderInwardGrnBarcodeSvg = renderCode128BarcodeSvg;
