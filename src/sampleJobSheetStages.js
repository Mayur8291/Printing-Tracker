/** Sampling Tracker job-sheet pipeline (sample_job_sheet). */

export const SAMPLE_JOB_SHEET_INITIAL_STATUS = "pattern_making";

export const SAMPLE_JOB_SHEET_COMPLETE_STATUS = "dispatched_successfully";

export const SAMPLE_JOB_SHEET_STAGES = [
  "pattern_making",
  "sample_cutting",
  "sample_stitching",
  "trim_iron",
  "branding",
  "qc",
  "packaging",
  "ready",
  "dispatched_successfully"
];

export const SAMPLE_JOB_SHEET_STAGE_LABEL = {
  pattern_making: "Pattern Making",
  sample_cutting: "Sample Cutting",
  sample_stitching: "Sample Stitching",
  trim_iron: "Trim + Iron",
  branding: "Branding",
  qc: "QC",
  packaging: "Packaging",
  ready: "Ready to Dispatch",
  dispatched_successfully: "Dispatched Successfully"
};

export const SAMPLE_JOB_SHEET_STAGE_ICON = {
  pattern_making: "📐",
  sample_cutting: "✂️",
  sample_stitching: "🧵",
  trim_iron: "/icons/ironing.png",
  branding: "🏷️",
  qc: "🔎",
  packaging: "📦",
  ready: "✅",
  dispatched_successfully: "📤"
};

export function sampleJobSheetStageLabel(status) {
  const key = String(status ?? "").trim();
  if (!key) return "—";
  return SAMPLE_JOB_SHEET_STAGE_LABEL[key] ?? key;
}

export function sampleJobSheetIsClosed(order) {
  if (!order) return false;
  return (
    Boolean(order.is_complete) ||
    String(order.status ?? "").trim() === SAMPLE_JOB_SHEET_COMPLETE_STATUS
  );
}

export function sampleJobSheetDisplayStatus(order, fallbackStatus) {
  if (sampleJobSheetIsClosed(order)) return SAMPLE_JOB_SHEET_COMPLETE_STATUS;
  const key = String(fallbackStatus ?? order?.status ?? "").trim();
  return key || SAMPLE_JOB_SHEET_INITIAL_STATUS;
}

/** Status dropdown options for a sample job sheet, including leftover status if not in pipeline. */
export function sampleJobSheetStatusOptions(currentStatus) {
  const stages = [...SAMPLE_JOB_SHEET_STAGES];
  const current = String(currentStatus ?? "").trim();
  if (current && !stages.includes(current)) {
    stages.unshift(current);
  }
  return stages;
}
