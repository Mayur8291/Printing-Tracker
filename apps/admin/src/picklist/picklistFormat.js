const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** @param {import('./picklistTypes.js').PicklistData['createdAt']} createdAt */
export function formatPicklistCreatedAt(createdAt) {
  const d = toDate(createdAt);
  if (!d) return "—";
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** @param {string|Date} pickupDate */
export function formatPickupDate(pickupDate) {
  const d = toDate(pickupDate);
  if (!d) return "—";
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${yy}`;
}

/** @param {import('./picklistTypes.js').PicklistItem[]} items */
export function deriveTotalItems(items) {
  return (items ?? []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function displayComment(comment) {
  const text = String(comment ?? "").trim();
  return text || "-";
}

/** Shelf/bin for picklist — never leave column visually blank. */
export function displayShelfCode(shelfCode) {
  const text = String(shelfCode ?? "").trim();
  return text || "—";
}

/**
 * Fix legacy picklist rows where shelf was sent in comment (item_code).
 * @param {{ shelf_code?: string, comment?: string|null, [key: string]: unknown }} item
 */
export function normalizePicklistLineFields(item) {
  let shelf = String(item.shelf_code ?? "").trim();
  let comment = item.comment == null ? "" : String(item.comment).trim();

  if ((!shelf || shelf === "—") && comment) {
    shelf = comment;
    comment = "";
  }

  return {
    shelfCode: displayShelfCode(shelf),
    comment: comment || null
  };
}
