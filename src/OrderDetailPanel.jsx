import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { OrderAdminColorField, OrderAdminSizeFields } from "./OrderAdminDetailFields";
import { createCoordinatorSelectOptions } from "./coordinatorSelectUtils";
import { buildAdminOrderDraftFromOrder } from "./orderAdminEditUtils";
import OrderStatusBadge from "./components/orders/OrderStatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getOrderHistoryButtonLabel } from "./orderHistoryUtils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  POST_DESIGN_REVIEW,
  FORM_STAGES,
  STAGE_LABEL,
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
import {
  jobSheetProductionStatusOptions,
  jobSheetProductionStageLabel
} from "./jobSheetProductionStages";
import {
  sampleJobSheetStatusOptions,
  sampleJobSheetStageLabel,
  sampleJobSheetIsClosed,
  sampleJobSheetDisplayStatus
} from "./sampleJobSheetStages";
import { formatJobSheetMoneyDisplay } from "./jobSheetPaymentUtils";
import { isJobSheetOrder, getJobSheetGenderLabel, getJobSheetProductTypeLabel, getJobSheetSizeTypeLabel } from "./jobSheetUtils";
import { isSampleJobSheetOrder } from "./sampleJobSheetUtils";
import { supabase } from "./supabaseClient";
import { DatePicker } from "@/components/ui/date-picker";
import MasterListSelectField from "@/components/admin/MasterListSelectField";
import {
  customerAssetIsPreviewable,
  fetchOrderCustomerAssetsWithUrls,
  formatCustomerAssetExpiry
} from "./orderCustomerAssets";
import StickerOrderIdBadge from "./StickerOrderIdBadge";
import SamplingOrderIdBadge from "./SamplingOrderIdBadge";
import JobSheetOrderIdBadge from "./JobSheetOrderIdBadge";
import JobSheetOrderPaymentSection from "./JobSheetOrderPaymentSection";
import {
  compactPrintingOrderLabel,
  formatStickerQtyDisplay,
  formatStickerSizeDisplay,
  isCompactPrintingOrder,
  isSamplingOrder,
  isStickerOrder,
  STICKER_STAGES,
  STICKER_STAGE_LABEL,
  stageLabelForOrder
} from "./stickerOrderUtils";
import { formatSamplingOrderIdDisplay, samplingSizeFromBreakdown } from "./samplingOrderUtils";
import SampleJobSheetDueIn from "./SampleJobSheetDueIn";

