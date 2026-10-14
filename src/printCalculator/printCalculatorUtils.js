export const PRINT_CALCULATOR_DPI = 150;

/** Extra inch added to width and to height before billing. */
export const PRINT_BLEED_INCHES = 1;

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

/**
 * One artwork line.
 * Billed size = (width + 1 in) × (height + 1 in). Cost = billed sq in × rate × copies.
 */
export function printLineQuote(heightInches, widthInches, ratePerSqIn, qty = 1) {
  const height = positiveNumber(heightInches);
  const width = positiveNumber(widthInches);
  const rate = positiveNumber(ratePerSqIn);
  const copies = parseCopyCount(qty);
  const ready = height != null && width != null && rate != null && copies > 0;
  const billedWidth = ready ? width + PRINT_BLEED_INCHES : 0;
  const billedHeight = ready ? height + PRINT_BLEED_INCHES : 0;
  const areaSqIn = ready ? roundMoney(billedWidth * billedHeight) : 0;
  const cost = ready ? roundMoney(areaSqIn * rate * copies) : 0;
  return {
    ready,
    widthInches: width,
    heightInches: height,
    billedWidth,
    billedHeight,
    areaSqIn,
    copies,
    rate,
    cost
  };
}

/** DTF formula: (height + 1) × (width + 1) × rate per square inch × copies */
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

export function buildPrintQuoteText(rows, ratePerSqIn) {
  const lines = [
    "Print cost quote",
    `Rate: ${formatRateAmount(ratePerSqIn)} per sq in`,
    `Bleed: +${PRINT_BLEED_INCHES} in on width and +${PRINT_BLEED_INCHES} in on height`,
    ""
  ];
  rows.forEach((row, index) => {
    const name = row.fileName || `Artwork ${index + 1}`;
    const quote = row.quote;
    if (!quote?.ready) {
      lines.push(`${index + 1}. ${name} — size or copies missing`);
      return;
    }
    lines.push(
      `${index + 1}. ${name} — ${formatInches(quote.widthInches)}×${formatInches(quote.heightInches)} in, billed ${formatInches(quote.billedWidth)}×${formatInches(quote.billedHeight)} in (${formatSqIn(quote.areaSqIn)}) × ${quote.copies} = ${formatInrAmount(quote.cost)}`
    );
  });
  const summary = summarizePrintQuotes(rows.map((row) => row.quote));
  lines.push("");
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
