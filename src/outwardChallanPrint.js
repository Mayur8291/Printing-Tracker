import {
  buildOcLabelRows,
  OC_PRINT_LABEL_STYLES,
  renderOcBrandHeaderHtml
} from "./outwardChallanUtils";
import { buildOcQrValue, renderOcQrDataUrl } from "./outwardChallanQr";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildOcPrintLabelHtml(record, qrDataUrl) {
  const rows = buildOcLabelRows(record);
  const detailsHtml = rows
    .map(
      (row) =>
        `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(String(row.value))}</td></tr>`
    )
    .join("");
  const brandHtml = renderOcBrandHeaderHtml();
  const ocId = escapeHtml(String(record.id ?? ""));
  const qrImg = qrDataUrl
    ? `<img class="oc-print-qr" src="${qrDataUrl}" alt="OC QR code" width="200" height="200" />`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>OC label #${ocId}</title>
    <style>${OC_PRINT_LABEL_STYLES}
      .oc-print-qr{display:block;margin:0 auto 8px}
    </style></head>
    <body>
      ${brandHtml}
      <p class="oc-print-subtitle">Outward challan</p>
      <div class="barcode">${qrImg}</div>
      <table>${detailsHtml}</table>
      <script>window.onload=function(){window.focus();window.print()}</script>
    </body></html>`;
}

export async function openOutwardChallanPrintWindow(record) {
  const qrDataUrl = await renderOcQrDataUrl(buildOcQrValue(record));
  const html = await buildOcPrintLabelHtml(record, qrDataUrl);
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
