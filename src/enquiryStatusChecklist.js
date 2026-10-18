/**
 * Per-status checklist shown before Update status.
 * Empty until product supplies items (next prompt).
 *
 * Shape:
 * {
 *   in_progress: [{ id: "called", label: "Called the customer" }],
 *   resolved: [{ id: "closed_loop", label: "Customer confirmed" }]
 * }
 */
export const ENQUIRY_STATUS_CHECKLISTS = {};

export function checklistItemsForEnquiryStatus(status) {
  const items = ENQUIRY_STATUS_CHECKLISTS[String(status ?? "")];
  return Array.isArray(items) ? items : [];
}

export function enquiryStatusNeedsChecklist(status) {
  return checklistItemsForEnquiryStatus(status).length > 0;
}
