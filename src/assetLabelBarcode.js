import JsBarcode from "jsbarcode";

function trimField(value) {
  return String(value ?? "").trim();
}

/** Scannable CODE128 payload — the asset tag (e.g. IT-04823). */
export function buildAssetTagBarcodeValue(tag) {
  return trimField(tag) || "IT-00000";
}

/** Human-readable line printed below the barcode bars. */
export function buildAssetTagCaptionLine(tag) {
  return buildAssetTagBarcodeValue(tag);
}

/**
 * Renders a CODE128 SVG for asset tags.
 * `variant`: "preview" (UI) or "print" (4×6 cm label).
 */
export function renderAssetLabelBarcodeSvg(tag, { variant = "preview" } = {}) {
  const scan = buildAssetTagBarcodeValue(tag);
  if (!scan || typeof document === "undefined") return "";

  const isPrint = variant === "print";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, scan, {
    format: "CODE128",
    width: isPrint ? 0.9 : 1.1,
    height: isPrint ? 28 : 48,
    displayValue: false,
    margin: isPrint ? 1 : 6
  });
  return new XMLSerializer().serializeToString(svg);
}
