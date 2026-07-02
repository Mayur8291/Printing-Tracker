/** Production tracker size types — from size set helper.xlsx (templates are labels, not quantities). */

export const JOB_SHEET_SIZE_COLUMN_KEYS = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
  "7XL",
  "8XL"
];

function slugify(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function formatTemplate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const n = Number.parseFloat(s);
  if (Number.isFinite(n) && /^\d+(\.0+)?$/.test(s)) {
    return String(Math.trunc(n));
  }
  return s;
}

function parseSizeTypeMeta(label) {
  const raw = String(label).trim();
  if (raw === "Pets") return { gender: "pets", productType: "" };

  let gender = "";
  let rest = raw;
  if (raw.startsWith("Kids ")) {
    gender = "kids";
    rest = raw.slice(5);
  } else if (raw.startsWith("Women ")) {
    gender = "women";
    rest = raw.slice(6);
  } else if (raw.startsWith("Men ")) {
    gender = "men";
    rest = raw.slice(4);
  }

  let productType = slugify(rest);
  if (productType === "trackpants" || productType === "trackpant") productType = "trackpant";
  if (productType === "polos") productType = "polo";
  return { gender, productType };
}

/** Fixed product type list (Production tracker dropdown). */
export const JOB_SHEET_PRODUCT_TYPES = [
  { value: "denim_pant", label: "Denim Pant" },
  { value: "hoodies", label: "Hoodies" },
  { value: "jacket", label: "Jacket" },
  { value: "polo", label: "Polo" },
  { value: "round_neck", label: "Round Neck" },
  { value: "shirt", label: "Shirt" },
  { value: "shorts", label: "Shorts" },
  { value: "skirts", label: "Skirts" },
  { value: "trackpant", label: "Trackpant" },
  { value: "v_neck", label: "V Neck" }
];

const PRODUCT_TYPE_LABELS = Object.fromEntries(
  JOB_SHEET_PRODUCT_TYPES.map(({ value, label }) => [value, label])
);

