export const PRINT_CALCULATOR_DPI = 150;

export function pixelsToInches(pixels) {
  const n = Number(pixels);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / PRINT_CALCULATOR_DPI).toFixed(2);
}

/** DTF formula: (height + 1) × (width + 1) × rate per square inch */
export function computePrintCost(heightInches, widthInches, ratePerSqIn) {
  const h = Number(heightInches);
  const w = Number(widthInches);
  const rate = Number(ratePerSqIn);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return (h + 1) * (w + 1) * rate;
}

export function formatInrAmount(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
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
