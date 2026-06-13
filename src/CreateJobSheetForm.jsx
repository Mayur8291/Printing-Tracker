import {
  JOB_SHEET_SIZE_COLUMNS,
  JOB_SHEET_SIZE_TYPES,
  newJobSheetExtraSizeRow,
  parseJobSheetSizeQty,
  sumJobSheetSizes
} from "./jobSheetUtils";

export default function CreateJobSheetForm({
  form,
  onChange,
  salesIncharges = [],
  saving = false,
  onSubmit,
  onCancel
}) {
  const sizesSum = sumJobSheetSizes(form.sizes, form.extraSizes);
  const showBrandingType = form.branding === "yes";

  function setField(patch) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(e);
  }

  return (
    <form className="order-form order-form--modal job-sheet-form" onSubmit={handleSubmit}>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-order-id">Order ID</label>
        <input
          id="job-sheet-order-id"
          type="text"
          readOnly
          className="order-form-readonly-input"
          value={form.order_id}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-order-date">Order date</label>
        <input
          id="job-sheet-order-date"
          type="text"
          readOnly
          className="order-form-readonly-input"
          value={form.order_date}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-sales-incharge">Sales incharge</label>
        <select
          id="job-sheet-sales-incharge"
          value={form.sales_incharge_name}
          onChange={(e) => setField({ sales_incharge_name: e.target.value })}
          required
        >
          <option value="">Select sales incharge</option>
          {salesIncharges.map((row) => (
            <option key={row.id} value={row.name}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-customer">Customer name</label>
        <input
          id="job-sheet-customer"
          type="text"
          value={form.customer_name}
          onChange={(e) => setField({ customer_name: e.target.value })}
          required
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-size-type">Size type</label>
        <select
          id="job-sheet-size-type"
          value={form.size_type}
          onChange={(e) => setField({ size_type: e.target.value })}
          required
        >
          <option value="">Select size type</option>
          {JOB_SHEET_SIZE_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-rate">Rate per piece</label>
        <input
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
        <label htmlFor="job-sheet-total-qty">Total quantity</label>
        <input
          id="job-sheet-total-qty"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={sizesSum > 0 ? String(sizesSum) : "0"}
          value={form.total_quantity}
          onChange={(e) => setField({ total_quantity: e.target.value.replace(/\D/g, "") })}
          required
        />
        {sizesSum > 0 ? (
          <p className="job-sheet-form-hint">From sizes: {sizesSum} (edit above to override)</p>
        ) : null}
      </div>
      <div className="order-form-cell order-form-span-3">
        <div className="order-size-compact" aria-labelledby="job-sheet-size-heading">
          <span id="job-sheet-size-heading" className="order-size-compact-heading">
            Sizes
          </span>
          <div className="order-size-grid job-sheet-size-grid" role="group" aria-label="Pieces per size">
            {JOB_SHEET_SIZE_COLUMNS.map(({ key, label }) => (
              <div key={key} className="order-size-grid-cell">
                <span className="order-size-grid-label">{label}</span>
                <input
                  className="order-size-grid-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  placeholder="0"
                  aria-label={`Quantity ${label}`}
                  value={form.sizes[key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    onChange((prev) => ({
                      ...prev,
                      sizes: { ...prev.sizes, [key]: v },
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
          {form.extraSizes.length > 0 ? (
            <div className="order-size-extra-list" role="group" aria-label="Additional sizes">
              {form.extraSizes.map((row) => (
                <div key={row.id} className="order-size-extra-row">
                  <input
                    className="order-size-extra-label"
                    type="text"
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
                  <input
                    className="order-size-grid-input order-size-extra-qty"
                    type="text"
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
                  <button
                    type="button"
                    className="order-size-extra-remove"
                    aria-label="Remove additional size"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        extraSizes: prev.extraSizes.filter((r) => r.id !== row.id)
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="btn-add-extra-sizes"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                extraSizes: [...prev.extraSizes, newJobSheetExtraSizeRow()]
              }))
            }
          >
            + Additional sizes
          </button>
        </div>
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-product">Product name</label>
        <input
          id="job-sheet-product"
          type="text"
          value={form.product_name}
          onChange={(e) => setField({ product_name: e.target.value })}
          required
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-brand">Brand</label>
        <input
          id="job-sheet-brand"
          type="text"
          value={form.brand}
          onChange={(e) => setField({ brand: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-color">Color</label>
        <input
          id="job-sheet-color"
          type="text"
          value={form.color}
          onChange={(e) => setField({ color: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-fabric">Fabric type</label>
        <input
          id="job-sheet-fabric"
          type="text"
          value={form.fabric_type}
          onChange={(e) => setField({ fabric_type: e.target.value })}
        />
      </div>
      <div className="order-form-cell order-form-span-2">
        <span className="order-form-label" id="job-sheet-branding-legend">
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
          <label htmlFor="job-sheet-branding-type">Branding type</label>
          <input
            id="job-sheet-branding-type"
            type="text"
            value={form.branding_type}
            onChange={(e) => setField({ branding_type: e.target.value })}
          />
        </div>
      ) : null}
      <div className="order-form-cell">
        <label htmlFor="job-sheet-gsm">GSM</label>
        <input
          id="job-sheet-gsm"
          type="text"
          value={form.gsm}
          onChange={(e) => setField({ gsm: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <span className="order-form-label" id="job-sheet-atta-legend">
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
        <label htmlFor="job-sheet-comments">Comments</label>
        <textarea
          id="job-sheet-comments"
          rows={3}
          value={form.comments}
          onChange={(e) => setField({ comments: e.target.value })}
        />
      </div>
      <div className="order-form-cell">
        <label htmlFor="job-sheet-delivery-date">Delivery required on</label>
        <input
          id="job-sheet-delivery-date"
          type="date"
          value={form.delivery_required_on}
          onChange={(e) => setField({ delivery_required_on: e.target.value })}
          required
        />
      </div>
      <div className="order-form-actions order-form-span-3">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save job sheet"}
        </button>
        <button type="button" className="danger-btn order-form-cancel-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
