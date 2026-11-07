import QRCode from "qrcode";
import { buildOcQrText } from "./outwardChallanUtils";

/** QR encodes full challan as plain text (works on any phone camera app). */
export function buildOcQrValue(record) {
  return buildOcQrText(record);
}

export function parseOcIdFromQrText(raw) {
  const scan = String(raw ?? "").trim();
  if (!scan) return null;

  const hashInUrl = scan.match(/#oc=(\d+)/i) ?? scan.match(/^oc=(\d+)$/i);
  if (hashInUrl) return Number(hashInUrl[1]);

  const ocLabel = scan.match(/OC\s*#\s*:?\s*(\d+)/i);
  if (ocLabel) return Number(ocLabel[1]);

  try {
    const parsed = JSON.parse(scan);
    if (parsed?.type === "oc" && parsed.id != null) return Number(parsed.id);
  } catch {
    /* not JSON */
  }

  const compact = scan.match(/^OC0*(\d{1,12})/i);
  if (compact) {
    const id = Number(compact[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  return null;
}

export async function renderOcQrDataUrl(text, size = 220) {
  if (!text) return "";
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "L",
    color: { dark: "#0f172a", light: "#ffffff" }
  });
}
