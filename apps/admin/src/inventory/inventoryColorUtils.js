const NAMED_COLORS = [
  ["NAVY BLUE", "#1a2f4a"],
  ["TRUE NAVY", "#1a2f4a"],
  ["NAVY MELANGE", "#2c3e50"],
  ["NAVY", "#1a2f4a"],
  ["ROYAL BLUE", "#2563eb"],
  ["ROYAL BLUE MELANGE", "#3b6fc7"],
  ["ELECTRIC BLUE", "#3b82f6"],
  ["IMPERIAL BLUE", "#0047ab"],
  ["DECCAN BLUE", "#1e40af"],
  ["WIPRO BLUE", "#0066cc"],
  ["SPACE BLUE", "#1e3a8a"],
  ["STRONG BLUE", "#1d4ed8"],
  ["INDIAN BLUE", "#4f46e5"],
  ["DENIM BLUE", "#3b5998"],
  ["LIGHT BLUE", "#93c5fd"],
  ["SKY BLUE", "#7dd3fc"],
  ["ICE BLUE", "#a5f3fc"],
  ["AQUA BLUE", "#22d3ee"],
  ["TURQUOISE BLUE", "#06b6d4"],
  ["BOTTLE GREEN", "#1b4332"],
  ["MILITARY GREEN", "#4b5320"],
  ["MOSS GREEN", "#606c38"],
  ["DECCAN GREEN", "#15803d"],
  ["PARROT GREEN", "#22c55e"],
  ["APPLE GREEN", "#84cc16"],
  ["ELECTRIC GREEN", "#10b981"],
  ["TURQUOISE GREEN", "#14b8a6"],
  ["OLIVE GREEN", "#6b7c3e"],
  ["OLIVE YELLOW", "#9ca347"],
  ["FLOUROCENT GREEN", "#39ff14"],
  ["FLUORESCENT GREEN", "#39ff14"],
  ["CHARCOAL GREY", "#4a4a4a"],
  ["CHARCOAL MELANGE", "#5c5c5c"],
  ["CHARCOAL", "#36454f"],
  ["DARK GREY", "#4b5563"],
  ["GREY MELANGE", "#9ca3af"],
  ["STEEL GREY", "#71797e"],
  ["COFFEE BROWN", "#6f4e37"],
  ["GOLDEN YELLOW", "#fbbf24"],
  ["BANANA YELLOW", "#fde047"],
  ["LEMON YELLOW", "#fef08a"],
  ["SUNSHINE YELLOW", "#fcd34d"],
  ["CRICKET IVORY", "#fffff0"],
  ["OFF WHITE", "#faf9f6"],
  ["PLAIN WHITE", "#f5f5f5"],
  ["WHITE MELANGE", "#e8e8e8"],
  ["WHITE ABSTRACT", "#f0f0f0"],
  ["WHITE", "#f5f5f5"],
  ["PLAIN BLACK", "#1a1a1a"],
  ["BLACK MELANGE", "#2d2d2d"],
  ["BLACK", "#1a1a1a"],
  ["RACING RED", "#ef4444"],
  ["RED MELANGE", "#c53030"],
  ["RED", "#dc2626"],
  ["MAROON MELANGE", "#8b2e2e"],
  ["MAROON", "#7f1d1d"],
  ["WOODY ORANGE", "#c2410c"],
  ["ANTHARA MELANGE", "#8b7355"],
  ["BU GR CH", "#2563eb"],
  ["BU", "#2563eb"],
  ["GR", "#16a34a"],
  ["CH", "#36454f"],
  ["GREEN", "#16a34a"],
  ["BROWN", "#78350f"],
  ["BEIGE", "#d4b896"],
  ["CREAM", "#fffdd0"],
  ["YELLOW", "#eab308"],
  ["WINE", "#722f37"],
  ["RUST", "#b7410e"],
  ["ORANGE", "#f97316"],
  ["PEACH", "#fdba74"],
  ["PINK MELANGE", "#e879a8"],
  ["PINK", "#ec4899"],
  ["LAVENDER", "#c4b5fd"],
  ["PURPLE", "#9333ea"],
  ["SAND", "#c2b280"],
  ["CLAY", "#b66a50"],
  ["ONION", "#e8dcc8"],
  ["ALUMINIUM", "#a8a9ad"],
  ["MINT", "#98fb98"],
  ["GREY", "#9ca3af"],
  ["GRAY", "#9ca3af"],
  ["BLUE", "#3b82f6"],
  ["SILVER", "#c0c0c0"],
  ["REFLECTOR", "#d1d5db"]
];

