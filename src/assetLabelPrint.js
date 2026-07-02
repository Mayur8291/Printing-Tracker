import {
  buildAssetTagBarcodeValue,
  buildAssetTagCaptionLine,
  renderAssetLabelBarcodeSvg
} from "./assetLabelBarcode";
import { buildAssetLabelLines, DEFAULT_ASSET_LABEL_SETTINGS } from "./assetLabelSettings";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ASSET_LABEL_STYLES = `
  @page {
    size: 4cm 6cm;
    margin: 2mm;
  }
  * { box-sizing: border-box; }
  html, body {
    width: 4cm;
    min-height: 6cm;
    margin: 0;
    padding: 2mm;
    font-family: Helvetica, Arial, sans-serif;
    color: #0f172a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .asset-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    min-height: calc(6cm - 4mm);
    text-align: center;
  }
  .asset-label-above-1 {
    margin: 0 0 2mm;
    font-size: 7px;
    font-weight: 700;
    line-height: 1.2;
    max-width: 100%;
    word-break: break-word;
  }
  .asset-label-above-2 {
    margin: 0 0 2mm;
    font-size: 6px;
    font-weight: 600;
    color: #475467;
    line-height: 1.25;
    max-width: 100%;
    word-break: break-word;
  }
  .barcode {
    width: 100%;
    margin: 1mm 0;
    text-align: center;
  }
  .barcode svg {
    display: block;
    margin: 0 auto;
    max-width: 3.4cm;
    height: auto;
  }
  .asset-label-below-1 {
    margin: 1mm 0 0;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .asset-label-below-2 {
    margin: 2mm 0 0;
    font-size: 6px;
    font-weight: 600;
    color: #64748b;
    line-height: 1.2;
    max-width: 100%;
    word-break: break-word;
  }
`;

function lineHtml(className, text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return `<p class="${className}">${escapeHtml(value)}</p>`;
}

export function buildAssetLabelPrintHtml(label = {}, labelSettings = DEFAULT_ASSET_LABEL_SETTINGS) {
  const asset = {
    tag: label.tag,
    name: label.name,
    cat: label.category ?? label.cat,
    serial: label.serial,
    maker: label.manufacturer ?? label.maker,
    location: label.location,
    assignee: label.assignee
  };
  const lines = buildAssetLabelLines(asset, labelSettings);
  const barcodeValue = buildAssetTagBarcodeValue(asset.tag);
  const barcodeSvg = renderAssetLabelBarcodeSvg(asset.tag, { variant: "print" });
  const title = escapeHtml(buildAssetTagCaptionLine(asset.tag));

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${title}</title>
    <style>${ASSET_LABEL_STYLES}</style></head>
    <body>
      <div class="asset-label">
        ${lineHtml("asset-label-above-1", lines.aboveLine1)}
        ${lineHtml("asset-label-above-2", lines.aboveLine2)}
        <div class="barcode">${barcodeSvg}</div>
        ${lineHtml("asset-label-below-1", lines.belowLine1)}
        ${lineHtml("asset-label-below-2", lines.belowLine2)}
      </div>
      <script>window.onload=function(){window.focus();window.print()}</script>
    </body></html>`;
}

export async function printAssetLabel(label = {}, labelSettings = DEFAULT_ASSET_LABEL_SETTINGS) {
  const html = buildAssetLabelPrintHtml(label, labelSettings);
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
