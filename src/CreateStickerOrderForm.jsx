import { downloadLocalFile } from "./orderCustomerAssets";
import { STICKER_ASSET_ACCEPT } from "./stickerOrderUtils";

export default function CreateStickerOrderForm({
  form,
  onChange,
  orderDate,
  customerAssetFiles,
  onCustomerAssetsSelected,
  removeCustomerAssetFile,
  saving = false,
  onSubmit,
  onCancel
}) {
  function setField(patch) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(e);
  }

  return (
    <form className="order-form order-form--modal sticker-order-form" onSubmit={handleSubmit}>
      <div className="order-form-cell">
        <label htmlFor="sticker-order-date">Order date</label>
        <input
          id="sticker-order-date"
          type="text"
          readOnly
          className="order-form-readonly-input"
          value={orderDate}
        />
      </div>
      <div className="order-form-cell order-form-span-2">
        <label htmlFor="sticker-customer-name">Customer name</label>
        <input
          id="sticker-customer-name"
          type="text"
          value={form.customer_name}
          onChange={(e) => setField({ customer_name: e.target.value })}
          required
          autoComplete="organization"
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="sticker-qty">Qty</label>
        <input
          id="sticker-qty"
          type="number"
          min="0"
          step="1"
          value={form.qty}
          onChange={(e) => setField({ qty: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="sticker-size">Size</label>
        <input
          id="sticker-size"
          type="text"
          value={form.size}
          onChange={(e) => setField({ size: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="sticker-delivery-date">Delivery date</label>
        <input
          id="sticker-delivery-date"
          type="date"
          value={form.due_date}
          onChange={(e) => setField({ due_date: e.target.value })}
          required
        />
      </div>
      <div className="order-form-cell order-form-cell--full order-form-customer-assets">
        <label htmlFor="sticker-customer-assets">Upload asset</label>
        <input
          id="sticker-customer-assets"
          type="file"
          multiple
          accept={STICKER_ASSET_ACCEPT}
          className="order-form-asset-input"
          onChange={onCustomerAssetsSelected}
          required={customerAssetFiles.length === 0}
        />
        <p className="order-form-hint">PNG, PDF, JPEG, AI, CDR, or PSD</p>
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
                <div className="order-form-asset-actions">
                  <button type="button" onClick={() => downloadLocalFile(file)}>
                    Download
                  </button>
                  <button
                    type="button"
                    className="order-form-asset-remove"
                    onClick={() => removeCustomerAssetFile(index)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="order-form-actions order-form-span-3">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="danger-btn order-form-cancel-btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