export function getJobSheetProductTypeLabel(productType) {
  const key = String(productType ?? "").trim();
  return PRODUCT_TYPE_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const JOB_SHEET_GENDERS = [
  { value: "kids", label: "Kids" },
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
  { value: "pets", label: "Pets" }
];

export function getJobSheetGenderLabel(gender) {
  return JOB_SHEET_GENDERS.find((g) => g.value === gender)?.label || gender || "";
}

/** @param {Record<string, string>} templates keyed by size column (XXS … 8XL) */
function columnsFromTemplates(templates) {
  return JOB_SHEET_SIZE_COLUMN_KEYS.filter((key) => templates[key] != null && templates[key] !== "").map(
    (key) => ({
      key,
      sizeLabel: key,
      template: formatTemplate(templates[key])
    })
  );
}

/** Raw rows: [label, templates object] */
const SIZE_TYPE_ROWS = [
  [
    "Kids Shorts",
    {
      XXS: "14",
      XS: "16",
      S: "18",
      M: "20",
      L: "22",
      XL: "24",
      "2XL": "26",
      "3XL": "28",
      "4XL": "30",
      "5XL": "32",
      "6XL": "34",
      "7XL": "36"
    }
  ],
  [
    "Kids Skirts",
    {
      XXS: "14",
      XS: "16",
      S: "18",
      M: "20",
      L: "22",
      XL: "24",
      "2XL": "26",
      "3XL": "28",
      "4XL": "30",
      "5XL": "32",
      "6XL": "34",
      "7XL": "36"
    }
  ],
  [
    "Kids Trackpants",
    {
      XXS: "14",
      XS: "16",
      S: "18",
      M: "20",
      L: "22",
      XL: "24",
      "2XL": "26",
      "3XL": "28",
      "4XL": "30",
      "5XL": "32",
      "6XL": "34",
      "7XL": "36"
    }
  ],
  [
    "Kids Hoodies",
    {
      XXS: "20",
      XS: "22",
      S: "24",
      M: "26",
      L: "28",
      XL: "30",
      "2XL": "32",
      "3XL": "34",
      "4XL": "36",
      "5XL": "38",
      "6XL": "40",
      "7XL": "42",
      "8XL": "44"
    }
  ],
  [
    "Kids Polo",
    {
      XXS: "20",
      XS: "22",
      S: "24",
      M: "26",
      L: "28",
      XL: "30",
      "2XL": "32",
      "3XL": "34",
      "4XL": "36",
      "5XL": "38",
      "6XL": "40",
      "7XL": "42",
      "8XL": "44"
    }
  ],
  [
    "Women Trackpant",
    {
      XXS: "26",
      XS: "28",
      S: "30",
      M: "32",
      L: "34",
      XL: "36",
      "2XL": "38",
      "3XL": "40",
      "4XL": "42",
      "5XL": "44",
      "6XL": "46",
      "7XL": "48"
    }
  ],
  [
    "Men Trackpant",
    {
      XXS: "26",
      XS: "28",
      S: "30",
      M: "32",
      L: "34",
      XL: "36",
      "2XL": "38",
      "3XL": "40",
      "4XL": "42",
      "5XL": "44",
      "6XL": "46",
      "7XL": "48"
    }
  ],
  [
    "Men Shorts",
    {
      XXS: "26",
      XS: "28",
      S: "30",
      M: "32",
      L: "34",
      XL: "36",
      "2XL": "38",
      "3XL": "40",
      "4XL": "42",
      "5XL": "44",
      "6XL": "46",
      "7XL": "48"
    }
  ],
  [
    "Women Shorts",
    {
      XXS: "26",
      XS: "28",
      S: "30",
      M: "32",
      L: "34",
      XL: "36",
      "2XL": "38",
      "3XL": "40",
      "4XL": "42",
      "5XL": "44",
      "6XL": "46",
      "7XL": "48"
    }
  ],
  [
    "Men Denim Pant",
    {
      XXS: "26",
      XS: "28",
      S: "30",
      M: "32",
      L: "34",
      XL: "36",
      "2XL": "38",
      "3XL": "40",
      "4XL": "42",
      "5XL": "44",
      "6XL": "46",
      "7XL": "48"
    }
  ],
  [
    "Pets",
    {
      XXS: "XXS",
      XS: "XS",
      S: "S",
      M: "M",
      L: "L",
      XL: "XL",
      "2XL": "2XL",
      "3XL": "3XL",
      "4XL": "4XL",
      "5XL": "5XL",
      "6XL": "6XL",
      "7XL": "7XL"
    }
  ],
  [
    "Women Round Neck",
    {
      XXS: "30",
      XS: "32",
      S: "34",
      M: "36",
      L: "38",
      XL: "40",
      "2XL": "42",
      "3XL": "44",
      "4XL": "46",
      "5XL": "48",
      "6XL": "50",
      "7XL": "52"
    }
  ],
  [
    "Women Polo",
    {
      XXS: "30",
      XS: "32",
      S: "34",
      M: "36",
      L: "38",
      XL: "40",
      "2XL": "42",
      "3XL": "44",
      "4XL": "46",
      "5XL": "48",
      "6XL": "50",
      "7XL": "52"
    }
  ],
  [
    "Women V Neck",
    {
      XXS: "30",
      XS: "32",
      S: "34",
      M: "36",
      L: "38",
      XL: "40",
      "2XL": "42",
      "3XL": "44",
      "4XL": "46",
      "5XL": "48",
      "6XL": "50",
      "7XL": "52"
    }
  ],
  [
    "Men V Neck",
    {
      XXS: "30",
      XS: "32",
      S: "34",
      M: "36",
      L: "38",
      XL: "40",
      "2XL": "42",
      "3XL": "44",
      "4XL": "46",
      "5XL": "48",
      "6XL": "50",
      "7XL": "52"
    }
  ],
  [
    "Women Shirt",
    {
      XXS: "30",
      XS: "32",
      S: "34",
      M: "36",
      L: "38",
      XL: "40",
      "2XL": "42",
      "3XL": "44",
      "4XL": "46",
      "5XL": "48",
      "6XL": "50",
      "7XL": "52"
    }
  ],
  [
    "Women Hoodies",
    {
      XXS: "32",
      XS: "34",
      S: "36",
      M: "38",
      L: "40",
      XL: "42",
      "2XL": "44",
      "3XL": "46",
      "4XL": "48",
      "5XL": "50",
      "6XL": "52",
      "7XL": "54"
    }
  ],
  [
    "Women Jacket",
    {
      XXS: "32",
      XS: "34",
      S: "36",
      M: "38",
      L: "40",
      XL: "42",
      "2XL": "44",
      "3XL": "46",
      "4XL": "48",
      "5XL": "50",
      "6XL": "52",
      "7XL": "54"
    }
  ],
  [
    "Men Round Neck",
    {
      XXS: "34",
      XS: "36",
      S: "38",
      M: "40",
      L: "42",
      XL: "44",
      "2XL": "46",
      "3XL": "48",
      "4XL": "50",
      "5XL": "52",
      "6XL": "54",
      "7XL": "56"
    }
  ],
  [
    "Men Polo",
    {
      XXS: "34",
      XS: "36",
      S: "38",
      M: "40",
      L: "42",
      XL: "44",
      "2XL": "46",
      "3XL": "48",
      "4XL": "50",
      "5XL": "52",
      "6XL": "54",
      "7XL": "56"
    }
  ],
  [
    "Men Hoodies",
    {
      XXS: "36",
      XS: "38",
      S: "40",
      M: "42",
      L: "44",
      XL: "46",
      "2XL": "48",
      "3XL": "50",
      "4XL": "52",
      "5XL": "54",
      "6XL": "56",
      "7XL": "58"
    }
  ],
  [
    "Men Jacket",
    {
      XXS: "36",
      XS: "38",
      S: "40",
      M: "42",
      L: "44",
      XL: "46",
      "2XL": "48",
      "3XL": "50",
      "4XL": "52",
      "5XL": "54",
      "6XL": "56",
      "7XL": "58"
    }
  ],
  [
    "Men Shirt",
    {
      XXS: "36",
      XS: "38",
      S: "40",
      M: "42",
      L: "44",
      XL: "46",
      "2XL": "48",
      "3XL": "50",
      "4XL": "52",
      "5XL": "54",
      "6XL": "56",
      "7XL": "58"
    }
  ],
  [
    "Kids Polos",
    {
      XXS: "0-2 Yrs",
      XS: "2-3 Yrs",
      S: "4-5 Yrs",
      M: "6-7 Yrs",
      L: "8-9 Yrs",
      XL: "10-11 Yrs",
      "2XL": "12-13 Yrs",
      "3XL": "14-15 Yrs",
      "4XL": "16-17 Yrs"
    }
  ],
  [
    "Kids Round Neck",
    {
      XXS: "0-2 Yrs",
      XS: "2-3 Yrs",
      S: "4-5 Yrs",
      M: "6-7 Yrs",
      L: "6-7 Yrs",
      XL: "8-9 Yrs",
      "2XL": "10-11 Yrs",
      "3XL": "12-13 Yrs",
      "4XL": "14-15 Yrs",
      "5XL": "16-17 Yrs"
    }
  ]
];

/** Fallback grid for legacy size_type values (alpha, numeric, etc.). */
export const JOB_SHEET_LEGACY_SIZE_COLUMNS = JOB_SHEET_SIZE_COLUMN_KEYS.map((key) => ({
  key,
  sizeLabel: key,
  template: ""
}));

export const JOB_SHEET_SIZE_TYPES = SIZE_TYPE_ROWS.map(([label, templates]) => {
  const meta = parseSizeTypeMeta(label);
  return {
    value: slugify(label),
    label,
    columns: columnsFromTemplates(templates),
    gender: meta.gender,
    productType: meta.productType
  };
});

const SIZE_TYPE_BY_VALUE = Object.fromEntries(JOB_SHEET_SIZE_TYPES.map((t) => [t.value, t]));

const LEGACY_SIZE_TYPE_LABELS = {
  alpha: "Alpha (XXS–8XL)",
  numeric: "Numeric",
  free: "Free size",
  custom: "Custom"
};

export function getJobSheetSizeTypeConfig(sizeType) {
  const key = String(sizeType ?? "").trim();
  if (!key) return null;
  return SIZE_TYPE_BY_VALUE[key] || null;
}

export function getJobSheetProductTypeOptions(gender = "") {
  const g = String(gender ?? "").trim();
  if (g === "pets") return [];
  const available = new Set(
    JOB_SHEET_SIZE_TYPES.filter((row) => !g || row.gender === g)
      .map((row) => row.productType)
      .filter(Boolean)
  );
  return JOB_SHEET_PRODUCT_TYPES.filter((pt) => available.has(pt.value));
}

export function filterJobSheetSizeTypes({ gender = "", productType = "" } = {}) {
  const g = String(gender ?? "").trim();
  const p = String(productType ?? "").trim();
  return JOB_SHEET_SIZE_TYPES.filter((row) => {
    if (g && row.gender !== g) return false;
    if (g === "pets") return row.value === "pets";
    if (p && row.productType !== p) return false;
    return true;
  });
}

export function inferGenderProductTypeFromSizeType(sizeType) {
  const cfg = getJobSheetSizeTypeConfig(sizeType);
  if (!cfg) return { gender: "", productType: "" };
  return { gender: cfg.gender || "", productType: cfg.productType || "" };
}

export function getJobSheetSizeTypeLabel(sizeType) {
  const key = String(sizeType ?? "").trim();
  if (!key) return "";
  return getJobSheetSizeTypeConfig(key)?.label || LEGACY_SIZE_TYPE_LABELS[key] || key;
}

export function getJobSheetSizeColumnsForType(sizeType) {
  return getJobSheetSizeTypeConfig(sizeType)?.columns ?? JOB_SHEET_LEGACY_SIZE_COLUMNS;
}

/** Display label for size column header: "M · 32" or "XXS · 0-2 Yrs" */
export function formatJobSheetSizeColumnHeader(column) {
  if (!column?.sizeLabel) return "";
  if (!column.template || column.template === column.sizeLabel) {
    return column.sizeLabel;
  }
  return `${column.sizeLabel} · ${column.template}`;
}
