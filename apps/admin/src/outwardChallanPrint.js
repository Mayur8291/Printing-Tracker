import {
  buildOcBarcodeCaptionLine,
  buildOcBarcodeValue
} from "./outwardChallanBarcode";
import { buildOcLabelRows, renderOcBrandHeaderHtml } from "./outwardChallanUtils";
import { renderCode128BarcodeSvg } from "./inwardGrnBarcode";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const OUTWARD_OC_LABEL_STYLES = `
  @page {
    size: 4in 6in;
    margin: 0.1in;
  }
  * { box-sizing: border-box; }
  html, body {
    width: 4in;
    min-height: 6in;
    margin: 0;
    padding: 0.1in;
    font-family: Helvetica, Arial, sans-serif;
    color: #0f172a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .oc-label-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
  }
  .oc-label-brand img {
    width: 32px;
    height: 32px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .oc-label-brand-name {
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: #0f172a;
    line-height: 1.2;
  }
  .oc-label-title {
    margin: 0 0 6px;
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    text-align: center;
  }
  .barcode {
    text-align: center;
    margin: 4px 0;
  }
  .barcode svg {
    display: block;
    margin: 0 auto;
    max-width: 3.5in;
    height: auto;
  }
  .oc-barcode-caption {
    margin: 4px 0 6px;
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    text-align: center;
    letter-spacing: 0.02em;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0;
  }
  th {
    text-align: left;
    padding: 2px 6px 2px 0;
    color: #64748b;
    font-size: 7px;
    font-weight: 600;
    vertical-align: top;
    width: 38%;
  }
  td {
    padding: 2px 0;
    font-size: 7.5px;
    font-weight: 600;
    vertical-align: top;
    word-break: break-word;
  }
`;

async function buildOcPrintLabelHtml(record) {
  const rows = buildOcLabelRows(record);
  const detailsHtml = rows
    .map(
      (row) =>
        `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(String(row.value))}</td></tr>`
    )
    .join("");
  const brandHtml = renderOcBrandHeaderHtml();
  const barcodeValue = buildOcBarcodeValue(record);
  const barcodeSvg = renderCode128BarcodeSvg(barcodeValue);
  const caption = escapeHtml(buildOcBarcodeCaptionLine(record));
  const barcodeBlock = barcodeSvg
    ? `<div class="barcode">${barcodeSvg}<p class="oc-barcode-caption">${caption}</p></div>`
    : `<p class="oc-barcode-caption">${caption}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${caption}</title>
    <style>${OUTWARD_OC_LABEL_STYLES}</style></head>
    <body>
      ${brandHtml}
      <p class="oc-label-title">Outward challan</p>
      ${barcodeBlock}
      <table>${detailsHtml}</table>
      <script>window.onload=function(){window.focus();window.print()}</script>
    </body></html>`;
}

export async function openOutwardChallanPrintWindow(record) {
  const html = await buildOcPrintLabelHtml(record);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const printWin = window.open(blobUrl, "_blank");
  if (!printWin) {
    URL.revokeObjectURL(blobUrl);
    alert("Pop-up blocked. Allow pop-ups to print the label.");
    return false;
  }
  printWin.addEventListener("load", () => URL.revokeObjectURL(blobUrl), { once: true });
  return true;
}

export async function printOutwardChallanLabel(record) {
  return openOutwardChallanPrintWindow(record);
}
