import { OC_SELECT_FIELDS } from "./outwardChallanUtils";
import { parseOcIdFromQrText } from "./outwardChallanQr";

/** @deprecated use parseOcIdFromQrText */
export function parseOcIdFromScan(raw) {
  const scan = String(raw ?? "").trim();
  if (!scan) return null;
  const fromQr = parseOcIdFromQrText(scan);
  if (fromQr != null) return fromQr;
  const m = scan.match(/^OC0*(\d{1,12})/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function fetchOutwardChallanByScan(client, rawScan) {
  const scan = String(rawScan ?? "").trim();
  if (!scan) {
    return { record: null, error: "No barcode scanned." };
  }

  const ocId = parseOcIdFromQrText(scan);
  if (ocId != null) {
    const { data: byId, error: err0 } = await client
      .from("outward_challans")
      .select(OC_SELECT_FIELDS)
      .eq("id", ocId)
      .maybeSingle();
    if (err0) return { record: null, error: err0.message };
    if (byId) return { record: byId, error: null };
  }

  const { data: byBarcode, error: err1 } = await client
    .from("outward_challans")
    .select(OC_SELECT_FIELDS)
    .eq("barcode_value", scan)
    .maybeSingle();
  if (err1) return { record: null, error: err1.message };
  if (byBarcode) return { record: byBarcode, error: null };

  const { data: byQrPayload, error: err2 } = await client
    .from("outward_challans")
    .select(OC_SELECT_FIELDS)
    .filter("barcode_payload->>qr_value", "eq", scan)
    .maybeSingle();
  if (err2) return { record: null, error: err2.message };
  if (byQrPayload) return { record: byQrPayload, error: null };

  const { data: byScanPayload, error: err3 } = await client
    .from("outward_challans")
    .select(OC_SELECT_FIELDS)
    .filter("barcode_payload->>scan_value", "eq", scan)
    .maybeSingle();
  if (err3) return { record: null, error: err3.message };
  if (byScanPayload) return { record: byScanPayload, error: null };

  return {
    record: null,
    error: "No outward challan found for this barcode."
  };
}
