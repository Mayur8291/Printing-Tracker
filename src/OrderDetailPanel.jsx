import { useEffect, useMemo, useState } from "react";
import { OrderAdminColorField, OrderAdminSizeFields } from "./OrderAdminDetailFields";
import { createCoordinatorSelectOptions } from "./coordinatorSelectUtils";
import { buildAdminOrderDraftFromOrder } from "./orderAdminEditUtils";
import {
  POST_DESIGN_REVIEW,
  FORM_STAGES,
  STAGE_LABEL,
  STAGE_OPTION_ICON,
  effectivePostDesignReviewStatus,
  formatDeliveryDate,
  formatReceivedAtDisplay,
  formatSizeBreakdownSummary,
  parseDesignUrls,
  splitOrderIds,
  receivedAtToDatetimeLocalValue
} from "./orderViewUtils";
import {
  DELIVERY_METHODS,
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
import StickerOrderIdBadge from "./StickerOrderIdBadge";
import {
  formatStickerQtyDisplay,
  formatStickerSizeDisplay,
  isStickerOrder,
  STICKER_STAGES,
  STICKER_STAGE_LABEL,
  stageLabelForOrder
} from "./stickerOrderUtils";

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
  viewerProfiles = [],
  owners = [],
  adminOrderDrafts,
  patchAdminOrderDraft,
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
  function renderOrderIdBadges(orderId) {
    const ids = splitOrderIds(orderId);
    if (!ids.length) return "—";
    if (ids.length === 1) return ids[0];
    return (
      <span className="order-id-badges" aria-label="Order IDs">
        {ids.map((id) => (
          <span key={id} className="order-id-badge" title={id}>
            {id}
          </span>
        ))}
      </span>
    );
  }

  const orderIdShort = splitOrderIds(order.order_id).join(", ") || "—";
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
  const adminDraft =
    isAdmin && (adminOrderDrafts?.[order.id] ?? buildAdminOrderDraftFromOrder(order));
  const sticker = isStickerOrder(order);
  const statusOptionStages = sticker && !isAdmin ? STICKER_STAGES : FORM_STAGES;
  const statusDisplayLabel = stageLabelForOrder(order, order.status);

  const coordinatorValue = coordinatorUpdates[order.id] ?? order.coordinator_name ?? "";
  const coordinatorSelectOptions = useMemo(
    () =>
      createCoordinatorSelectOptions({
        coordinators,
        viewerProfiles,
        isAdmin,
        currentUserName: coordinatorValue
      }),
    [coordinators, viewerProfiles, isAdmin, coordinatorValue]
  );

  function patchAdminDraft(patch) {
    patchAdminOrderDraft?.(order.id, patch);
  }

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
            {sticker ? (
              <>
                Sticker order · Job #{order.id}
              </>
            ) : (
              <>
                Order {orderIdShort} · Job #{order.id}
              </>
            )}
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
            <DetailField label="Order date">
              {isAdmin ? (
                <input
                  type="date"
                  className="order-detail-control"
                  value={adminDraft.order_date}
                  onChange={(e) => patchAdminDraft({ order_date: e.target.value })}
                />
              ) : (
                order.order_date || "—"
              )}
            </DetailField>
            <DetailField label="Order number">
              {sticker ? (
                <StickerOrderIdBadge />
              ) : isAdmin ? (
                <input
                  type="text"
                  className="order-detail-control"
                  placeholder="e.g. 51169 or 51169, 51170"
                  value={adminDraft.order_id}
                  onChange={(e) => patchAdminDraft({ order_id: e.target.value })}
                />
              ) : (
                renderOrderIdBadges(order.order_id)
              )}
            </DetailField>
            {!sticker ? (
            <DetailField label="Owner">
              {isAdmin ? (
                <select
                  className="order-detail-control"
                  value={adminDraft.owner_name}
                  onChange={(e) => patchAdminDraft({ owner_name: e.target.value })}
                >
                  <option value="">—</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.name}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              ) : (
                order.owner_name || "—"
              )}
            </DetailField>
            ) : null}
            <DetailField label="Customer">
              {isAdmin ? (
                <input
                  type="text"
                  className="order-detail-control"
                  value={adminDraft.customer_name}
                  onChange={(e) => patchAdminDraft({ customer_name: e.target.value })}
                />
              ) : (
                order.customer_name
              )}
            </DetailField>
            <DetailField label="Coordinator">
              {canCurrentUserEdit("coordinator_name") ? (
                <select
                  className="order-detail-control"
                  value={coordinatorValue}
                  onChange={(e) =>
                    setCoordinatorUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                >
                  <option value="">—</option>
                  {coordinatorSelectOptions.map((opt) => (
                    <option key={opt.id} value={opt.name}>
                      {opt.name}
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
              ) : sticker ? (
                formatStickerQtyDisplay(order.qty)
              ) : (
                order.qty
              )}
            </DetailField>
            {sticker ? (
              <DetailField label="Size">
                {isAdmin ? (
                  <input
                    type="text"
                    className="order-detail-control"
                    value={adminDraft.product_name === "Applicable" ? "" : adminDraft.product_name}
                    onChange={(e) =>
                      patchAdminDraft({
                        product_name: e.target.value.trim() || "Applicable"
                      })
                    }
                  />
                ) : (
                  formatStickerSizeDisplay(order.product_name)
                )}
              </DetailField>
            ) : (
              <>
            <DetailField label="Sizes" wide={isAdmin}>
              {isAdmin ? (
                <OrderAdminSizeFields draft={adminDraft} onPatch={patchAdminDraft} />
              ) : (
                formatSizeBreakdownSummary(order.size_breakdown) || "—"
              )}
            </DetailField>
            <DetailField label="Product">
              {isAdmin ? (
                <input
                  type="text"
                  className="order-detail-control"
                  value={adminDraft.product_name}
                  onChange={(e) => patchAdminDraft({ product_name: e.target.value })}
                />
              ) : (
                order.product_name || "—"
              )}
            </DetailField>
            <DetailField label="Colors" wide={isAdmin}>
              {isAdmin ? (
                <OrderAdminColorField
                  colors={adminDraft.colors}
                  onChange={(colors) => patchAdminDraft({ colors })}
                />
              ) : (
                <OrderColorsCell colors={order.colors} />
              )}
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
            <DetailField label="Delivery">
              {isAdmin ? (
                <select
                  className="order-detail-control"
                  value={adminDraft.delivery_method}
                  onChange={(e) => patchAdminDraft({ delivery_method: e.target.value })}
                >
                  <option value="">—</option>
                  {DELIVERY_METHODS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                deliveryMethodLabel(order.delivery_method)
              )}
            </DetailField>
              </>
            )}
          </div>
        </section>

        {(sticker || customerAssetsLoading || customerAssets.length > 0) ? (
          <section className="order-detail-section order-detail-section--card">
            <h4 className="order-detail-section-title">
              {sticker ? "Uploaded assets" : "Customer assets"}
            </h4>
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

        {!sticker ? (
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
        ) : null}

        <section className="order-detail-section order-detail-section--card">
          <h4 className="order-detail-section-title">
            {sticker ? "Printing" : "Production & printing"}
          </h4>
          <div className="order-detail-grid">
            {!sticker ? (
              <>
            <DetailField label="Production order">
              {isAdmin ? (
                <label className="order-detail-checkbox-label">
                  <input
                    type="checkbox"
                    checked={Boolean(adminDraft.is_production_order)}
                    onChange={(e) =>
                      patchAdminDraft({ is_production_order: e.target.checked })
                    }
                  />
                  Production order
                </label>
              ) : order.is_production_order ? (
                "Yes"
              ) : (
                "No"
              )}
            </DetailField>
            {isAdmin && adminDraft.is_production_order ? (
              <DetailField label="Expected handover">
                <input
                  type="date"
                  className="order-detail-control"
                  value={adminDraft.expected_handover_to_printing}
                  onChange={(e) =>
                    patchAdminDraft({ expected_handover_to_printing: e.target.value })
                  }
                />
              </DetailField>
            ) : !isAdmin && order.is_production_order ? (
              <DetailField label="Expected handover">
                {order.expected_handover_to_printing ?? "—"}
              </DetailField>
            ) : (
              <div className="order-detail-field order-detail-field--spacer" aria-hidden />
            )}
              </>
            ) : null}
            {!sticker ? (
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
            ) : null}
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
            {!sticker ? (
              <>
            <DetailField label="Order cost">
              {isAdmin ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="order-detail-control order-detail-control--narrow"
                  value={adminDraft.order_cost}
                  onChange={(e) => patchAdminDraft({ order_cost: e.target.value })}
                />
              ) : order.order_cost != null && order.order_cost !== "" ? (
                Number(order.order_cost).toFixed(2)
              ) : (
                "—"
              )}
            </DetailField>
            <DetailField label="Printing cost">
              {isAdmin ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="order-detail-control order-detail-control--narrow"
                  value={adminDraft.printing_cost}
                  onChange={(e) => patchAdminDraft({ printing_cost: e.target.value })}
                />
              ) : order.printing_cost != null && order.printing_cost !== "" ? (
                Number(order.printing_cost).toFixed(2)
              ) : (
                "—"
              )}
            </DetailField>
              </>
            ) : null}
          </div>
        </section>

        <section className="order-detail-section order-detail-section--card">
          <h4 className="order-detail-section-title">Status &amp; remarks</h4>
          <div className="order-detail-status-block">
            <span className={`status-pill status-${order.status}`}>
              {renderStageIcon(order.status, statusDisplayLabel)}{" "}
              {statusDisplayLabel}
            </span>
            {canUseOrderControls && canCurrentUserEdit("status") && (
              <select
                className={`status-select status-${statusUpdates[order.id] ?? order.status}`}
                value={statusUpdates[order.id] ?? order.status}
                onChange={(e) => {
                  void persistOrderStatus(order, e.target.value);
                }}
              >
                {statusOptionStages.map((stage) => (
                  <option value={stage} key={stage}>
                    {STAGE_OPTION_ICON[stage]}{" "}
                    {sticker
                      ? STICKER_STAGE_LABEL[stage] ?? STAGE_LABEL[stage]
                      : STAGE_LABEL[stage]}
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
            {(viewerMayUpdateOrders || isAdmin) && (
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
        ) : null}
      </div>
    </div>
  );
}
