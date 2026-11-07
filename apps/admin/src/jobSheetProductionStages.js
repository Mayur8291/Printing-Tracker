/** Garment production pipeline for job sheets (Production tracker). */

export const JOB_SHEET_PRODUCTION_STAGES = [
  "quotation_approval",
  "sampling",
  "sourcing",
  "sourcing_in_transit",
  "inward",
  "cutting",
  "stitching",
  "trimming",
  "ironing",
  "qc",
  "packing",
  "ready"
];

export const JOB_SHEET_PRODUCTION_STAGE_LABEL = {
  quotation_approval: "Quotation approval",
  sampling: "Sampling",
  sourcing: "Sourcing",
  sourcing_in_transit: "Sourcing in transit",
  inward: "Inward",
  cutting: "Cutting",
  stitching: "Stitching",
  trimming: "Trimming",
  ironing: "Ironing",
  qc: "QC",
  packing: "Packing",
  ready: "Ready to Dispatch",
  /** Legacy rows created before production stages existed. */
  new: "Quotation approval"
};

export const JOB_SHEET_PRODUCTION_STAGE_ICON = {
  quotation_approval: "📋",
  sampling: "🧪",
  sourcing: "🔍",
  sourcing_in_transit: "🚛",
  inward: "📥",
  cutting: "✂️",
  stitching: "🧵",
  trimming: "✨",
  ironing: "/icons/ironing.png",
  qc: "🔎",
  packing: "📦",
  ready: "✅",
  new: "📋"
};

export function jobSheetProductionStageLabel(status) {
  const key = String(status ?? "").trim();
  if (!key) return "—";
  return JOB_SHEET_PRODUCTION_STAGE_LABEL[key] ?? key;
}

/** Status dropdown options for a job sheet, including legacy status if not in pipeline. */
export function jobSheetProductionStatusOptions(currentStatus) {
  const stages = [...JOB_SHEET_PRODUCTION_STAGES];
  const current = String(currentStatus ?? "").trim();
  if (current && !stages.includes(current)) {
    stages.unshift(current);
  }
  return stages;
}