const CAMO_GRADIENT =
  "linear-gradient(135deg, #4b5320 0%, #4b5320 20%, #3d4f2f 20%, #3d4f2f 40%, #6b7c3e 40%, #6b7c3e 60%, #2d3a1f 60%, #2d3a1f 80%, #556b2f 80%)";

const MULTI_GRADIENT =
  "linear-gradient(to bottom, #ef4444 0%, #f97316 20%, #eab308 40%, #22c55e 60%, #3b82f6 80%, #9333ea 100%)";

const DEFAULT_HEX = "#cccccc";

function normalizeLabel(label) {
  return String(label ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\bWIH\b/g, "WITH")
    .replace(/\s+-\s+PLAIN\b/g, "")
    .replace(/\bPLAIN\b/g, "")
    .replace(/\s+TIPPING\b/g, "")
    .replace(/\s+ZIP\b/g, "");
}

function findColorInText(text) {
  const upper = normalizeLabel(text);
  if (!upper) return null;

  for (const [name, hex] of NAMED_COLORS) {
    if (upper.includes(name)) return hex;
  }

  const tokens = upper.split(/[\s/\-]+/).filter(Boolean);
  for (const token of tokens) {
    for (const [name, hex] of NAMED_COLORS) {
      if (name === token || name.replace(/\s+/g, "") === token.replace(/\s+/g, "")) return hex;
    }
  }

  return null;
}

function melangeShade(hex) {
  return `linear-gradient(135deg, ${hex} 0%, ${hex} 45%, rgba(255,255,255,0.22) 45%, rgba(255,255,255,0.22) 55%, ${hex} 55%)`;
}

export function colorLabelToHex(label) {
  const swatch = resolveColorSwatch(label);
  return swatch.primary || DEFAULT_HEX;
}

export function resolveColorSwatch(label, fallbackHex) {
  const raw = String(label ?? "").trim();
  const normalized = normalizeLabel(raw);

  if (!normalized) {
    return { type: "solid", primary: fallbackHex || DEFAULT_HEX, background: fallbackHex || DEFAULT_HEX };
  }

  if (normalized.includes("CAMOUFLAGE")) {
    return { type: "camo", primary: "#4b5320", background: CAMO_GRADIENT };
  }

  if (normalized.includes("MULTICOLOR")) {
    return { type: "multi", primary: "#3b82f6", background: MULTI_GRADIENT };
  }

  if (normalized === "BU-GR-CH" || normalized === "BU GR CH") {
    return {
      type: "tipped",
      primary: "#2563eb",
      accent: "#36454f",
      background: "linear-gradient(to bottom, #2563eb 0%, #2563eb 45%, #16a34a 45%, #16a34a 72%, #36454f 72%, #36454f 100%)"
    };
  }

  const withParts = normalized.split(/\s+WITH\s+/);
  if (withParts.length >= 2) {
    const primary = findColorInText(withParts[0]) || fallbackHex || DEFAULT_HEX;
    const accent = findColorInText(withParts.slice(1).join(" WITH ")) || findColorInText(withParts[1]) || "#dc2626";
    return {
      type: "tipped",
      primary,
      accent,
      background: `linear-gradient(to bottom, ${primary} 0%, ${primary} 72%, ${accent} 72%, ${accent} 100%)`
    };
  }

  const slashParts = normalized.split(/\s*\/\s*/).filter(Boolean);
  if (slashParts.length >= 2) {
    const primary = findColorInText(slashParts[0]) || fallbackHex || DEFAULT_HEX;
    const accent = findColorInText(slashParts[1]) || "#f5f5f5";
    return {
      type: "tipped",
      primary,
      accent,
      background: `linear-gradient(to bottom, ${primary} 0%, ${primary} 72%, ${accent} 72%, ${accent} 100%)`
    };
  }

  const hyphenParts = normalized.split("-").filter((p) => p.length > 1);
  if (hyphenParts.length >= 2 && hyphenParts.every((p) => p.length <= 3)) {
    const colors = hyphenParts.map((part) => findColorInText(part)).filter(Boolean);
    if (colors.length >= 2) {
      const step = 100 / colors.length;
      const stops = colors
        .map((hex, i) => {
          const start = (i * step).toFixed(1);
          const end = ((i + 1) * step).toFixed(1);
          return `${hex} ${start}%, ${hex} ${end}%`;
        })
        .join(", ");
      return {
        type: "tipped",
        primary: colors[0],
        accent: colors[colors.length - 1],
        background: `linear-gradient(to bottom, ${stops})`
      };
    }
  }

  const primary = findColorInText(normalized) || fallbackHex || DEFAULT_HEX;
  const isMelange = /\bMELANGE\b/.test(normalized);

  return {
    type: isMelange ? "melange" : "solid",
    primary,
    background: isMelange ? melangeShade(primary) : primary
  };
}
