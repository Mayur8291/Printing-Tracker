import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { INDIAN_CITIES } from "./indianCities";
import {
  calcJobSheetAdvancePercent,
  calcJobSheetBalanceAmount,
  calcJobSheetPendingAmount,
  formatJobSheetClosureDate,
  formatJobSheetMoneyDisplay,
  jobSheetFullPaidMissingPaymentProof,
  JOB_SHEET_PAYMENT_MODES,
  jobSheetPaymentModeLabel
} from "./jobSheetPaymentUtils";
import { parsePaymentProofUrls } from "./orderTabUtils";

const SELECT_NONE = "__none__";

function DetailField({ label, children, wide }) {
  return (
    <div className={cn("grid gap-1.5", wide && "sm:col-span-2")}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

function ProofThumbGrid({ urls, orderId, prefix, openPreview }) {
  if (!urls.length) {
    return <p className="text-sm text-muted-foreground">No proof uploaded yet</p>;
  }
  return (
    <div className="order-detail-thumb-grid">
      {urls.map((url, index) => (
        <button
          key={`${orderId}-${prefix}-${index}`}
          type="button"
          className="approved-thumb-btn order-detail-thumb-btn order-detail-payment-screenshot-btn"
          onClick={() => openPreview(urls, index)}
        >
          <img src={url} alt={`${prefix} ${index + 1}`} />
        </button>
      ))}
    </div>
  );
}

function ProofUploadField({
  orderId,
  inputId,
  urls,
  prefix,
  openPreview,
  isUploading,
  onUpload,
  allowUpload
}) {
  return (
    <DetailField label={prefix} wide>
      <ProofThumbGrid urls={urls} orderId={orderId} prefix={prefix} openPreview={openPreview} />
      {allowUpload ? (
        <>
          <input
            id={inputId}
            type="file"
            accept="image/*,.pdf"
            multiple
            className="sr-only"
            disabled={isUploading}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (picked.length) void onUpload(picked);
            }}
          />
          <Button variant="outline" size="sm" className="mt-2" asChild disabled={isUploading}>
            <label htmlFor={inputId}>
              {isUploading ? "Uploading…" : urls.length ? "Add more proof" : "Upload proof"}
            </label>
          </Button>
        </>
      ) : null}
    </DetailField>
  );
}

