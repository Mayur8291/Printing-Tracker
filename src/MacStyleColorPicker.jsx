import { useEffect, useMemo, useState } from "react";
import {
  buildMacColorGrid,
  colorCssValue,
  isCssColorString,
  loadColorPresets,
  MAC_COLOR_GRID_COLS,
  normalizeColorKey,
  saveColorPreset,
  swatchBackgroundForColor,
  toggleColorInList
} from "./orderColorUtils";
import "./macStyleColorPicker.css";

export default function MacStyleColorPicker({
  open,
  colors = [],
  onChange,
  onClose,
  popoverId = "mac-color-picker"
}) {
  const grid = useMemo(() => buildMacColorGrid(), []);
  const [presets, setPresets] = useState(() => loadColorPresets());
  const [workingHex, setWorkingHex] = useState("#007aff");

  useEffect(() => {
    if (!open) return;
    setPresets(loadColorPresets());
    const first = colors.find((c) => isCssColorString(c));
    if (first) {
      setWorkingHex(String(first).slice(0, 7));
    }
  }, [open, colors]);

  function handleGridClick(hex) {
    onChange?.(toggleColorInList(colors, hex, 100));
    setWorkingHex(hex);
  }

  function handleAddPreset() {
    setPresets(saveColorPreset(workingHex));
    if (!colors.some((c) => normalizeColorKey(c) === normalizeColorKey(workingHex))) {
      onChange?.([...colors, workingHex]);
    }
  }

  function handlePresetClick(color) {
    setWorkingHex(String(color).slice(0, 7));
    onChange?.(toggleColorInList(colors, color, 100));
  }

  if (!open) return null;

  return (
    <div
      id={popoverId}
      className="mac-color-picker"
      role="dialog"
      aria-label="Colors"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mac-color-picker__pointer" aria-hidden />

      <header className="mac-color-picker__header">
        <span className="mac-color-picker__title">Colors</span>
        <button type="button" className="mac-color-picker__icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="mac-color-picker__body">
        <div
          className="mac-color-picker__grid"
          style={{ gridTemplateColumns: `repeat(${MAC_COLOR_GRID_COLS}, 1fr)` }}
          role="group"
          aria-label="Color grid"
        >
          {grid.map((hex, index) => {
            const selected = colors.some((c) => normalizeColorKey(c) === normalizeColorKey(hex));
            return (
              <button
                key={`${hex}-${index}`}
                type="button"
                className={`mac-color-picker__swatch${selected ? " is-selected" : ""}`}
                style={{ background: hex, backgroundImage: "none" }}
                aria-label={hex}
                aria-pressed={selected}
                onClick={() => handleGridClick(hex)}
              />
            );
          })}
        </div>
      </div>

      <footer className="mac-color-picker__footer">
        <div
          className="mac-color-picker__preview"
          style={{ background: workingHex }}
          title={workingHex}
        />
        <div className="mac-color-picker__presets">
          {colors.map((color, index) => (
            <button
              key={`sel-${color}-${index}`}
              type="button"
              className="mac-color-picker__preset is-selected-order"
              style={{ background: swatchBackgroundForColor(color) }}
              title={color}
              aria-label={`Selected ${color}`}
              onClick={() => onChange?.(colors.filter((_, i) => i !== index))}
            />
          ))}
          {presets
            .filter((p) => !colors.some((c) => normalizeColorKey(c) === normalizeColorKey(p)))
            .map((color) => (
              <button
                key={`preset-${color}`}
                type="button"
                className="mac-color-picker__preset"
                style={{ background: colorCssValue(color) }}
                title={color}
                aria-label={color}
                onClick={() => handlePresetClick(color)}
              />
            ))}
          <button
            type="button"
            className="mac-color-picker__preset mac-color-picker__preset--add"
            aria-label="Save color to presets"
            onClick={handleAddPreset}
          >
            +
          </button>
        </div>
      </footer>
    </div>
  );
}
