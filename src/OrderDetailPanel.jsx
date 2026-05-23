import { useEffect, useState } from "react";
import {
  EDITABLE_FIELD_OPTIONS,
  POST_DESIGN_REVIEW,
  FORM_STAGES,
  STAGE_LABEL,
  STAGE_OPTION_ICON,
  effectivePostDesignReviewStatus,
  formatDeliveryDate,
  formatReceivedAtDisplay,
  formatSizeBreakdownSummary,
  parseDesignUrls,
  receivedAtToDatetimeLocalValue
} from "./orderViewUtils";
import {
  PAYMENT_METHODS,
  deliveryMethodLabel,
  parsePaymentProofUrls,
  paymentMethodLabel,
  paymentMethodRequiresProof
} from "./orderTabUtils";
import { supabase } from "./supabaseClient";
import {
  customerAssetPublicUrl,
  fetchOrderCustomerAssets,
  formatCustomerAssetExpiry
} from "./orderCustomerAssets";

function DetailField({ label, children, wide }) {
  return (
    <div className={wide ? "order-detail-field order-detail-field--wide" : "order-detail-field"}>
      <span className="order-detail-field-label">{label}</span>
      <div className="order-detail-field-value">{children}</div>
    </div>
  );
}

export default function OrderDetailPanel({
  order,
  onClose,
  profileLoading,
  profileError,
  isAdmin,
  isSalesReviewer,
  canUseOrderControls,
  viewerMayUpdateOrders,
  canCurrentUserEdit,
  coordinators,
  statusUpdates,
  remarksUpdates,
  qtyUpdates,
  dueDateUpdates,
  printingMtrsUpdates,
  coordinatorUpdates,
  receivedAtPrintingUpdates,
  setCoordinatorUpdates,
  setQtyUpdates,
  setDueDateUpdates,
  setRemarksUpdates,
  setPrintingMtrsUpdates,
  setReceivedAtPrintingUpdates,
  designReviewNoteOpen,
  designReviewNoteDrafts,
  setDesignReviewNoteDrafts,
  setDesignReviewNoteOpen,
  savingDesignReviewOrderId,
  uploadingPostDesignOrderId,
  archivingPostDesignOrderId,
  persistOrderStatus,
  handleViewerUpdate,
  handleAppendPostApprovedDesignImages,
  handleAppendPaymentProof,
  handleUpdatePaymentMethod,
  uploadingPaymentProofOrderId,
  handleArchiveApprovedDesignImages,
  handleApprovePostDesign,
  openPostDesignChangesInput,
  handleSubmitPostDesignChanges,
  openOrderHistory,
  handleMarkComplete,
  handleDeleteOrder,
  openPreview,
  renderStageIcon,
  OrderColorsCell
}) {
  const postUrls = parseDesignUrls(order.approved_design_images);
  const mockupUrls = parseDesignUrls(order.approved_design_url);
  const reviewStatus = effectivePostDesignReviewStatus(order);
  const changesNote = (order.post_approved_design_changes_note ?? "").trim();
  const showChangesInput = Boolean(designReviewNoteOpen[order.id]);
  const isSavingReview = savingDesignReviewOrderId === order.id;
  const canReplaceDesigns =
    reviewStatus === POST_DESIGN_REVIEW.NEEDS_CHANGES &&
    canCurrentUserEdit("approved_design_images");
  const isArchivingDesigns = archivingPostDesignOrderId === order.id;
  const isUploadingDesigns = uploadingPostDesignOrderId === order.id;
  const isUploadingPaymentProof = uploadingPaymentProofOrderId === order.id;
  const designActionsBusy = isArchivingDesigns || isUploadingDesigns;
  const paymentProofUrls = parsePaymentProofUrls(order.payment_screenshot_url);
  const canEditPayment = canCurrentUserEdit("payment_method");
  const showPaymentProofUpload =
    canEditPayment && paymentMethodRequiresProof(order.payment_method);

  const [customerAssets, setCustomerAssets] = useState([]);
  const [customerAssetsLoading, setCustomerAssetsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCustomerAssetsLoading(true);
    fetchOrderCustomerAssets(supabase, order.id)
      .then((rows) => {
        if (!cancelled) setCustomerAssets(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomerAssets([]);
      })
      .finally(() => {
        if (!cancelled) setCustomerAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  return (
    <div className="order-detail-panel">
      <div className="order-detail-head">
        <div>
          <h3>{order.customer_name}</h3>
          <p className="order-detail-sub">
            Order {order.order_id?.trim() ? order.order_id : "—"} · Job #{order.id}
          </p>
        </div>
        <button type="button" className="order-detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="order-detail-body">
        <section className="order-detail-section order-detail-section--card">
          <h4 className="order-detail-section-title">Order details</h4>
          <div className="order-detail-grid">
            <DetailField label="Order date">{order.order_date || "—"}</DetailField>
            <DetailField label="Order number">
              {order.order_id?.trim() ? order.order_id : "—"}
            </DetailField>
            <DetailField label="Owner">{order.owner_name || "—"}</DetailField>
            <DetailField label="Customer">{order.customer_name}</DetailField>
            <DetailField label="Coordinator">
              {canCurrentUserEdit("coordinator_name") ? (
                <select
                  className="order-detail-control"
                  value={coordinatorUpdates[order.id] ?? order.coordinator_name}
                  onChange={(e) =>
                    setCoordinatorUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                >
                  {coordinators.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                order.coordinator_name
              )}
            </DetailField>
            <DetailField label="Delivery date">
              {canCurrentUserEdit("due_date") ? (
                <input
                  type="date"
                  className="order-detail-control"
                  value={dueDateUpdates[order.id] ?? order.due_date}
                  onChange={(e) =>
                    setDueDateUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                />
              ) : (
                formatDeliveryDate(order.due_date)
              )}
            </DetailField>
            <DetailField label="Quantity">
              {canCurrentUserEdit("qty") ? (
                <input
                  type="number"
                  min="0"
                  className="order-detail-control order-detail-control--narrow"
                  value={qtyUpdates[order.id] ?? order.qty}
                  onChange={(e) =>
                    setQtyUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                />
              ) : (
                order.qty
              )}
            </DetailField>
            <DetailField label="Sizes">
              {formatSizeBreakdownSummary(order.size_breakdown) || "—"}
            </DetailField>
            <DetailField label="Product">{order.product_name || "—"}</DetailField>
            <DetailField label="Colors">
              <OrderColorsCell colors={order.colors} />
            </DetailField>
            <DetailField label="Payment">
              {canEditPayment ? (
                <select
                  className="order-detail-payment-select"
                  value={order.payment_method ?? ""}
                  onChange={(e) => void handleUpdatePaymentMethod(order, e.target.value)}
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                paymentMethodLabel(order.payment_method)
              )}
            </DetailField>
            {showPaymentProofUpload || paymentProofUrls.length > 0 ? (
              <DetailField label="Payment proof" wide>
                {paymentProofUrls.length > 0 ? (
                  <div className="order-detail-thumb-grid">
                    {paymentProofUrls.map((url, index) => (
                      <button
                        key={`${order.id}-proof-${index}`}
                        type="button"
                        className="approved-thumb-btn order-detail-thumb-btn order-detail-payment-screenshot-btn"
                        onClick={() => openPreview(paymentProofUrls, index)}
                      >
                        <img src={url} alt={`Payment proof ${index + 1}`} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="order-detail-muted">No proof uploaded yet</p>
                )}
                {showPaymentProofUpload ? (
                  <>
                    <input
                      id={`payment-proof-upload-${order.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="table-inline-file-input"
                      disabled={isUploadingPaymentProof}
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (picked.length) void handleAppendPaymentProof(order, picked);
                      }}
                    />
                    <label
                      htmlFor={`payment-proof-upload-${order.id}`}
                      className="table-inline-file-label"
                    >
                      {isUploadingPaymentProof
                        ? "Uploading…"
                        : paymentProofUrls.length
                          ? "Add more proof"
                          : "Upload proof"}
                    </label>
                  </>
                ) : null}
              </DetailField>
            ) : null}
            {order.invoice_url ? (
              <DetailField label="Invoice">
                <a href={order.invoice_url} target="_blank" rel="noopener noreferrer">
                  View invoice
                </a>
              </DetailField>
            ) : null}
            <DetailField label="Delivery">{deliveryMethodLabel(order.delivery_method)}</DetailField>
          </div>
        </section>

        {customerAssetsLoading || customerAssets.length > 0 ? (
          <section className="order-detail-section order-detail-section--card">
            <h4 className="order-detail-section-title">Customer assets</h4>
            <p className="order-detail-muted order-detail-asset-note">
              Files from customer at job create. Auto-removed after 48 hours.
            </p>
            {customerAssetsLoading ? (
              <p className="order-detail-muted">Loading files…</p>
            ) : (
              <ul className="order-detail-asset-list">
                {customerAssets.map((asset) => {
                  const url = customerAssetPublicUrl(supabase, asset.storage_path);
                  return (
                    <li key={asset.id} className="order-detail-asset-item">
                      <span className="order-detail-asset-name">{asset.file_name}</span>
                      <span className="order-detail-asset-meta">
                        Until {formatCustomerAssetExpiry(asset.uploaded_at) || "—"}
                      </span>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={asset.file_name}
                          className="order-detail-asset-download"
                        >
                          Download
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        <section className="order-detail-section order-detail-section--card order-detail-images-section">
          <h4 className="order-detail-section-title">Designs</h4>
          <div className="order-detail-images-row">
            <div className="order-detail-images-col">
              <p className="order-detail-images-label">Mockups</p>
              {mockupUrls.length ? (
                <div className="order-detail-thumb-grid">
                  {mockupUrls.map((url, index) => (
                    <button
                      type="button"
                      className="approved-thumb-btn order-detail-thumb-btn"
                      key={`${order.id}-mockup-${index}`}
                      onClick={() => openPreview(mockupUrls, index)}
                    >
                      <img src={url} alt={`Mockup ${index + 1}`} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="order-detail-muted">No mockups</p>
              )}
            </div>

            <div className="order-detail-images-col">
              <p className="order-detail-images-label">Approved design images</p>
              <div className="approved-post-design-wrap order-detail-post-design-wrap">
                {canReplaceDesigns && postUrls.length > 0 ? (
                  <p className="post-design-replace-hint">
                    Remove current image{postUrls.length > 1 ? "s" : ""}, then upload revised design
                    {postUrls.length > 1 ? "s" : ""} below.
                  </p>
                ) : null}
                {canCurrentUserEdit("approved_design_images") && postUrls.length > 0 && !canReplaceDesigns ? (
                  <p className="post-design-replace-hint">
                    You can add more approved design images below without removing existing ones.
                  </p>
                ) : null}
                {postUrls.length > 0 ? (
                  <div className="order-detail-thumb-grid">
                    {postUrls.map((url, index) => (
                      <div className="order-detail-thumb-wrap" key={`${order.id}-post-${index}`}>
                        <button
                          type="button"
                          className="approved-thumb-btn order-detail-thumb-btn"
                          onClick={() => openPreview(postUrls, index)}
                          disabled={designActionsBusy}
                        >
                          <img src={url} alt={`Approved design ${index + 1}`} />
                        </button>
                        {canReplaceDesigns ? (
                          <button
                            type="button"
                            className="order-detail-thumb-remove"
                            title="Remove image"
                            disabled={designActionsBusy}
                            onClick={() => handleArchiveApprovedDesignImages(order, [url])}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="order-detail-muted">No images yet</p>
                )}
                {canReplaceDesigns && postUrls.length > 0 ? (
                  <button
                    type="button"
                    className="post-design-remove-all-btn"
                    disabled={designActionsBusy}
                    onClick={() => handleArchiveApprovedDesignImages(order, "all")}
                  >
                    {isArchivingDesigns ? "Removing…" : "Remove all images"}
                  </button>
                ) : null}
                {canCurrentUserEdit("approved_design_images") && (
                  <>
                    <input
                      id={`post-design-upload-detail-${order.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="table-inline-file-input"
                      disabled={designActionsBusy}
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (picked.length) {
                          void handleAppendPostApprovedDesignImages(order, picked);
                        }
                      }}
                    />
                    <label
                      htmlFor={`post-design-upload-detail-${order.id}`}
                      className="table-inline-file-label"
                    >
                      {isUploadingDesigns
                        ? "Uploading…"
                        : postUrls.length
                          ? "Add more"
                          : "Add images"}
                    </label>
                  </>
                )}
                {postUrls.length > 0 && reviewStatus ? (
                  <div className="post-design-review-block">
                    {reviewStatus === POST_DESIGN_REVIEW.APPROVED ? (
                      <span className="post-design-review-badge post-design-review-badge--approved">
                        Approved
                      </span>
                    ) : reviewStatus === POST_DESIGN_REVIEW.NEEDS_CHANGES ? (
                      <span className="post-design-review-badge post-design-review-badge--changes">
                        Need changes
                      </span>
                    ) : (
                      <span className="post-design-review-badge post-design-review-badge--pending">
                        Awaiting sales review
                      </span>
                    )}
                    {changesNote && reviewStatus === POST_DESIGN_REVIEW.NEEDS_CHANGES ? (
                      <p className="post-design-changes-note">
                        <strong>Changes:</strong> {changesNote}
                      </p>
                    ) : null}
                    {isSalesReviewer ? (
                      <div className="post-design-review-actions">
                        <button
                          type="button"
                          className="btn-post-design-approved"
                          disabled={isSavingReview}
                          onClick={() => handleApprovePostDesign(order)}
                        >
                          {isSavingReview ? "Saving…" : "Approved"}
                        </button>
                        <button
                          type="button"
                          className="btn-post-design-need-changes"
                          disabled={isSavingReview}
                          onClick={() => openPostDesignChangesInput(order)}
                        >
                          Need Changes
                        </button>
                        {showChangesInput ? (
                          <div className="post-design-changes-form">
                            <textarea
                              className="post-design-changes-input"
                              rows={3}
                              placeholder="Describe changes needed…"
                              value={designReviewNoteDrafts[order.id] ?? ""}
                              onChange={(e) =>
                                setDesignReviewNoteDrafts((prev) => ({
                                  ...prev,
                                  [order.id]: e.target.value
                                }))
                              }
                            />
                            <div className="post-design-changes-form-actions">
                              <button
                                type="button"
                                className="btn-post-design-need-changes"
                                disabled={isSavingReview}
                                onClick={() => handleSubmitPostDesignChanges(order)}
                              >
                                {isSavingReview ? "Saving…" : "Submit changes"}
                              </button>
                              <button
                                type="button"
                                className="post-design-changes-cancel"
                                disabled={isSavingReview}
                                onClick={() => {
                                  setDesignReviewNoteOpen((prev) => {
                                    const next = { ...prev };
                                    delete next[order.id];
                                    return next;
                                  });
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="order-detail-section order-detail-section--card">
          <h4 className="order-detail-section-title">Production &amp; printing</h4>
          <div className="order-detail-grid">
            <DetailField label="Production order">{order.is_production_order ? "Yes" : "No"}</DetailField>
            {order.is_production_order ? (
              <DetailField label="Expected handover">
                {order.expected_handover_to_printing ?? "—"}
              </DetailField>
            ) : (
              <div className="order-detail-field order-detail-field--spacer" aria-hidden />
            )}
            <DetailField label="Received at printing">
              {canCurrentUserEdit("received_at_printing") ? (
                <input
                  type="datetime-local"
                  className="order-detail-control"
                  value={
                    receivedAtPrintingUpdates[order.id] !== undefined
                      ? receivedAtPrintingUpdates[order.id]
                      : receivedAtToDatetimeLocalValue(order.received_at_printing)
                  }
                  onChange={(e) =>
                    setReceivedAtPrintingUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                />
              ) : (
                formatReceivedAtDisplay(order.received_at_printing)
              )}
            </DetailField>
            <DetailField label="Printing metres">
              {canCurrentUserEdit("printing_mtrs") ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="order-detail-control order-detail-control--narrow"
                  value={printingMtrsUpdates[order.id] ?? String(order.printing_mtrs ?? 0)}
                  onChange={(e) =>
                    setPrintingMtrsUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                />
              ) : (
                Number(order.printing_mtrs ?? 0).toFixed(2)
              )}
            </DetailField>
          </div>
        </section>

        <section className="order-detail-section order-detail-section--card">
          <h4 className="order-detail-section-title">Status &amp; remarks</h4>
          <div className="order-detail-status-block">
            <span className={`status-pill status-${order.status}`}>
              {renderStageIcon(order.status, STAGE_LABEL[order.status])}{" "}
              {STAGE_LABEL[order.status]}
            </span>
            {canUseOrderControls && canCurrentUserEdit("status") && (
              <select
                className={`status-select status-${statusUpdates[order.id] ?? order.status}`}
                value={statusUpdates[order.id] ?? order.status}
                onChange={(e) => {
                  void persistOrderStatus(order, e.target.value);
                }}
              >
                {FORM_STAGES.map((stage) => (
                  <option value={stage} key={stage}>
                    {STAGE_OPTION_ICON[stage]} {STAGE_LABEL[stage]}
                  </option>
                ))}
              </select>
            )}
          </div>
          <label className="order-detail-remarks-label">
            Remarks
            {canCurrentUserEdit("remarks") ? (
              <textarea
                className="inline-remarks"
                rows={3}
                value={remarksUpdates[order.id] ?? order.remarks ?? ""}
                onChange={(e) =>
                  setRemarksUpdates((prev) => ({
                    ...prev,
                    [order.id]: e.target.value
                  }))
                }
              />
            ) : (
              <p className="order-detail-muted">{order.remarks ?? "—"}</p>
            )}
          </label>
        </section>
      </div>

      <div className="order-detail-footer">
        {profileLoading ? (
          <span>…</span>
        ) : canUseOrderControls ? (
          <>
            <button
              type="button"
              className="btn-view-order-footer"
              onClick={() => openOrderHistory(order)}
              disabled={Boolean(profileError)}
            >
              Order history
            </button>
            {viewerMayUpdateOrders && (
              <button
                type="button"
                onClick={() => handleViewerUpdate(order.id)}
                disabled={Boolean(profileError)}
              >
                Save changes
              </button>
            )}
            {isAdmin && !order.is_complete && (
              <button
                type="button"
                className="btn-mark-complete"
                onClick={() => handleMarkComplete(order)}
                disabled={Boolean(profileError)}
              >
                Mark as complete
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="danger-btn"
                onClick={() => handleDeleteOrder(order)}
                disabled={Boolean(profileError)}
              >
                Delete job
              </button>
            )}
          </>
        ) : (
          <span className="order-actions-note">View only</span>
        )}
      </div>
    </div>
  );
}
