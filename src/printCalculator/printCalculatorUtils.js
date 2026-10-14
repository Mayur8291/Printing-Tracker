export const PRINT_CALCULATOR_DPI = 150;

/** Extra inch added to width and to height before billing. */
export const PRINT_BLEED_INCHES = 1;

export const PRINT_AUDIENCES = [
  { id: "internal", label: "Internal team" },
  { id: "customer", label: "Customer" }
];

/** Labels match the admin form. 10 and 200 belong to the lower slab. */
export const PRINT_PRICE_SLABS = [
  { id: "1_10", label: "0–10", min: 1, max: 10 },
  { id: "11_200", label: "10–200", min: 11, max: 200 },
  { id: "201_1000", label: "200–1000", min: 201, max: 1000 }
];

const RATE_COLUMNS = {
  internal: {
    "1_10": "internal_rate_1_10",
    "11_200": "internal_rate_11_200",
    "201_1000": "internal_rate_201_1000"
  },
  customer: {
    "1_10": "customer_rate_1_10",
    "11_200": "customer_rate_11_200",
    "201_1000": "customer_rate_201_1000"
  }
};

export function pixelsToInches(pixels) {
  const n = Number(pixels);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / PRINT_CALCULATOR_DPI).toFixed(2);
}

function positiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Whole copies. Blank or below 1 counts as zero (line not ready). */
export function parseCopyCount(value) {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.floor(n);
}

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function slabForCopies(copies) {
  const n = parseCopyCount(copies);
  if (n <= 0) return null;
  if (n <= 10) return PRINT_PRICE_SLABS[0];
  if (n <= 200) return PRINT_PRICE_SLABS[1];
  return PRINT_PRICE_SLABS[2];
}

export function emptyPriceLists() {
  return {
    internal: { "1_10": "", "11_200": "", "201_1000": "" },
    customer: { "1_10": "", "11_200": "", "201_1000": "" }
  };
}

export function priceListsFromRow(row, fallbackPerSqIn = 1) {
  const fallback = roundRate(fallbackPerSqIn);
  const lists = { internal: {}, customer: {} };
  for (const audience of PRINT_AUDIENCES) {
    for (const slab of PRINT_PRICE_SLABS) {
      const raw = Number(row?.[RATE_COLUMNS[audience.id][slab.id]]);
      lists[audience.id][slab.id] = Number.isFinite(raw) && raw > 0 ? raw : fallback;
    }
  }
  return lists;
}

export function priceListsToDraft(lists) {
  const draft = emptyPriceLists();
  for (const audience of PRINT_AUDIENCES) {
    for (const slab of PRINT_PRICE_SLABS) {
      const n = lists?.[audience.id]?.[slab.id];
      draft[audience.id][slab.id] = n == null || n === "" ? "" : String(n);
    }
  }
  return draft;
}

export function priceDraftDirty(draft, saved) {
  for (const audience of PRINT_AUDIENCES) {
    for (const slab of PRINT_PRICE_SLABS) {
      const draftN = Number(draft?.[audience.id]?.[slab.id]);
      const savedN = Number(saved?.[audience.id]?.[slab.id]);
      if (!Number.isFinite(draftN) || draftN !== savedN) return true;
    }
  }
  return false;
}

function roundRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

export function parsePriceListDraft(draft) {
  const parsed = { internal: {}, customer: {} };
  for (const audience of PRINT_AUDIENCES) {
    for (const slab of PRINT_PRICE_SLABS) {
      const n = Number(draft?.[audience.id]?.[slab.id]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          `${audience.label} ${slab.label} rate must be greater than zero.`
        );
      }
      parsed[audience.id][slab.id] = roundRate(n);
    }
  }
  return parsed;
}

export function priceListPayload(parsed) {
  const payload = {};
  for (const audience of PRINT_AUDIENCES) {
    for (const slab of PRINT_PRICE_SLABS) {
      payload[RATE_COLUMNS[audience.id][slab.id]] = parsed[audience.id][slab.id];
    }
  }
  return payload;
}

