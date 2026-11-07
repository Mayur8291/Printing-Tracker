import { buildProductQtyBarcodeValue } from "./inwardGrnBarcode";

function trimField(value) {
  return String(value ?? "").trim();
}

/** Scanned text shows product name and qty (same format as inward GRN). */
export function buildOcBarcodeValue(record) {
  return buildProductQtyBarcodeValue(record?.product_material, record?.quantity);
}

/** OC number shown directly below the barcode on the printed label. */
export function buildOcBarcodeCaptionLine(record) {
  const id = record?.id;
  return id != null ? `OC #: ${id}` : "OC #: —";
}
