import { downloadLocalFile } from "./orderCustomerAssets";
import { STICKER_ASSET_ACCEPT } from "./stickerOrderUtils";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CreateStickerOrderForm({
  form,
  onChange,
  orderDate,
  customerAssetFiles,
  onCustomerAssetsSelected,
  removeCustomerAssetFile,
  mockupFiles = [],
  onMockupsSelected,
  removeMockupFile,
  saving = false,
  onSubmit,
  onCancel,
  variant = "sticker"
}) {
  const isSampling = variant === "sampling";
  const prefix = isSampling ? "sampling" : "sticker";
  const formClass = isSampling
    ? "create-order-form sampling-order-form"
    : "create-order-form sticker-order-form";
  const saveLabel = isSampling ? "Save sampling order" : "Save";

  function setField(patch) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(e);
  }

  return (
    <form className={formClass} onSubmit={handleSubmit}>
      <div className="order-form-cell">
        <Label htmlFor={`${prefix}-order-date`}>Order date</Label>
        <Input
          id={`${prefix}-order-date`}
          readOnly
          className="order-form-readonly-input bg-muted"
          value={orderDate}
        />
      </div>
      {isSampling ? (
        <div className="order-form-cell">
          <Label htmlFor={`${prefix}-order-id`}>Order number</Label>
          <Input
            id={`${prefix}-order-id`}
            readOnly
            className="order-form-readonly-input mono bg-muted font-mono"
            value={form.order_id || "sampling1"}
          />
        </div>
      ) : null}
      <div className={`order-form-cell${isSampling ? "" : " order-form-span-2"}`}>
        <Label htmlFor={`${prefix}-customer-name`}>Customer name</Label>
        <Input
          id={`${prefix}-customer-name`}
          value={form.customer_name}
          onChange={(e) => setField({ customer_name: e.target.value })}
          required
          autoComplete="organization"
        />
      </div>
      {isSampling ? (
        <div className="order-form-cell order-form-span-2">
          <Label htmlFor={`${prefix}-product-name`}>Product name</Label>
          <Input
            id={`${prefix}-product-name`}
            value={form.product_name}
            onChange={(e) => setField({ product_name: e.target.value })}
            placeholder="e.g. Essential Crew Tee"
            required
          />
        </div>
      ) : null}
      <div className="order-form-cell">
        <Label htmlFor={`${prefix}-qty`}>Qty</Label>
        <Input
          id={`${prefix}-qty`}
          type="number"
          min="0"
          step="1"
          value={form.qty}
          onChange={(e) => setField({ qty: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor={`${prefix}-size`}>
          {isSampling ? "Sticker sizes or artwork size" : "Size"}
        </Label>
        <Input
          id={`${prefix}-size`}
          value={form.size}
          onChange={(e) => setField({ size: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <Label htmlFor={`${prefix}-delivery-date`}>Delivery date</Label>
        <DatePicker
          id={`${prefix}-delivery-date`}
          value={form.due_date}
          onChange={(next) => setField({ due_date: next })}
          required
        />
      </div>
      {isSampling ? (
        <div className="order-form-cell order-form-cell--full">
          <Label htmlFor={`${prefix}-mockups`}>Upload mockup</Label>
          <Input
            id={`${prefix}-mockups`}
            type="file"
            accept="image/*"
            multiple
            className="order-form-asset-input"
            onChange={onMockupsSelected}
            required={mockupFiles.length === 0}
          />
          <p className="order-form-hint text-xs text-muted-foreground">PNG, JPEG, or other image files</p>
          {mockupFiles.length > 0 ? (
            <ul className="order-form-asset-list">
              {mockupFiles.map((file, index) => (
                <li key={`mockup-${file.name}-${file.size}-${index}`} className="order-form-asset-item">
                  <span className="order-form-asset-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="order-form-asset-meta">
                    {file.type || "image"}
                    {file.size ? ` · ${Math.round(file.size / 1024)} KB` : ""}
                  </span>
                  <div className="order-form-asset-actions flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadLocalFile(file)}>
                      Download
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => removeMockupFile(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="order-form-cell order-form-cell--full order-form-customer-assets">
        <Label htmlFor={`${prefix}-customer-assets`}>Upload asset</Label>
        <Input
          id={`${prefix}-customer-assets`}
          type="file"
          multiple
          accept={STICKER_ASSET_ACCEPT}
          className="order-form-asset-input"
          onChange={onCustomerAssetsSelected}
          required={customerAssetFiles.length === 0}
        />
        <p className="order-form-hint text-xs text-muted-foreground">PNG, PDF, JPEG, AI, CDR, or PSD</p>
        {customerAssetFiles.length > 0 ? (
          <ul className="order-form-asset-list">
            {customerAssetFiles.map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`} className="order-form-asset-item">
                <span className="order-form-asset-name" title={file.name}>
                  {file.name}
                </span>
                <span className="order-form-asset-meta">
                  {file.type || "file"}
                  {file.size ? ` · ${Math.round(file.size / 1024)} KB` : ""}
                </span>
                <div className="order-form-asset-actions flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => downloadLocalFile(file)}>
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => removeCustomerAssetFile(index)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="order-form-actions order-form-span-3">
        <Button type="button" variant="destructive" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="success" disabled={saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </form>
  );
}
