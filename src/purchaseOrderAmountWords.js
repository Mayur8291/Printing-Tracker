/**
 * Indian-style amount in words for the Purchase Order C13 row (under C12–C82).
 * The number comes from C82 (sum of line Amounts). C82 prints ` ₹ 1000.00`.
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return [TENS[tens], ONES[ones]].filter(Boolean).join(" ");
}

function threeDigitWords(n) {
  if (n <= 0) return "";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitWords(rest));
  return parts.join(" ");
}

/** Read C82 raw (number or formatted text). Null if empty / not a number yet. */
export function parsePurchaseOrderC82Amount(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** C13 text from C82. Empty string until C82 has a number. */
export function purchaseOrderAmountInWords(c82Amount) {
  const parsed = parsePurchaseOrderC82Amount(c82Amount);
  if (parsed == null) return "";

  const abs = Math.round(Math.abs(parsed) * 100) / 100;
  let rupees = Math.floor(abs);
  let paise = Math.round((abs - rupees) * 100);
  if (paise === 100) {
    rupees += 1;
    paise = 0;
  }

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  const rest = rupees % 1000;

  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${threeDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigitWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitWords(rest));

  const rupeeWords = parts.join(" ") || "Zero";
  if (paise) return `${rupeeWords} Rupees and ${twoDigitWords(paise)} Paise Only`;
  return `${rupeeWords} Rupees Only`;
}
