/** Labels for order_activity_log.event_type (printing + job sheet). */

import { isJobSheetOrder } from "./jobSheetUtils";

export const ORDER_HISTORY_EVENT_LABELS = {
  order_created: "Job created",
  job_sheet_created: "Job sheet created",
  mockups_uploaded: "Mockups uploaded",
  status_changed: "Status update",
  marked_complete: "Completed",
  design_images_uploaded: "Design images uploaded",
  design_resubmitted: "Designs resubmitted",
  design_images_updated: "Design images updated",
  design_approved: "Design approved",
  design_changes_requested: "Changes requested",
  design_pending_review: "Awaiting review",
  design_changes_note_updated: "Changes note",
  remarks_updated: "Remarks",
  qty_updated: "Quantity",
  due_date_updated: "Delivery date",
  coordinator_updated: "Coordinator",
  sales_incharge_updated: "Sales incharge",
  printing_mtrs_updated: "Printing metres",
  received_at_printing_updated: "Received at printing",
  product_name_updated: "Product name",
  colors_updated: "Colors",
  size_type_updated: "Size type",
  gender_updated: "Gender",
  product_type_updated: "Product type",
  rate_per_piece_updated: "Rate per piece",
  size_breakdown_updated: "Size breakdown",
  brand_updated: "Brand",
  fabric_type_updated: "Fabric type",
  gsm_updated: "GSM",
  branding_updated: "Branding",
  atta_updated: "Atta",
  expected_handover_updated: "Handover to printing",
  job_sheet_payment_updated: "Payment",
  job_sheet_advance_proof_uploaded: "Advance proof uploaded",
  job_sheet_payment_proof_uploaded: "Payment proof uploaded",
  job_sheet_delivery_updated: "Delivery",
  job_sheet_approval_updated: "Approval",
  job_sheet_regular_stock_updated: "Regular stock"
};

export function getOrderHistoryTitle(order) {
  return isJobSheetOrder(order) ? "Job sheet history" : "Order history";
}

export function getOrderHistoryButtonLabel(order) {
  return isJobSheetOrder(order) ? "Job sheet history" : "Order history";
}

export function getOrderHistoryEventLabel(eventType, order) {
  if (eventType === "order_created" && isJobSheetOrder(order)) {
    return "Job sheet created";
  }
  return ORDER_HISTORY_EVENT_LABELS[eventType] ?? eventType;
}
