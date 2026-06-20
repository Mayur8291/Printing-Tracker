/** HSL (0–360, 0–100, 0–100) → #rrggbb */
export function hslToHex(h, s, l) {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  let r;
  let g;
  let b;
  if (sat === 0) {
    r = g = b = light;
  } else {
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }
  const toHex = (x) =>
    Math.round(Math.min(255, Math.max(0, x * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
}

export const MAC_COLOR_GRID_COLS = 12;

/** macOS-style grid: grayscale row + spectrum rows (12 columns). */
export function buildMacColorGrid() {
  const cols = MAC_COLOR_GRID_COLS;
  const colors = [];
  for (let c = 0; c < cols; c += 1) {
    const lightness = Math.round((c / (cols - 1)) * 100);
    colors.push(hslToHex(0, 0, lightness));
  }
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const hue = (col / cols) * 360;
      const sat = 62 + (row % 4) * 8;
      const light = 90 - row * 7;
      colors.push(hslToHex(hue, Math.min(100, sat), Math.max(12, Math.min(92, light))));
    }
  }
  return colors;
}

export const MAC_COLOR_GRID = buildMacColorGrid();

/** @deprecated use MAC_COLOR_GRID */
export const ORDER_COLOR_PALETTE = MAC_COLOR_GRID;

export function normalizeColorKey(c) {
  return String(c ?? "")
    .trim()
    .toLowerCase();
}

export function isCssColorString(c) {
  const s = String(c ?? "").trim();
  return (
    /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ||
    /^hsla?\(/i.test(s) ||
    /^rgba?\(/i.test(s)
  );
}

export function swatchBackgroundForColor(c) {
  const t = String(c ?? "").trim();
  if (!t) return "#cbd5e1";
  if (isCssColorString(t)) return t;
  return t;
}

export function hexToRgb(hex) {
  const raw = String(hex ?? "").trim().replace("#", "");
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16)
    };
  }
  if (raw.length >= 6) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16)
    };
  }
  return { r: 255, g: 255, b: 255 };
}

export function rgbToHex(r, g, b) {
  const to = (n) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toLowerCase();
}

export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
        break;
    }
  }
  return { h, s: s * 100, l: l * 100 };
}

export function applyAlphaToHex(hex, alphaPercent) {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.min(100, Math.max(0, Number(alphaPercent))) / 100;
  const alpha = Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
  return `${rgbToHex(r, g, b)}${alpha}`;
}

export function colorCssValue(hex, alphaPercent = 100) {
  const a = Math.min(100, Math.max(0, Number(alphaPercent))) / 100;
  if (a >= 0.999) return hex;
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}

export function toggleColorInList(colors, hex, alphaPercent = 100) {
  const value =
    alphaPercent >= 99.5 ? hex.toLowerCase() : applyAlphaToHex(hex, alphaPercent).toLowerCase();
  const key = normalizeColorKey(value);
  const exists = colors.some((c) => normalizeColorKey(c) === key);
  if (exists) return colors.filter((c) => normalizeColorKey(c) !== key);
  return [...colors, value];
}

const PRESET_STORAGE_KEY = "scott-order-color-presets";

export function loadColorPresets() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function saveColorPreset(hex) {
  const key = normalizeColorKey(hex);
  if (!key) return loadColorPresets();
  const next = [hex, ...loadColorPresets().filter((c) => normalizeColorKey(c) !== key)].slice(0, 12);
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
