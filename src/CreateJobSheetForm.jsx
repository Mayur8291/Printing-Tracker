import { useMemo } from "react";
import {
  formatJobSheetSizeColumnHeader,
  filterJobSheetSizeTypes,
  getJobSheetActiveColumns,
  getJobSheetProductTypeOptions,
  getJobSheetSizeColumnsForType,
  isPetsJobSheetGender,
  JOB_SHEET_GENDERS,
  newJobSheetExtraSizeRow,
  sumJobSheetSizes
} from "./jobSheetUtils";
import { INDIAN_CITIES } from "./indianCities";
import {
  calcJobSheetAdvancePercent,
  calcJobSheetBalanceAmount,
  calcJobSheetTotalAmount,
  formatJobSheetClosureDate,
  formatJobSheetMoneyDisplay,
  JOB_SHEET_PAYMENT_MODES
} from "./jobSheetPaymentUtils";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import MasterListSelectField from "@/components/admin/MasterListSelectField";
import JobSheetRegularStockField from "./JobSheetRegularStockField";

export default function CreateJobSheetForm({
  form,
  onChange,
  salesIncharges = [],
  onAddSalesIncharge,
  saving = false,
  onSubmit,
  onCancel,
  advanceProofFiles = [],
  onAdvanceProofFilesChange,
  paymentProofFiles = [],
  onPaymentProofFilesChange,
  approvalImageFile = null,
  onApprovalImageFileChange,
  inventoryProducts = [],
  loadingInventoryProducts = false
}) {
  const sizesSum = sumJobSheetSizes(form.sizes, form.extraSizes, form.size_type, form.gender);
  const sizeColumns = getJobSheetActiveColumns({ gender: form.gender, sizeType: form.size_type });
  const productTypeOptions = getJobSheetProductTypeOptions(form.gender);
  const sizeTypeOptions = filterJobSheetSizeTypes({
    gender: form.gender,
    productType: form.product_type
  });
  const showSizeGrid = isPetsJobSheetGender(form.gender) || Boolean(form.size_type);
  const showBrandingType = form.branding === "yes";
  const showRegularStock = form.regular_stock === "yes";
  const computedTotalAmount = useMemo(
    () => calcJobSheetTotalAmount(form.rate_per_piece, sizesSum),
    [form.rate_per_piece, sizesSum]
  );
  const totalAmountValue =
    computedTotalAmount != null ? String(computedTotalAmount) : "";
  const advancePercent = useMemo(
    () => calcJobSheetAdvancePercent(totalAmountValue, form.advance_amount),
    [totalAmountValue, form.advance_amount]
  );
  const balancePendingAmount = useMemo(() => {
    if (form.full_paid === "yes") return 0;
    return calcJobSheetBalanceAmount(totalAmountValue, form.advance_amount);
  }, [totalAmountValue, form.advance_amount, form.full_paid]);
  const paymentProofRequired = form.full_paid === "yes";

  function applySizeType(sizeType) {
    const cols = getJobSheetSizeColumnsForType(sizeType);
    onChange((prev) => ({
      ...prev,
      size_type: sizeType,
      sizes: Object.fromEntries(cols.map(({ key }) => [key, ""])),
      extraSizes: []
    }));
  }

  function setField(patch) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(e);
  }

  return (
    <form className="create-order-form job-sheet-form" onSubmit={handleSubmit}>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-order-id">Order ID</Label>
        <Input id="job-sheet-order-id" readOnly className="order-form-readonly-input bg-muted" value={form.order_id} />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-order-date">Order date</Label>
        <Input id="job-sheet-order-date" readOnly className="order-form-readonly-input bg-muted" value={form.order_date} />
      </div>
      <div className="order-form-cell">
        <MasterListSelectField
          id="job-sheet-sales-incharge"
          label="Sales incharge"
          value={form.sales_incharge_name}
          onValueChange={(value) => setField({ sales_incharge_name: value })}
          options={salesIncharges.map((row) => ({ value: row.name, label: row.name }))}
          onAdd={onAddSalesIncharge}
          placeholder="Select sales incharge"
          addPlaceholder="Sales incharge name"
          required
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-customer">Customer name</Label>
        <Input
          id="job-sheet-customer"
          value={form.customer_name}
          onChange={(e) => setField({ customer_name: e.target.value })}
          required
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-gender">Gender</Label>
        <Select
          value={form.gender || undefined}
          onValueChange={(value) => {
            if (value === "pets") {
              onChange((prev) => ({
                ...prev,
                gender: value,
                product_type: "",
                size_type: "pets",
                sizes: Object.fromEntries(
                  getJobSheetActiveColumns({ gender: value, sizeType: "pets" }).map(({ key }) => [key, ""])
                ),
                extraSizes: []
              }));
              return;
            }
            const products = getJobSheetProductTypeOptions(value);
            const autoProduct = products.length === 1 ? products[0].value : "";
            const sizeMatches = filterJobSheetSizeTypes({
              gender: value,
              productType: autoProduct
            });
            const autoSize = sizeMatches.length === 1 ? sizeMatches[0].value : "";
            onChange((prev) => ({
              ...prev,
              gender: value,
              product_type: autoProduct,
              size_type: autoSize,
              sizes: Object.fromEntries(
                getJobSheetSizeColumnsForType(autoSize).map(({ key }) => [key, ""])
              ),
              extraSizes: []
            }));
          }}
          required
        >
          <SelectTrigger id="job-sheet-gender">
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            {JOB_SHEET_GENDERS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {form.gender !== "pets" ? (
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-product-type">Product type</Label>
        <Select
          value={form.product_type || undefined}
          onValueChange={(value) => {
            const sizeMatches = filterJobSheetSizeTypes({
              gender: form.gender,
              productType: value
            });
            const autoSize = sizeMatches.length === 1 ? sizeMatches[0].value : "";
            onChange((prev) => ({
              ...prev,
              product_type: value,
              size_type: autoSize,
              sizes: Object.fromEntries(
                getJobSheetSizeColumnsForType(autoSize).map(({ key }) => [key, ""])
              ),
              extraSizes: []
            }));
          }}
          disabled={!form.gender}
          required
        >
          <SelectTrigger id="job-sheet-product-type">
            <SelectValue placeholder={form.gender ? "Select product type" : "Select gender first"} />
          </SelectTrigger>
          <SelectContent>
            {productTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      ) : null}
      {!isPetsJobSheetGender(form.gender) ? (
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-size-type">Size type</Label>
        <Select
          value={form.size_type || undefined}
          onValueChange={applySizeType}
          disabled={!form.gender || !form.product_type}
          required
        >
          <SelectTrigger id="job-sheet-size-type">
            <SelectValue
              placeholder={
                !form.gender
                  ? "Select gender first"
                  : !form.product_type
                    ? "Select product type first"
                    : "Select size type"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {sizeTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      ) : null}
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-rate">Rate per piece</Label>
        <Input
          id="job-sheet-rate"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
          value={form.rate_per_piece}
          onChange={(e) => setField({ rate_per_piece: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-total-qty">Total quantity</Label>
        <Input
          id="job-sheet-total-qty"
          readOnly
          className="order-form-readonly-input bg-muted"
          placeholder="0"
          value={sizesSum > 0 ? String(sizesSum) : ""}
          aria-label="Total quantity from size breakdown"
        />
        {sizesSum > 0 ? (
          <p className="job-sheet-form-hint text-xs text-muted-foreground">Sum of sizes below</p>
        ) : null}
      </div>
      <div className="order-form-cell order-form-span-3">
        <div className="order-size-compact" aria-labelledby="job-sheet-size-heading">
          <span id="job-sheet-size-heading" className="order-size-compact-heading text-sm font-medium">
            Sizes
          </span>
          {!showSizeGrid ? (
            <p className="text-xs text-muted-foreground">Select gender and size type above to show the size grid.</p>
          ) : (
          <div className="order-size-grid job-sheet-size-grid" role="group" aria-label="Pieces per size">
            {sizeColumns.map((col) => (
              <div key={col.key} className="order-size-grid-cell">
                <span className="order-size-grid-label text-xs text-muted-foreground" title={col.template ? `Size template: ${col.template}` : undefined}>
                  {formatJobSheetSizeColumnHeader(col)}
                </span>
                <Input
                  className="order-size-grid-input h-8"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  placeholder="0"
                  aria-label={`Quantity ${col.sizeLabel}`}
                  value={form.sizes[col.key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    onChange((prev) => ({
                      ...prev,
                      sizes: { ...prev.sizes, [col.key]: v }
                    }));
                  }}
                />
              </div>
            ))}
          </div>
          )}
          {form.extraSizes.length > 0 ? (
            <div className="order-size-extra-list" role="group" aria-label="Additional sizes">
              {form.extraSizes.map((row) => (
                <div key={row.id} className="order-size-extra-row flex items-center gap-2">
                  <Input
                    className="order-size-extra-label h-8"
                    placeholder="Size name"
                    aria-label="Additional size name"
                    value={row.label}
                    onChange={(e) => {
                      const label = e.target.value.toUpperCase();
                      onChange((prev) => ({
                        ...prev,
                        extraSizes: prev.extraSizes.map((r) =>
                          r.id === row.id ? { ...r, label } : r
                        )
                      }));
                    }}
                  />
                  <Input
                    className="order-size-grid-input order-size-extra-qty h-8 w-20"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={5}
                    placeholder="0"
                    aria-label={`Quantity ${row.label || "additional size"}`}
                    value={row.qty}
                    onChange={(e) => {
                      const qty = e.target.value.replace(/\D/g, "");
                      onChange((prev) => ({
                        ...prev,
                        extraSizes: prev.extraSizes.map((r) =>
                          r.id === row.id ? { ...r, qty } : r
                        )
                      }));
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="order-size-extra-remove size-8 shrink-0"
                    aria-label="Remove additional size"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        extraSizes: prev.extraSizes.filter((r) => r.id !== row.id)
                      }))
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="btn-add-extra-sizes mt-2"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                extraSizes: [...prev.extraSizes, newJobSheetExtraSizeRow()]
              }))
            }
          >
            + Additional sizes
          </Button>
        </div>
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-product">Product name</Label>
        <Input
          id="job-sheet-product"
          value={form.product_name}
          onChange={(e) => setField({ product_name: e.target.value })}
          required
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-brand">Brand</Label>
        <Input id="job-sheet-brand" value={form.brand} onChange={(e) => setField({ brand: e.target.value })} />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-color">Color</Label>
        <Input id="job-sheet-color" value={form.color} onChange={(e) => setField({ color: e.target.value })} />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-fabric">Fabric type</Label>
        <Input id="job-sheet-fabric" value={form.fabric_type} onChange={(e) => setField({ fabric_type: e.target.value })} />
      </div>
      <div className="order-form-cell order-form-span-2">
        <span className="order-form-label text-sm font-medium" id="job-sheet-branding-legend">
          Branding
        </span>
        <div className="order-form-radio-row" role="group" aria-labelledby="job-sheet-branding-legend">
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_branding"
              checked={form.branding === "no"}
              onChange={() => setField({ branding: "no", branding_type: "" })}
            />
            No
          </label>
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_branding"
              checked={form.branding === "yes"}
              onChange={() => setField({ branding: "yes" })}
            />
            Yes
          </label>
        </div>
      </div>
      {showBrandingType ? (
        <div className="order-form-cell">
          <Label htmlFor="job-sheet-branding-type">Branding type</Label>
          <Input
            id="job-sheet-branding-type"
            value={form.branding_type}
            onChange={(e) => setField({ branding_type: e.target.value })}
          />
        </div>
      ) : null}
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-gsm">GSM</Label>
        <Input id="job-sheet-gsm" value={form.gsm} onChange={(e) => setField({ gsm: e.target.value })} />
      </div>
      <div className="order-form-cell">
        <span className="order-form-label text-sm font-medium" id="job-sheet-atta-legend">
          Atta
        </span>
        <div className="order-form-radio-row" role="group" aria-labelledby="job-sheet-atta-legend">
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_atta"
              checked={form.atta === "no"}
              onChange={() => setField({ atta: "no" })}
            />
            No
          </label>
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_atta"
              checked={form.atta === "yes"}
              onChange={() => setField({ atta: "yes" })}
            />
            Yes
          </label>
        </div>
      </div>
      <div className="order-form-cell">
        <span className="order-form-label text-sm font-medium" id="job-sheet-regular-stock-legend">
          Regular stock
        </span>
        <div className="order-form-radio-row" role="group" aria-labelledby="job-sheet-regular-stock-legend">
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_regular_stock"
              checked={form.regular_stock === "no"}
              onChange={() => setField({ regular_stock: "no", regularStockItems: [] })}
            />
            No
          </label>
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_regular_stock"
              checked={form.regular_stock === "yes"}
              onChange={() => setField({ regular_stock: "yes" })}
            />
            Yes
          </label>
        </div>
      </div>
      {showRegularStock ? (
        <div className="order-form-cell order-form-span-3">
          <JobSheetRegularStockField
            items={form.regularStockItems}
            onChange={(next) =>
              onChange((prev) => ({
                ...prev,
                regularStockItems: typeof next === "function" ? next(prev.regularStockItems) : next
              }))
            }
            products={inventoryProducts}
            loading={loadingInventoryProducts}
          />
        </div>
      ) : null}
      <div className="order-form-cell order-form-span-3">
        <Label htmlFor="job-sheet-comments">Comments</Label>
        <Textarea
          id="job-sheet-comments"
          rows={3}
          value={form.comments}
          onChange={(e) => setField({ comments: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-delivery-date">Delivery required on</Label>
        <DatePicker
          id="job-sheet-delivery-date"
          value={form.delivery_required_on}
          onChange={(next) => setField({ delivery_required_on: next })}
          required
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-payment-mode">Mode of payment</Label>
        <Select
          value={form.payment_mode || undefined}
          onValueChange={(value) => setField({ payment_mode: value })}
        >
          <SelectTrigger id="job-sheet-payment-mode">
            <SelectValue placeholder="Select payment mode" />
          </SelectTrigger>
          <SelectContent>
            {JOB_SHEET_PAYMENT_MODES.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-total-amount">Total amount</Label>
        <Input
          id="job-sheet-total-amount"
          readOnly
          className="order-form-readonly-input bg-muted"
          placeholder="0.00"
          value={totalAmountValue}
          aria-label="Total amount (rate per piece × total quantity)"
        />
        {sizesSum > 0 && form.rate_per_piece ? (
          <p className="job-sheet-form-hint text-xs text-muted-foreground">
            Rate × qty ({formatJobSheetMoneyDisplay(form.rate_per_piece)} × {sizesSum})
          </p>
        ) : null}
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-advance-amount">Advance amount received</Label>
        <div className="flex items-center gap-2">
          <Input
            id="job-sheet-advance-amount"
            className="flex-1"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={form.advance_amount}
            onChange={(e) => setField({ advance_amount: e.target.value })}
          />
          {advancePercent > 0 ? (
            <span className="shrink-0 text-sm font-medium text-muted-foreground" aria-label="Advance percentage">
              {advancePercent}%
            </span>
          ) : null}
        </div>
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-advance-date">Advance payment date</Label>
        <DatePicker
          id="job-sheet-advance-date"
          value={form.advance_payment_date}
          onChange={(next) => setField({ advance_payment_date: next })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-advance-proof">Transaction proof upload</Label>
        <Input
          id="job-sheet-advance-proof"
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={(e) => onAdvanceProofFilesChange?.(Array.from(e.target.files ?? []))}
        />
        {advanceProofFiles.length > 0 ? (
          <p className="order-form-file-name text-xs text-muted-foreground">
            Selected: {advanceProofFiles.map((f) => f.name).join(", ")}
          </p>
        ) : null}
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-balance-pending-amount">Balance / Pending amount</Label>
        <Input
          id="job-sheet-balance-pending-amount"
          readOnly
          className="order-form-readonly-input bg-muted"
          value={formatJobSheetMoneyDisplay(balancePendingAmount)}
          aria-label={`Balance / Pending amount ${formatJobSheetMoneyDisplay(balancePendingAmount)}`}
        />
      </div>
      <div className="order-form-cell">
        <span className="order-form-label text-sm font-medium" id="job-sheet-full-paid-legend">
          Full paid
        </span>
        <div className="order-form-radio-row" role="group" aria-labelledby="job-sheet-full-paid-legend">
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_full_paid"
              checked={form.full_paid === "no"}
              onChange={() => setField({ full_paid: "no", payment_closure_at: "" })}
            />
            No
          </label>
          <label className="order-form-radio-label">
            <input
              type="radio"
              name="job_sheet_full_paid"
              checked={form.full_paid === "yes"}
              onChange={() =>
                setField({
                  full_paid: "yes",
                  payment_closure_at: new Date().toISOString()
                })
              }
            />
            Yes
          </label>
        </div>
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-payment-closure-date">Payment closure date</Label>
        <Input
          id="job-sheet-payment-closure-date"
          readOnly
          className="order-form-readonly-input bg-muted"
          placeholder="Auto when full payment is done"
          value={form.full_paid === "yes" ? formatJobSheetClosureDate(form.payment_closure_at) : ""}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-payment-proof">
          Payment proof
          {paymentProofRequired ? <span className="text-destructive"> *</span> : null}
        </Label>
        <Input
          id="job-sheet-payment-proof"
          type="file"
          accept="image/*,.pdf"
          multiple
          required={paymentProofRequired}
          aria-required={paymentProofRequired}
          onChange={(e) => onPaymentProofFilesChange?.(Array.from(e.target.files ?? []))}
        />
        {paymentProofRequired && paymentProofFiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">Required when full paid is Yes.</p>
        ) : null}
        {paymentProofFiles.length > 0 ? (
          <p className="order-form-file-name text-xs text-muted-foreground">
            Selected: {paymentProofFiles.map((f) => f.name).join(", ")}
          </p>
        ) : null}
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-delivery-city">Delivery city</Label>
        <Select
          value={form.delivery_city || undefined}
          onValueChange={(value) => setField({ delivery_city: value })}
        >
          <SelectTrigger id="job-sheet-delivery-city">
            <SelectValue placeholder="Select city" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {INDIAN_CITIES.map((city) => (
              <SelectItem key={city} value={city}>
                {city}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-transport-charges">Transport charges</Label>
        <Input
          id="job-sheet-transport-charges"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
          value={form.transport_charges}
          onChange={(e) => setField({ transport_charges: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-approval-date">Approval date</Label>
        <DatePicker
          id="job-sheet-approval-date"
          value={form.approval_date}
          onChange={(next) => setField({ approval_date: next })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-approval-image">Approval image upload</Label>
        <Input
          id="job-sheet-approval-image"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            onApprovalImageFileChange?.(file);
          }}
        />
        {approvalImageFile ? (
          <p className="order-form-file-name text-xs text-muted-foreground">Selected: {approvalImageFile.name}</p>
        ) : null}
      </div>
      <div className="order-form-cell">
        <Label htmlFor="job-sheet-approved-by">Approved by</Label>
        <Input
          id="job-sheet-approved-by"
          value={form.approved_by}
          onChange={(e) => setField({ approved_by: e.target.value })}
          placeholder="Name of approver"
        />
      </div>
      <div className="order-form-actions order-form-span-3">
        <Button type="button" variant="destructive" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="success" disabled={saving}>
          {saving ? "Saving…" : "Save job sheet"}
        </Button>
      </div>
    </form>
  );
}
