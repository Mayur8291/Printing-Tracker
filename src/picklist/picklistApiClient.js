import { normalizePicklistLineFields } from "./picklistFormat.js";

/** Shown when Vite proxy cannot reach the local picklist API (port 3001). */
export const PICKLIST_API_DEV_HINT =
  "Picklist PDF server is not running. Stop dev and restart with: npm run dev (starts Vite + picklist API on port 3001).";

/**
 * Map Scott order picklist API response → PicklistData contract.
 * @param {Record<string, unknown>} api
 * @returns {import('./picklistTypes.js').PicklistData}
 */
export function mapScottOrderToPicklistData(api) {
  const createdAt = api.picklist_generated_at || new Date().toISOString();
  const pickupBase = createdAt;

  return {
    picklistNo: String(api.picklist_no ?? "").trim(),
    createdAt,
    items: (api.items ?? []).map((item) => {
      const { shelfCode, comment } = normalizePicklistLineFields(item);
      return {
        slNo: Number(item.line_no) || 0,
        skuCode: String(item.sku_code ?? ""),
        skuName: String(item.sku_name ?? item.sku_code ?? ""),
        shelfCode,
        comment,
        pickupDate: item.pick_update || pickupBase,
        qty: Number(item.quantity) || 0
      };
    }),
    orders: [
      {
        saleOrderNumber: String(api.order_code ?? ""),
        customerName: String(api.customer_name ?? "")
      }
    ]
  };
}

/**
 * @param {import('./picklistTypes.js').PicklistData} data
 * @returns {Promise<Blob>}
 */
export async function fetchPicklistPdfBlob(data) {
  let res;
  try {
    res = await fetch("/api/picklist/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch {
    throw new Error(PICKLIST_API_DEV_HINT);
  }
  if (!res.ok) {
    let message = `PDF request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      if (res.status >= 500) message = PICKLIST_API_DEV_HINT;
    }
    if (res.status >= 500 && message.startsWith("PDF request failed")) {
      message = PICKLIST_API_DEV_HINT;
    }
    throw new Error(message);
  }
  return res.blob();
}

/**
 * Open generated PDF in a new tab and trigger download.
 * @param {import('./picklistTypes.js').PicklistData} data
 */
export async function openPicklistPdf(data) {
  const blob = await fetchPicklistPdfBlob(data);
  const url = URL.createObjectURL(blob);
  const filename = `${data.picklistNo}.pdf`;

  const tab = window.open(url, "_blank");
  if (!tab) {
    URL.revokeObjectURL(url);
    alert("Pop-up blocked. Allow pop-ups to open the picklist PDF.");
    return false;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  tab.addEventListener(
    "load",
    () => {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    { once: true }
  );

  return true;
}
