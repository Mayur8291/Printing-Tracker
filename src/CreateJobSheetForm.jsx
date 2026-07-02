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

export default function CreateJobSheetForm({
  form,
  onChange,
  salesIncharges = [],
  onAddSalesIncharge,
  saving = false,
  onSubmit,
  onCancel
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
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={sizesSum > 0 ? String(sizesSum) : "0"}
          value={form.total_quantity}
          onChange={(e) => setField({ total_quantity: e.target.value.replace(/\D/g, "") })}
          required
        />
        {sizesSum > 0 ? (
          <p className="job-sheet-form-hint text-xs text-muted-foreground">From sizes: {sizesSum} (edit above to override)</p>
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
                      sizes: { ...prev.sizes, [col.key]: v },
                      total_quantity:
                        prev.total_quantity === "" || prev.total_quantity === String(sizesSum)
                          ? ""
                          : prev.total_quantity
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