function DetailField({ label, children, wide }) {
  return (
    <div className={cn("grid gap-1.5", wide && "sm:col-span-2")}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

function DetailSelect({ value, onValueChange, options, disabled = false }) {
  const selectValue = value ? String(value) : "__empty__";
  return (
    <Select
      value={selectValue}
      onValueChange={(next) => onValueChange(next === "__empty__" ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__empty__">—</SelectItem>
        {options.map((opt) => {
          const itemValue = String(opt.value ?? opt.name);
          return (
            <SelectItem key={itemValue} value={itemValue}>
              {opt.label ?? opt.name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function FallbackColorsCell({ colors }) {
  if (!Array.isArray(colors) || colors.length === 0) return "—";
  return colors.filter(Boolean).join(", ");
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
  handleAppendJobSheetPaymentProof,
  handleAppendJobSheetAdvanceProof,
  handleAppendJobSheetApprovalImage,
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
  OrderColorsCell,
  onAddOwner,
  onAddCoordinator
}) {
  const ColorsCell = OrderColorsCell ?? FallbackColorsCell;

  const [customerAssets, setCustomerAssets] = useState([]);
  const [customerAssetsLoading, setCustomerAssetsLoading] = useState(false);

  useEffect(() => {
    if (!order?.id) {
      setCustomerAssets([]);
      setCustomerAssetsLoading(false);
      return undefined;
    }
    let cancelled = false;

    async function loadAssets() {
      setCustomerAssetsLoading(true);
      try {
        const rows = await fetchOrderCustomerAssetsWithUrls(supabase, order.id);
        if (!cancelled) setCustomerAssets(rows);
      } catch {
        if (!cancelled) setCustomerAssets([]);
      } finally {
        if (!cancelled) setCustomerAssetsLoading(false);
      }
    }

    loadAssets();

    const assetsChannel = supabase
      .channel(`order-customer-assets-${order.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_customer_assets",
          filter: `order_id=eq.${order.id}`
        },
        () => {
          loadAssets();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(assetsChannel);
    };
  }, [order?.id]);

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
  const compactPrinting = isCompactPrintingOrder(order);
  const sampleJobSheet = isSampleJobSheetOrder(order);
  const sampleClosed = sampleJobSheet && sampleJobSheetIsClosed(order);
  const jobSheet = isJobSheetOrder(order);
  const sticker = isStickerOrder(order);
  const sampling = isSamplingOrder(order);
  const canEditPayment = canCurrentUserEdit("payment_method");
  const showPaymentProofUpload =
    canEditPayment && paymentMethodRequiresProof(order.payment_method);
  const adminDraft = isAdmin
    ? adminOrderDrafts?.[order.id] ?? buildAdminOrderDraftFromOrder(order)
    : null;
  const statusOptionStages = useMemo(() => {
    if (sampleJobSheet) return sampleJobSheetStatusOptions(order.status);
    if (jobSheet) return jobSheetProductionStatusOptions(order.status);
    if (compactPrinting && !isAdmin) return STICKER_STAGES;
    return FORM_STAGES;
  }, [sampleJobSheet, jobSheet, compactPrinting, isAdmin, order.status]);
  const statusSelectOptions = useMemo(() => {
    const current = String(statusUpdates[order.id] ?? order.status ?? "").trim();
    const stages = [...statusOptionStages];
    if (current && !stages.includes(current)) {
      stages.unshift(current);
    }
    return stages.map((stage) => ({
      value: stage,
      label: sampleJobSheet
        ? sampleJobSheetStageLabel(stage)
        : jobSheet
          ? jobSheetProductionStageLabel(stage)
          : compactPrinting
            ? `${STICKER_STAGE_LABEL[stage] ?? STAGE_LABEL[stage]}`
            : STAGE_LABEL[stage] ?? stage
    }));
  }, [
    statusOptionStages,
    statusUpdates,
    order.id,
    order.status,
    sampleJobSheet,
    jobSheet,
    compactPrinting
  ]);
  const sampleDisplayStatus = sampleJobSheet
    ? sampleJobSheetDisplayStatus(order, statusUpdates[order.id] ?? order.status)
    : null;
  const statusDisplayLabel = sampleJobSheet
    ? sampleJobSheetStageLabel(sampleDisplayStatus)
    : jobSheet
      ? jobSheetProductionStageLabel(order.status)
      : stageLabelForOrder(order, order.status);

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

  return (
    <div className="flex min-h-0 flex-col bg-background text-foreground">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background px-6 py-5">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-semibold tracking-tight">{order.customer_name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobSheet ? (
              <>Job sheet {order.order_id || order.id} · Job #{order.id}</>
            ) : compactPrinting ? (
              <>
                {formatSamplingOrderIdDisplay(order.order_id) || compactPrintingOrderLabel(order)} · Job #
                {order.id}
              </>
            ) : (
              <>
                Order {orderIdShort} · Job #{order.id}
              </>
            )}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold tracking-tight">Order details</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailField label="Order date">
              {isAdmin ? (
                <DatePicker
                  id={`order-detail-order-date-${order.id}`}
                  className="w-full"
                  value={adminDraft.order_date}
                  onChange={(next) => patchAdminDraft({ order_date: next })}
                />
              ) : (
                order.order_date || "—"
              )}
            </DetailField>
            <DetailField label="Order number">
              {jobSheet ? (
                <div className="flex flex-wrap items-center gap-2">
                  <JobSheetOrderIdBadge />
                  <span className="font-medium">{order.order_id || "—"}</span>
                </div>
              ) : compactPrinting ? (
                sticker ? (
                  <StickerOrderIdBadge />
                ) : (
                  <SamplingOrderIdBadge orderId={order.order_id} />
                )
              ) : isAdmin ? (
                <Input
                  type="text"
                  className="h-9"
                  placeholder="e.g. 51169 or 51169, 51170"
                  value={adminDraft.order_id}
                  onChange={(e) => patchAdminDraft({ order_id: e.target.value })}
                />
              ) : (
                renderOrderIdBadges(order.order_id)
              )}
            </DetailField>
            {!compactPrinting && !jobSheet ? (
            <DetailField label="Owner">
              {isAdmin ? (
                <MasterListSelectField
                  id={`order-detail-owner-${order.id}`}
                  value={adminDraft.owner_name}
                  onValueChange={(next) => patchAdminDraft({ owner_name: next })}
                  options={owners.map((owner) => ({ value: owner.name, label: owner.name }))}
                  onAdd={onAddOwner}
                  placeholder="Select owner"
                  addPlaceholder="Owner name"
                  triggerClassName="h-9"
                />
              ) : (
                order.owner_name || "—"
              )}
            </DetailField>
            ) : null}
            <DetailField label="Customer">
              {isAdmin ? (
                <Input
                  type="text"
                  className="h-9"
                  value={adminDraft.customer_name}
                  onChange={(e) => patchAdminDraft({ customer_name: e.target.value })}
                />
              ) : (
                order.customer_name
              )}
            </DetailField>
            <DetailField label={jobSheet ? "Sales incharge" : "Coordinator"}>
              {canCurrentUserEdit("coordinator_name") ? (
                <MasterListSelectField
                  id={`order-detail-coordinator-${order.id}`}
                  value={coordinatorValue}
                  onValueChange={(next) =>
                    setCoordinatorUpdates((prev) => ({
                      ...prev,
                      [order.id]: next
                    }))
                  }
                  options={coordinatorSelectOptions.map((opt) => ({
                    value: opt.name,
                    label: opt.name
                  }))}
                  onAdd={isAdmin ? onAddCoordinator : undefined}
                  placeholder="Select coordinator"
                  addPlaceholder="Coordinator name"
                  triggerClassName="h-9"
                />
              ) : jobSheet ? (
                order.sales_incharge_name || order.coordinator_name || "—"
              ) : (
                order.coordinator_name
              )}
            </DetailField>
            <DetailField label={jobSheet || sampleJobSheet ? "Delivery required on" : "Delivery date"}>
              {canCurrentUserEdit("due_date") ? (
                <DatePicker
                  id={`order-detail-due-date-${order.id}`}
                  className="w-full"
                  value={dueDateUpdates[order.id] ?? order.due_date ?? ""}
                  onChange={(next) =>
                    setDueDateUpdates((prev) => ({
                      ...prev,
                      [order.id]: next
                    }))
                  }
                />
              ) : (
                formatDeliveryDate(order.due_date)
              )}
            </DetailField>
            <DetailField label="Quantity">
              {canCurrentUserEdit("qty") ? (
                <Input
                  type="number"
                  min="0"
                  className="h-9 w-28"
                  value={qtyUpdates[order.id] ?? order.qty}
                  onChange={(e) =>
                    setQtyUpdates((prev) => ({
                      ...prev,
                      [order.id]: e.target.value
                    }))
                  }
                />
              ) : compactPrinting ? (
                formatStickerQtyDisplay(order.qty)
              ) : (
                order.qty
              )}
            </DetailField>
            {compactPrinting ? (
              sampling ? (
                <>
                  <DetailField label="Product">
                    {isAdmin ? (
                      <Input
                        type="text"
                        className="h-9"
                        value={adminDraft.product_name}
                        onChange={(e) => patchAdminDraft({ product_name: e.target.value })}
                      />
                    ) : (
                      order.product_name || "—"
                    )}
                  </DetailField>
                  <DetailField label="Sticker sizes or artwork size">
                    {isAdmin ? (
                      <Input
                        type="text"
                        className="h-9"
                        value={samplingSizeFromBreakdown(adminDraft.size_breakdown)}
                        onChange={(e) =>
                          patchAdminDraft({
                            size_breakdown: e.target.value.trim()
                              ? { Size: e.target.value.trim() }
                              : {}
                          })
                        }
                      />
                    ) : (
                      samplingSizeFromBreakdown(order.size_breakdown) || "—"
                    )}
                  </DetailField>
                </>
              ) : (
              <DetailField label="Size">
                {isAdmin ? (
                  <Input
                    type="text"
                    className="h-9"
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
              )
            ) : jobSheet ? (
              <>
                <DetailField label="Gender">{getJobSheetGenderLabel(order.gender) || "—"}</DetailField>
                <DetailField label="Product type">
                  {getJobSheetProductTypeLabel(order.product_type) || "—"}
                </DetailField>
                <DetailField label="Size type">
                  {getJobSheetSizeTypeLabel(order.size_type) || order.size_type || "—"}
                </DetailField>
                <DetailField label="Rate per piece">
                  {isAdmin ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="h-9"
                      placeholder="0.00"
                      value={adminDraft.rate_per_piece ?? ""}
                      onChange={(e) => patchAdminDraft({ rate_per_piece: e.target.value })}
                    />
                  ) : order.rate_per_piece != null && order.rate_per_piece !== "" ? (
                    formatJobSheetMoneyDisplay(order.rate_per_piece)
                  ) : (
                    "—"
                  )}
                </DetailField>
                <DetailField label="Total amount">
                  {order.order_cost != null && order.order_cost !== ""
                    ? formatJobSheetMoneyDisplay(order.order_cost)
                    : "—"}
                </DetailField>
                <DetailField label="Sizes" wide>
                  {formatSizeBreakdownSummary(order.size_breakdown) || "—"}
                </DetailField>
                <DetailField label="Product">{order.product_name || "—"}</DetailField>
                <DetailField label="Brand">{order.brand || "—"}</DetailField>
                <DetailField label="Color">
                  <ColorsCell colors={order.colors} />
                </DetailField>
                <DetailField label="Fabric">{order.fabric_type || "—"}</DetailField>
                <DetailField label="GSM">{order.gsm || "—"}</DetailField>
                <DetailField label="Branding">
                  {order.branding
                    ? order.branding_type
                      ? `Yes · ${order.branding_type}`
                      : "Yes"
                    : "No"}
                </DetailField>
                <DetailField label="Atta">{order.atta ? "Yes" : "No"}</DetailField>
              </>
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
                <Input
                  type="text"
                  className="h-9"
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
                <ColorsCell colors={order.colors} />
              )}
            </DetailField>
            <DetailField label="Payment">
              {canEditPayment ? (
                <DetailSelect
                  value={order.payment_method ?? ""}
                  onValueChange={(next) => void handleUpdatePaymentMethod(order, next)}
                  options={PAYMENT_METHODS.map((opt) => ({ value: opt.value, label: opt.label }))}
                />
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
                  <p className="text-sm text-muted-foreground">No proof uploaded yet</p>
                )}
                {showPaymentProofUpload ? (
                  <>
                    <input
                      id={`payment-proof-upload-${order.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      disabled={isUploadingPaymentProof}
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (picked.length) void handleAppendPaymentProof(order, picked);
                      }}
                    />
                    <Button variant="outline" size="sm" asChild disabled={isUploadingPaymentProof}>
                      <label htmlFor={`payment-proof-upload-${order.id}`}>
                        {isUploadingPaymentProof
                          ? "Uploading…"
                          : paymentProofUrls.length
                            ? "Add more proof"
                            : "Upload proof"}
                      </label>
                    </Button>
                  </>
                ) : null}
              </DetailField>
            ) : null}
            {order.invoice_url ? (
              <DetailField label="Invoice">
                <Button variant="link" className="h-auto px-0" asChild>
                  <a href={order.invoice_url} target="_blank" rel="noopener noreferrer">
                    View invoice
                  </a>
                </Button>
              </DetailField>
            ) : null}
            <DetailField label="Delivery">
              {isAdmin ? (
                <DetailSelect
                  value={adminDraft.delivery_method}
                  onValueChange={(next) => patchAdminDraft({ delivery_method: next })}
                  options={DELIVERY_METHODS.map((opt) => ({ value: opt.value, label: opt.label }))}
                />
              ) : (
                deliveryMethodLabel(order.delivery_method)
              )}
            </DetailField>
              </>
            )}
          </div>
        </section>

        {jobSheet ? (
          <JobSheetOrderPaymentSection
            order={order}
            adminDraft={adminDraft}
            isAdmin={isAdmin}
            patchAdminDraft={patchAdminDraft}
            openPreview={openPreview}
            isUploadingPaymentProof={isUploadingPaymentProof}
            onUploadAdvanceProof={handleAppendJobSheetAdvanceProof}
            onUploadPaymentProof={handleAppendJobSheetPaymentProof}
            onUploadApprovalImage={handleAppendJobSheetApprovalImage}
          />
        ) : null}

        {(compactPrinting || customerAssetsLoading || customerAssets.length > 0) ? (
          <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
            <h4 className="text-sm font-semibold tracking-tight">
              {compactPrinting ? "Uploaded assets" : "Customer assets"}
            </h4>
            {customerAssetsLoading ? (
              <p className="text-sm text-muted-foreground">Loading files…</p>
            ) : (
              <ul className="space-y-2">
                {customerAssets.map((asset) => {
                  const previewable = customerAssetIsPreviewable(asset.mime_type, asset.file_name);
                  const isImage =
                    (asset.mime_type || "").toLowerCase().startsWith("image/") ||
                    /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?)$/i.test(asset.file_name || "");
                  return (
                    <li
                      key={asset.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{asset.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Until {formatCustomerAssetExpiry(asset.uploaded_at) || "—"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {asset.viewUrl && previewable ? (
                          isImage && openPreview ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openPreview([asset.viewUrl], 0)}
                            >
                              View
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" asChild>
                              <a
                                href={asset.viewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                View
                              </a>
                            </Button>
                          )
                        ) : null}
                        {asset.downloadUrl ? (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={asset.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={asset.file_name}
                            >
                              Download
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unavailable</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {((!compactPrinting && !jobSheet) || sampling) ? (
        <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold tracking-tight">{sampling ? "Mockups" : "Designs"}</h4>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Mockups</p>
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
                <p className="text-sm text-muted-foreground">No mockups</p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Approved design images</p>
              <div className="space-y-3">
                {postUrls.length > 0 ? (
                  <div className="order-detail-thumb-grid">
                    {postUrls.map((url, index) => (
                      <div className="relative" key={`${order.id}-post-${index}`}>
                        <button
                          type="button"
                          className="approved-thumb-btn order-detail-thumb-btn"
                          onClick={() => openPreview(postUrls, index)}
                          disabled={designActionsBusy}
                        >
                          <img src={url} alt={`Approved design ${index + 1}`} />
                        </button>
                        {canReplaceDesigns ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute -right-2 -top-2 size-6"
                            title="Remove image"
                            disabled={designActionsBusy}
                            onClick={() => handleArchiveApprovedDesignImages(order, [url])}
                          >
                            <X className="size-3" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No images yet</p>
                )}
                {canReplaceDesigns && postUrls.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={designActionsBusy}
                    onClick={() => handleArchiveApprovedDesignImages(order, "all")}
                  >
                    {isArchivingDesigns ? "Removing…" : "Remove all images"}
                  </Button>
                ) : null}
                {canCurrentUserEdit("approved_design_images") && (
                  <>
                    <input
                      id={`post-design-upload-detail-${order.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      disabled={designActionsBusy}
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (picked.length) {
                          void handleAppendPostApprovedDesignImages(order, picked);
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" asChild disabled={designActionsBusy}>
                      <label htmlFor={`post-design-upload-detail-${order.id}`}>
                        {isUploadingDesigns
                          ? "Uploading…"
                          : postUrls.length
                            ? "Add more"
                            : "Add images"}
                      </label>
                    </Button>
                  </>
                )}
                {postUrls.length > 0 && reviewStatus ? (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    {reviewStatus === POST_DESIGN_REVIEW.APPROVED ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>
                    ) : reviewStatus === POST_DESIGN_REVIEW.NEEDS_CHANGES ? (
                      <Badge variant="destructive">Need changes</Badge>
                    ) : (
                      <Badge variant="secondary">Awaiting sales review</Badge>
                    )}
                    {changesNote && reviewStatus === POST_DESIGN_REVIEW.NEEDS_CHANGES ? (
                      <p className="text-sm text-muted-foreground">
                        <strong className="text-foreground">Changes:</strong> {changesNote}
                      </p>
                    ) : null}
                    {isSalesReviewer ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={isSavingReview}
                          onClick={() => handleApprovePostDesign(order)}
                        >
                          {isSavingReview ? "Saving…" : "Approved"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSavingReview}
                          onClick={() => openPostDesignChangesInput(order)}
                        >
                          Need Changes
                        </Button>
                        {showChangesInput ? (
                          <div className="w-full space-y-2">
                            <Textarea
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
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSavingReview}
                                onClick={() => handleSubmitPostDesignChanges(order)}
                              >
                                {isSavingReview ? "Saving…" : "Submit changes"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
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
                              </Button>
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

        {!compactPrinting && !jobSheet ? (
        <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold tracking-tight">Production & printing</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!compactPrinting ? (
              <>
            <DetailField label="Production order">
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`production-order-${order.id}`}
                    checked={Boolean(adminDraft.is_production_order)}
                    onCheckedChange={(checked) =>
                      patchAdminDraft({ is_production_order: Boolean(checked) })
                    }
                  />
                  <Label htmlFor={`production-order-${order.id}`} className="text-sm font-normal">
                    Production order
                  </Label>
                </div>
              ) : order.is_production_order ? (
                "Yes"
              ) : (
                "No"
              )}
            </DetailField>
            {isAdmin && adminDraft.is_production_order ? (
              <DetailField label="Expected handover">
                <DatePicker
                  id={`order-detail-handover-${order.id}`}
                  className="w-full"
                  value={adminDraft.expected_handover_to_printing}
                  onChange={(next) => patchAdminDraft({ expected_handover_to_printing: next })}
                />
              </DetailField>
            ) : !isAdmin && order.is_production_order ? (
              <DetailField label="Expected handover">
                {order.expected_handover_to_printing ?? "—"}
              </DetailField>
            ) : (
              <div className="hidden sm:block" aria-hidden />
            )}
              </>
            ) : null}
            {!compactPrinting ? (
            <DetailField label="Received at printing">
              {canCurrentUserEdit("received_at_printing") ? (
                <Input
                  type="datetime-local"
                  className="h-9"
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
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-9 w-28"
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
            {!compactPrinting ? (
              <>
            <DetailField label="Order cost">
              {isAdmin ? (
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-9 w-28"
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
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-9 w-28"
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
        ) : null}

        {sampleJobSheet ? (
          <SampleJobSheetDueIn
            order={{
              ...order,
              due_date: dueDateUpdates[order.id] ?? order.due_date
            }}
          />
        ) : null}

        <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold tracking-tight">Status &amp; remarks</h4>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge
              status={sampleJobSheet ? sampleDisplayStatus : order.status}
              label={statusDisplayLabel}
              icon={renderStageIcon(
                sampleJobSheet ? sampleDisplayStatus : order.status,
                statusDisplayLabel
              )}
            />
            {canUseOrderControls && canCurrentUserEdit("status") && !sampleClosed && (
              <DetailSelect
                value={statusUpdates[order.id] ?? order.status}
                onValueChange={(next) => {
                  void persistOrderStatus(order, next);
                }}
                options={statusSelectOptions}
              />
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`order-remarks-${order.id}`} className="text-xs font-medium text-muted-foreground">
              Remarks
            </Label>
            {canCurrentUserEdit("remarks") ? (
              <Textarea
                id={`order-remarks-${order.id}`}
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
              <p className="text-sm text-muted-foreground">{order.remarks ?? "—"}</p>
            )}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background px-6 py-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => openOrderHistory(order)}
          disabled={Boolean(profileLoading || profileError)}
        >
          {getOrderHistoryButtonLabel(order)}
        </Button>
        {profileLoading ? (
          <span className="text-sm text-muted-foreground">Loading…</span>
        ) : canUseOrderControls ? (
          <>
            {(viewerMayUpdateOrders || isAdmin) && (
              <Button
                type="button"
                onClick={() => handleViewerUpdate(order.id)}
                disabled={Boolean(profileError)}
              >
                Save changes
              </Button>
            )}
            {isAdmin && !order.is_complete && !(sampleJobSheet && sampleClosed) && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleMarkComplete(order)}
                disabled={Boolean(profileError)}
              >
                Mark as complete
              </Button>
            )}
            {isAdmin && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => handleDeleteOrder(order)}
                disabled={Boolean(profileError)}
              >
                Delete job
              </Button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