export default function JobSheetOrderPaymentSection({
  order,
  adminDraft,
  isAdmin,
  patchAdminDraft,
  openPreview,
  isUploadingPaymentProof,
  onUploadAdvanceProof,
  onUploadPaymentProof,
  onUploadApprovalImage
}) {
  const draft = isAdmin && adminDraft ? adminDraft : null;
  const paymentMode = draft?.job_sheet_payment_mode ?? order.job_sheet_payment_mode ?? "";
  const advanceAmountRaw =
    draft?.job_sheet_advance_amount ??
    (order.job_sheet_advance_amount != null && order.job_sheet_advance_amount !== ""
      ? String(order.job_sheet_advance_amount)
      : "");
  const advanceDate =
    draft?.job_sheet_advance_payment_date ?? order.job_sheet_advance_payment_date ?? "";
  const fullPaid =
    isAdmin && draft ? Boolean(draft.job_sheet_full_paid) : Boolean(order.job_sheet_full_paid);
  const closureAt = draft?.job_sheet_payment_closure_at ?? order.job_sheet_payment_closure_at;
  const deliveryCity = draft?.job_sheet_delivery_city ?? order.job_sheet_delivery_city ?? "";
  const transportChargesRaw =
    draft?.job_sheet_transport_charges ??
    (order.job_sheet_transport_charges != null && order.job_sheet_transport_charges !== ""
      ? String(order.job_sheet_transport_charges)
      : "");
  const approvalDate = draft?.job_sheet_approval_date ?? order.job_sheet_approval_date ?? "";
  const approvedBy = draft?.job_sheet_approved_by ?? order.job_sheet_approved_by ?? "";

  const totalAmount = order.order_cost;
  const advancePercent = calcJobSheetAdvancePercent(totalAmount, advanceAmountRaw);
  const balanceAmount = calcJobSheetBalanceAmount(totalAmount, advanceAmountRaw);
  const pendingAmount = calcJobSheetPendingAmount(totalAmount, advanceAmountRaw, fullPaid);

  const advanceProofUrls = parsePaymentProofUrls(order.job_sheet_advance_proof_url);
  const paymentProofUrls = parsePaymentProofUrls(order.job_sheet_payment_proof_url);
  const proofMissing = jobSheetFullPaidMissingPaymentProof(order, parsePaymentProofUrls);
  const canUploadProofs = isAdmin;

  const approvalImageUrl = String(order.job_sheet_approval_image_url ?? "").trim();

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
      <h4 className="text-sm font-semibold tracking-tight">Payment & transactions</h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="Payment mode">
          {isAdmin ? (
            <Select
              value={paymentMode || SELECT_NONE}
              onValueChange={(value) =>
                patchAdminDraft?.({
                  job_sheet_payment_mode: value === SELECT_NONE ? "" : value
                })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_NONE}>—</SelectItem>
                {JOB_SHEET_PAYMENT_MODES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            jobSheetPaymentModeLabel(paymentMode)
          )}
        </DetailField>

        <DetailField label="Total amount">
          {formatJobSheetMoneyDisplay(totalAmount)}
        </DetailField>

        <DetailField label="Advance amount">
          {isAdmin ? (
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="h-9"
              placeholder="0.00"
              value={advanceAmountRaw}
              onChange={(e) => patchAdminDraft?.({ job_sheet_advance_amount: e.target.value })}
            />
          ) : (
            formatJobSheetMoneyDisplay(advanceAmountRaw)
          )}
        </DetailField>

        <DetailField label="Advance payment date">
          {isAdmin ? (
            <DatePicker
              id={`job-sheet-advance-date-${order.id}`}
              className="w-full"
              value={advanceDate}
              onChange={(next) => patchAdminDraft?.({ job_sheet_advance_payment_date: next })}
            />
          ) : (
            advanceDate || "—"
          )}
        </DetailField>

        <DetailField label="Advance %">
          {advancePercent > 0 ? `${advancePercent}%` : "—"}
        </DetailField>

        <DetailField label="Balance amount">
          {formatJobSheetMoneyDisplay(balanceAmount)}
        </DetailField>

        <DetailField label="Pending amount">
          {formatJobSheetMoneyDisplay(pendingAmount)}
        </DetailField>

        <DetailField label="Full paid">
          {isAdmin ? (
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`job-sheet-full-paid-${order.id}`}
                  checked={!fullPaid}
                  onChange={() =>
                    patchAdminDraft?.({
                      job_sheet_full_paid: false,
                      job_sheet_payment_closure_at: ""
                    })
                  }
                />
                No
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`job-sheet-full-paid-${order.id}`}
                  checked={fullPaid}
                  onChange={() =>
                    patchAdminDraft?.({
                      job_sheet_full_paid: true,
                      job_sheet_payment_closure_at: new Date().toISOString()
                    })
                  }
                />
                Yes
              </label>
            </div>
          ) : fullPaid ? (
            "Yes"
          ) : (
            "No"
          )}
        </DetailField>

        <DetailField label="Payment closure date">
          {fullPaid ? formatJobSheetClosureDate(closureAt) || "—" : "—"}
        </DetailField>

        <ProofUploadField
          orderId={order.id}
          inputId={`job-sheet-advance-proof-${order.id}`}
          urls={advanceProofUrls}
          prefix="Advance payment proof"
          openPreview={openPreview}
          isUploading={isUploadingPaymentProof}
          onUpload={(files) => onUploadAdvanceProof?.(order, files)}
          allowUpload={canUploadProofs}
        />

        <ProofUploadField
          orderId={order.id}
          inputId={`job-sheet-payment-proof-${order.id}`}
          urls={paymentProofUrls}
          prefix="Full payment proof"
          openPreview={openPreview}
          isUploading={isUploadingPaymentProof}
          onUpload={(files) => onUploadPaymentProof?.(order, files)}
          allowUpload={canUploadProofs}
        />

        {proofMissing ? (
          <div className="sm:col-span-2">
            <p className="text-sm text-destructive">
              Payment proof required — upload full payment proof to enable further job updates.
            </p>
          </div>
        ) : null}
      </div>

      <h4 className="pt-2 text-sm font-semibold tracking-tight">Delivery & approval</h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DetailField label="Delivery city">
          {isAdmin ? (
            <Select
              value={deliveryCity || SELECT_NONE}
              onValueChange={(value) =>
                patchAdminDraft?.({
                  job_sheet_delivery_city: value === SELECT_NONE ? "" : value
                })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select city" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={SELECT_NONE}>—</SelectItem>
                {INDIAN_CITIES.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            deliveryCity || "—"
          )}
        </DetailField>

        <DetailField label="Transport charges">
          {isAdmin ? (
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="h-9"
              placeholder="0.00"
              value={transportChargesRaw}
              onChange={(e) => patchAdminDraft?.({ job_sheet_transport_charges: e.target.value })}
            />
          ) : (
            formatJobSheetMoneyDisplay(transportChargesRaw)
          )}
        </DetailField>

        <DetailField label="Approval date">
          {isAdmin ? (
            <DatePicker
              id={`job-sheet-approval-date-${order.id}`}
              className="w-full"
              value={approvalDate}
              onChange={(next) => patchAdminDraft?.({ job_sheet_approval_date: next })}
            />
          ) : (
            approvalDate || "—"
          )}
        </DetailField>

        <DetailField label="Approved by">
          {isAdmin ? (
            <Input
              type="text"
              className="h-9"
              value={approvedBy}
              onChange={(e) => patchAdminDraft?.({ job_sheet_approved_by: e.target.value })}
            />
          ) : (
            approvedBy || "—"
          )}
        </DetailField>

        <DetailField label="Approval image" wide>
          {approvalImageUrl ? (
            <button
              type="button"
              className="approved-thumb-btn order-detail-thumb-btn order-detail-payment-screenshot-btn"
              onClick={() => openPreview([approvalImageUrl], 0)}
            >
              <img src={approvalImageUrl} alt="Approval" />
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">No approval image uploaded</p>
          )}
          {canUploadProofs ? (
            <>
              <input
                id={`job-sheet-approval-image-${order.id}`}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={isUploadingPaymentProof}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (file) void onUploadApprovalImage?.(order, file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                asChild
                disabled={isUploadingPaymentProof}
              >
                <label htmlFor={`job-sheet-approval-image-${order.id}`}>
                  {isUploadingPaymentProof
                    ? "Uploading…"
                    : approvalImageUrl
                      ? "Replace approval image"
                      : "Upload approval image"}
                </label>
              </Button>
            </>
          ) : null}
        </DetailField>
      </div>
    </section>
  );
}
