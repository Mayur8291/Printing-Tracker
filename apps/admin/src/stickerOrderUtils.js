import { STAGE_LABEL } from "./orderViewUtils";
import { isJobSheetOrder } from "./jobSheetUtils";
import { isSampleJobSheetOrder } from "./sampleJobSheetUtils";
import {
  jobSheetProductionStageLabel,
  JOB_SHEET_PRODUCTION_STAGE_ICON
} from "./jobSheetProductionStages";
import {
  sampleJobSheetStageLabel,
  SAMPLE_JOB_SHEET_STAGE_ICON
} from "./sampleJobSheetStages";

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

export function isSamplingOrder(order) {
  return (order?.order_kind ?? "printing") === "sampling";
}

export function isCompactPrintingOrder(order) {
  return isStickerOrder(order) || isSamplingOrder(order);
}

export function compactPrintingOrderLabel(order) {
  if (isStickerOrder(order)) return "Sticker order";
  if (isSamplingOrder(order)) return "Sampling order";
  return null;
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
  if (isSampleJobSheetOrder(order)) {
    return sampleJobSheetStageLabel(status);
  }
  if (isJobSheetOrder(order)) {
    return jobSheetProductionStageLabel(status);
  }
  if (isCompactPrintingOrder(order)) {
    return STICKER_STAGE_LABEL[status] ?? STAGE_LABEL[status] ?? status ?? "—";
  }
  return STAGE_LABEL[status] ?? status ?? "—";
}

export function stageIconForOrder(order, status) {
  if (isSampleJobSheetOrder(order)) {
    return SAMPLE_JOB_SHEET_STAGE_ICON[status] ?? SAMPLE_JOB_SHEET_STAGE_ICON.pattern_making;
  }
  if (isJobSheetOrder(order)) {
    return JOB_SHEET_PRODUCTION_STAGE_ICON[status] ?? JOB_SHEET_PRODUCTION_STAGE_ICON.new;
  }
  return null;
}

export function stickerStatusOptions(isAdmin) {
  return isAdmin ? null : STICKER_STAGES;
}

export const compactPrintingStatusOptions = stickerStatusOptions;

export const emptyStickerOrderForm = () => ({
  customer_name: "",
  qty: "",
  size: "",
  due_date: ""
});
