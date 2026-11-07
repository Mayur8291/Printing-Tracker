import { ORDER_SIZE_COLUMNS } from "./orderViewUtils";
import {
  isCssColorString,
  normalizeColorKey,
  newExtraSizeRow,
  ORDER_COLOR_PALETTE
} from "./orderAdminEditUtils";

export function OrderAdminSizeFields({ draft, onPatch }) {
  function patchSizes(key, value) {
    onPatch({ sizes: { ...draft.sizes, [key]: value } });
  }

  function patchExtraSizes(next) {
    onPatch({ extraSizes: next });
  }

  return (
    <div className="order-size-compact order-detail-admin-sizes">
      <div className="order-size-grid" role="group" aria-label="Pieces per size">
        {ORDER_SIZE_COLUMNS.map(({ key, label }) => (
          <div key={key} className="order-size-grid-cell">
            <span className="order-size-grid-label">{label}</span>
            <input
              className="order-size-grid-input order-detail-control"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              placeholder="0"
              aria-label={`Quantity ${label}`}
              value={draft.sizes?.[key] ?? ""}
              onChange={(e) => patchSizes(key, e.target.value.replace(/\D/g, ""))}
            />
          </div>
        ))}
      </div>
      {draft.extraSizes?.length > 0 ? (
        <div className="order-size-extra-list" role="group" aria-label="Extra sizes">
          {draft.extraSizes.map((row) => (
            <div key={row.id} className="order-size-extra-row">
              <input
                className="order-size-extra-label order-detail-control"
                type="text"
                placeholder="Size name"
                aria-label="Extra size name"
                autoCapitalize="characters"
                spellCheck={false}
                value={row.label}
                onChange={(e) => {
                  const label = e.target.value.toUpperCase();
                  patchExtraSizes(
                    draft.extraSizes.map((r) => (r.id === row.id ? { ...r, label } : r))
                  );
                }}
              />
              <input
                className="order-size-grid-input order-size-extra-qty order-detail-control"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                placeholder="0"
                aria-label={`Quantity ${row.label || "extra size"}`}
                value={row.qty}
                onChange={(e) => {
                  const qty = e.target.value.replace(/\D/g, "");
                  patchExtraSizes(
                    draft.extraSizes.map((r) => (r.id === row.id ? { ...r, qty } : r))
                  );
                }}
              />
              <button
                type="button"
                className="order-size-extra-remove"
                aria-label="Remove extra size"
                onClick={() => patchExtraSizes(draft.extraSizes.filter((r) => r.id !== row.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="order-size-extra-add"
        onClick={() => patchExtraSizes([...(draft.extraSizes ?? []), newExtraSizeRow()])}
      >
        + Add size
      </button>
    </div>
  );
}

export function OrderAdminColorField({ colors, onChange }) {
  function toggleColor(hex) {
    const key = hex.toLowerCase();
    const exists = colors.some((c) => normalizeColorKey(c) === key);
    onChange(
      exists ? colors.filter((c) => normalizeColorKey(c) !== key) : [...colors, hex]
    );
  }

  function removeColor(color) {
    onChange(colors.filter((item) => item !== color));
  }

  return (
    <div className="order-detail-admin-colors">
      <div className="color-palette color-palette--compact" role="group" aria-label="Color swatches">
        {ORDER_COLOR_PALETTE.map((hex, swatchIdx) => {
          const selected = colors.some((c) => normalizeColorKey(c) === hex);
          return (
            <button
              key={`admin-swatch-${swatchIdx}`}
              type="button"
              className={`color-palette-swatch ${selected ? "is-selected" : ""}`}
              style={{ backgroundColor: hex, backgroundImage: "none" }}
              aria-label={selected ? `${hex}, selected` : hex}
              aria-pressed={selected}
              onClick={() => toggleColor(hex)}
            >
              {selected ? (
                <span className="color-palette-check" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {colors.length > 0 ? (
        <div className="color-chips color-chips--in-panel" aria-label="Selected colors">
          {colors.map((color, i) => (
            <span key={`${color}-${i}`} className="color-chip color-chip--picked">
              {isCssColorString(color) ? (
                <span
                  className="color-chip-swatch"
                  style={{ backgroundColor: color, backgroundImage: "none" }}
                  aria-hidden
                />
              ) : null}
              <span className="color-chip-code">{color}</span>
              <button type="button" className="color-chip-remove" onClick={() => removeColor(color)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="order-detail-muted">Pick at least one color before save.</p>
      )}
    </div>
  );
}
