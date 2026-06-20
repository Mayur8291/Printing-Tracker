import { STAGE_LABEL } from "./orderViewUtils";

export const STICKER_ASSET_ACCEPT =
  ".png,.pdf,.jpeg,.jpg,.ai,.cdr,.psd,image/png,image/jpeg,application/pdf";

const STICKER_ASSET_EXTENSIONS = new Set(["png", "pdf", "jpeg", "jpg", "ai", "cdr", "psd"]);

export const STICKER_STAGES = ["pending", "printing", "ready"];

export const STICKER_STAGE_LABEL = {
  pending: "Pending",
  printing: "Processing",
  ready: "Ready to Dispatch"
};

export function isStickerOrder(order) {
  return (order?.order_kind ?? "printing") === "sticker";
}

export function isAllowedStickerAsset(file) {
  if (!file?.name) return false;
  const ext = String(file.name).split(".").pop()?.toLowerCase();
  return Boolean(ext && STICKER_ASSET_EXTENSIONS.has(ext));
}

export function formatStickerQtyDisplay(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return "Applicable";
  return String(n);
}

export function formatStickerSizeDisplay(sizeValue) {
  const text = String(sizeValue ?? "").trim();
  if (!text || text === "Applicable") return "Applicable";
  return text;
}

export function stickerStageLabel(status) {
  return STICKER_STAGE_LABEL[status] ?? null;
}

export function stageLabelForOrder(order, status) {
  if (isStickerOrder(order)) {
    return STICKER_STAGE_LABEL[status] ?? STAGE_LABEL[status] ?? status ?? "—";
  }
  return STAGE_LABEL[status] ?? status ?? "—";
}

export function stickerStatusOptions(isAdmin) {
  return isAdmin ? null : STICKER_STAGES;
}

export const emptyStickerOrderForm = () => ({
  customer_name: "",
  qty: "",
  size: "",
  due_date: ""
});
