/** Lightweight columns for tables, filters, and tabs — excludes heavy image URL blobs. */
export const ORDERS_LIST_SELECT =
  "id, order_id, order_kind, order_date, due_date, owner_name, customer_name, coordinator_name, sales_incharge_name, qty, size_breakdown, product_name, colors, printing_mtrs, status, status_ready_at, remarks, created_at, created_by, is_complete, is_production_order, expected_handover_to_printing, received_at_printing, payment_method, delivery_method, dispatch_sizes_verified, dispatch_sizes_qty_ok, dispatch_product_name_ok, dispatch_colors_ok, dispatch_issue_type, dispatch_verification_failed, dispatch_verified_at, dispatch_verified_by, order_cost, printing_cost, size_type, gender, product_type, rate_per_piece, brand, fabric_type, branding, branding_type, gsm, atta, invoice_url, post_approved_design_review_status, post_approved_design_reviewed_by, post_approved_design_reviewed_at, job_sheet_payment_mode, job_sheet_advance_amount, job_sheet_advance_payment_date, job_sheet_advance_proof_url, job_sheet_balance_amount, job_sheet_pending_amount, job_sheet_full_paid, job_sheet_payment_closure_at, job_sheet_payment_proof_url, job_sheet_delivery_city, job_sheet_transport_charges, job_sheet_approval_date, job_sheet_approval_image_url, job_sheet_approved_by, job_sheet_regular_stock, job_sheet_regular_stock_items";

/** Full row including design assets — use for order detail and image workflows. */
export const ORDERS_FULL_SELECT = `${ORDERS_LIST_SELECT}, approved_design_url, approved_design_images, approved_design_images_archive, post_approved_design_changes_note, payment_screenshot_url`;

export function orderNeedsDetailHydration(order) {
  if (!order?.id || order._isPending) return false;
  return (
    order.approved_design_url === undefined &&
    order.approved_design_images === undefined &&
    order.payment_screenshot_url === undefined
  );
}
