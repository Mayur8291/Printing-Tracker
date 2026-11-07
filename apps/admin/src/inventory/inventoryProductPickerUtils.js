import { rowToSku } from "./inventoryDbUtils";
import { colorLabelToHex } from "./inventoryColorUtils";

const PICKER_PAGE_SIZE = 1000;
const PLACEHOLDER_INVENTORY_HEX = "#cccccc";

const SKU_SEGMENT_COLOR = {
  BL: "BLACK",
  BLK: "BLACK",
  BK: "BLACK",
  WH: "WHITE",
  WHT: "WHITE",
  NV: "NAVY",
  NAV: "NAVY",
  RD: "RED",
  GR: "GREEN",
  GN: "GREEN",
  BLU: "BLUE",
  BU: "BLUE",
  GY: "GREY",
  GRY: "GREY",
  PK: "PINK",
  PR: "PURPLE",
  YL: "YELLOW",
  OR: "ORANGE"
};

function isRealInventoryHex(hex) {
  const h = String(hex ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{3,8}$/i.test(h) && h !== PLACEHOLDER_INVENTORY_HEX;
}

function hexFromSkuSegments(skuCode) {
  const segments = String(skuCode ?? "")
    .toUpperCase()
    .split(/[-_/]+/)
    .filter(Boolean);
  for (const seg of segments) {
    const label = SKU_SEGMENT_COLOR[seg];
    if (label) {
      const hex = colorLabelToHex(label);
      if (hex && hex !== PLACEHOLDER_INVENTORY_HEX) return hex.toLowerCase();
    }
  }
  return null;
}

/** Map inventory SKU color fields to order `colors` array (hex for swatches). */
export function colorsFromInventoryProduct(product) {
  if (!product) return [];

  const colorName = String(product.color ?? "").trim();
  const skuCode = String(product.id ?? product.sku_code ?? "").trim();
  const storedHex = String(product.hex ?? product.hex_color ?? "").trim();

  if (colorName) {
    const fromName = colorLabelToHex(colorName);
    if (fromName && fromName !== PLACEHOLDER_INVENTORY_HEX) {
      return [fromName.toLowerCase()];
    }
  }

  const fromSku = hexFromSkuSegments(skuCode);
  if (fromSku) return [fromSku];

  const fromCombined = colorLabelToHex(`${skuCode} ${product.name ?? ""} ${colorName}`);
  if (fromCombined && fromCombined !== PLACEHOLDER_INVENTORY_HEX) {
    return [fromCombined.toLowerCase()];
  }

  if (isRealInventoryHex(storedHex)) {
    return [storedHex.toLowerCase()];
  }

  return colorName ? [colorName] : [];
}

const PICKER_SKU_SELECT =
  "id, sku_code, kind, name, color, hex_color, stock_qty, reorder_point, unit, unit_cost, supplier_id, warehouse_id, extra";

/** Fetch all inventory SKUs for printing order product picker (paginated — no row cap). */
export async function fetchInventoryProductsForPicker(client) {
  const rows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from("inventory_skus")
      .select(PICKER_SKU_SELECT)
      .order("name", { ascending: true })
      .order("sku_code", { ascending: true })
      .range(offset, offset + PICKER_PAGE_SIZE - 1);

    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < PICKER_PAGE_SIZE) break;
    offset += PICKER_PAGE_SIZE;
  }

  return rows.map(rowToSku).filter((row) => String(row.name ?? "").trim());
}

export const PRINTING_PRODUCT_CUSTOM_KEY = "__custom__";

export const INVENTORY_KIND_LABELS = {
  fabric: "Fabrics",
  trim: "Trims",
  apparel: "Apparel"
};

export function inventoryProductDisplayLabel(product) {
  const code = String(product?.id ?? "").trim();
  const name = String(product?.name ?? "").trim();
  const color = String(product?.color ?? "").trim();
  const parts = [code && code !== name ? code : "", name, color || ""].filter(Boolean);
  return parts.join(" · ");
}

export function groupInventoryProducts(products) {
  const byKind = new Map();
  for (const product of products ?? []) {
    const kind = String(product.kind ?? "other").trim() || "other";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(product);
  }

  const preferred = ["apparel", "fabric", "trim"];
  const kinds = [
    ...preferred.filter((k) => byKind.has(k)),
    ...[...byKind.keys()].filter((k) => !preferred.includes(k)).sort()
  ];

  return kinds.map((kind) => ({
    kind,
    label: INVENTORY_KIND_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    products: byKind.get(kind) ?? []
  }));
}
