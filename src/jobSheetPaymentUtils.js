export const JOB_SHEET_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "neft_rtgs", label: "NEFT / RTGS" },
  { value: "card_pos", label: "Card / POS" },
  { value: "pi_advance_received", label: "PI — advance received" },
  { value: "pi_pending", label: "PI — pending payment" },
  { value: "credit_partial", label: "Credit / partial" }
];

export function parseJobSheetMoney(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function jobSheetPaymentModeLabel(value) {
  if (!value) return "—";
  const row = JOB_SHEET_PAYMENT_MODES.find((o) => o.value === value);
  return row?.label ?? value;
}

export function calcJobSheetTotalAmount(ratePerPiece, quantity) {
  const rate = parseJobSheetMoney(ratePerPiece);
  const qty =
    typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0
      ? Math.floor(quantity)
      : 0;
  if (rate == null || qty <= 0) return null;
  return Math.round(rate * qty * 100) / 100;
}

export function calcJobSheetAdvancePercent(totalAmount, advanceAmount) {
  const total = parseJobSheetMoney(totalAmount) ?? 0;
  const advance = parseJobSheetMoney(advanceAmount) ?? 0;
  if (total <= 0 || advance <= 0) return 0;
  return Math.round((advance / total) * 10000) / 100;
}

export function calcJobSheetBalanceAmount(totalAmount, advanceAmount) {
  const total = parseJobSheetMoney(totalAmount) ?? 0;
  const advance = parseJobSheetMoney(advanceAmount) ?? 0;
  const balance = Math.max(0, total - advance);
  return Math.round(balance * 100) / 100;
}

export function calcJobSheetPendingAmount(totalAmount, advanceAmount, fullPaid) {
  if (fullPaid === "yes" || fullPaid === true) return 0;
  return calcJobSheetBalanceAmount(totalAmount, advanceAmount);
}

export function formatJobSheetMoneyDisplay(value) {
  const n = parseJobSheetMoney(value);
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatJobSheetClosureDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** True when a production job is marked full paid but has no job-sheet payment proof on file. */
export function jobSheetFullPaidMissingPaymentProof(order, parseProofUrls) {
  if (!order?.is_production_order || !order?.job_sheet_full_paid) return false;
  const urls = parseProofUrls(order?.job_sheet_payment_proof_url);
  return !urls.length;
}
