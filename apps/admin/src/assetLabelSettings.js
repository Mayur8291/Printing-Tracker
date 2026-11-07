const STORAGE_KEY = "scott-asset-label-settings";

export const ASSET_LABEL_FIELD_OPTIONS = [
  { id: "none", label: "None (hidden)" },
  { id: "asset_name", label: "Asset name" },
  { id: "asset_tag", label: "Asset tag (IT-00001)" },
  { id: "category", label: "Category" },
  { id: "serial_number", label: "Serial number" },
  { id: "manufacturer", label: "Manufacturer" },
  { id: "location", label: "Location" },
  { id: "assignee", label: "Assigned to" },
  { id: "category_and_serial", label: "Category · S/N serial" }
];

export const DEFAULT_ASSET_LABEL_SETTINGS = {
  aboveLine1: "asset_name",
  aboveLine2: "category_and_serial",
  belowLine1: "asset_tag",
  belowLine2: "location"
};

export const SAMPLE_LABEL_ASSET = {
  tag: "IT-00001",
  name: "Sample laptop",
  cat: "Laptop",
  serial: "SN-12345",
  maker: "Apple",
  location: "4th floor IT room",
  assignee: "John Doe"
};

function trimValue(value) {
  const t = String(value ?? "").trim();
  return t && t !== "—" ? t : "";
}

export function normalizeAssetLabelSettings(raw) {
  const allowed = new Set(ASSET_LABEL_FIELD_OPTIONS.map((o) => o.id));
  const next = { ...DEFAULT_ASSET_LABEL_SETTINGS };
  for (const key of Object.keys(DEFAULT_ASSET_LABEL_SETTINGS)) {
    const value = raw?.[key];
    if (typeof value === "string" && allowed.has(value)) {
      next[key] = value;
    }
  }
  return next;
}

export function loadAssetLabelSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_ASSET_LABEL_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ASSET_LABEL_SETTINGS };
    return normalizeAssetLabelSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_ASSET_LABEL_SETTINGS };
  }
}

export function saveAssetLabelSettings(settings) {
  const normalized = normalizeAssetLabelSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function resolveAssetLabelField(asset, fieldId) {
  if (!fieldId || fieldId === "none") return "";
  const row = asset ?? {};
  switch (fieldId) {
    case "asset_name":
      return trimValue(row.name);
    case "asset_tag":
      return trimValue(row.tag);
    case "category":
      return trimValue(row.cat ?? row.category);
    case "serial_number":
      return trimValue(row.serial);
    case "manufacturer":
      return trimValue(row.maker ?? row.manufacturer);
    case "location":
      return trimValue(row.location);
    case "assignee":
      return trimValue(row.assignee);
    case "category_and_serial": {
      const parts = [];
      const cat = trimValue(row.cat ?? row.category);
      const serial = trimValue(row.serial);
      if (cat) parts.push(cat);
      if (serial) parts.push(`S/N ${serial}`);
      return parts.join(" · ");
    }
    default:
      return "";
  }
}

export function buildAssetLabelLines(asset, settings = DEFAULT_ASSET_LABEL_SETTINGS) {
  const cfg = normalizeAssetLabelSettings(settings);
  return {
    aboveLine1: resolveAssetLabelField(asset, cfg.aboveLine1),
    aboveLine2: resolveAssetLabelField(asset, cfg.aboveLine2),
    belowLine1: resolveAssetLabelField(asset, cfg.belowLine1),
    belowLine2: resolveAssetLabelField(asset, cfg.belowLine2)
  };
}

export function assetLabelFieldLabel(fieldId) {
  return ASSET_LABEL_FIELD_OPTIONS.find((o) => o.id === fieldId)?.label ?? fieldId;
}