export function rateForCopies(priceLists, audience, copies) {
  const slab = slabForCopies(copies);
  const copiesN = parseCopyCount(copies);
  if (!slab) return { slab: null, rate: null, aboveMax: false };
  return {
    slab,
    rate: positiveNumber(priceLists?.[audience]?.[slab.id]),
    aboveMax: copiesN > 1000
  };
}

/**
 * One print.
 * Billed inches = width + 1 and height + 1.
 * Cost = billed square inches × ₹ per square inch × copies.
 */
export function printLineQuote(heightInches, widthInches, ratePerSqIn, qty = 1) {
  const height = positiveNumber(heightInches);
  const width = positiveNumber(widthInches);
  const rate = positiveNumber(ratePerSqIn);
  const copies = parseCopyCount(qty);
  const slab = slabForCopies(qty);
  const ready = height != null && width != null && rate != null && copies > 0 && slab != null;
  const billedWidth = ready ? width + PRINT_BLEED_INCHES : 0;
  const billedHeight = ready ? height + PRINT_BLEED_INCHES : 0;
  const areaSqIn = ready ? roundMoney(billedWidth * billedHeight) : 0;
  const unitCost = ready ? roundMoney(areaSqIn * rate) : 0;
  const cost = ready ? roundMoney(unitCost * copies) : 0;
  return {
    ready,
    widthInches: width,
    heightInches: height,
    billedWidth,
    billedHeight,
    areaSqIn,
    copies,
    rate,
    slab,
    aboveMax: copies > 1000,
    unitCost,
    cost
  };
}

export function computePrintCost(heightInches, widthInches, ratePerSqIn, qty = 1) {
  return printLineQuote(heightInches, widthInches, ratePerSqIn, qty).cost;
}

export function summarizePrintQuotes(quotes) {
  return quotes.reduce(
    (acc, quote) => {
      if (!quote?.ready) return acc;
      acc.pieces += quote.copies;
      acc.areaSqIn = roundMoney(acc.areaSqIn + quote.areaSqIn * quote.copies);
      acc.cost = roundMoney(acc.cost + quote.cost);
      acc.readyLines += 1;
      return acc;
    },
    { pieces: 0, areaSqIn: 0, cost: 0, readyLines: 0 }
  );
}

export function formatInrAmount(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatRateAmount(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
}

export function formatInches(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatSqIn(value) {
  return `${formatInches(value)} sq in`;
}

export function audienceLabel(audienceId) {
  return PRINT_AUDIENCES.find((item) => item.id === audienceId)?.label || "Customer";
}

export function buildPrintQuoteText(rows, audience) {
  const lines = [
    "Print cost quote",
    `Price list: ${audienceLabel(audience)}`,
    "Rate: ₹ per square inch. One quantity multiplies every print.",
    "Slabs: 1–10 uses 0–10, 11–200 uses 10–200, 201 and above uses 200–1000",
    `Bleed: +${PRINT_BLEED_INCHES} in on width and +${PRINT_BLEED_INCHES} in on height`,
    ""
  ];
  rows.forEach((row, index) => {
    const name = row.fileName || `Print ${index + 1}`;
    const quote = row.quote;
    if (!quote?.ready) {
      lines.push(`${index + 1}. ${name} — size or quantity missing`);
      return;
    }
    const above = quote.aboveMax ? " (above 1000, 200–1000 rate)" : "";
    lines.push(
      `${index + 1}. ${name} — ${formatInches(quote.widthInches)}×${formatInches(quote.heightInches)} in, single pc ${formatInrAmount(quote.unitCost)} × ${quote.copies} = ${formatInrAmount(quote.cost)} (${quote.slab?.label} qty${above})`
    );
  });
  const summary = summarizePrintQuotes(rows.map((row) => row.quote));
  lines.push("");
  lines.push(`Prints: ${rows.length}`);
  lines.push(`Quantity each: ${rows.find((row) => row.quote?.ready)?.quote.copies || 0}`);
  lines.push(`Pieces: ${summary.pieces}`);
  lines.push(`Billed area: ${formatSqIn(summary.areaSqIn)}`);
  lines.push(`Total: ${formatInrAmount(summary.cost)}`);
  return lines.join("\n");
}

export function downloadImageUrl(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
