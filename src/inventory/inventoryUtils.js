import { statusOfWithSettings } from "./inventoryDbUtils";

const REFERENCE_NOW = new Date();

export function formatRelative(d, now = REFERENCE_NOW) {
  const date = d instanceof Date ? d : new Date(d);
  const diff = Math.floor((now - date) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff} min ago`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / (60 * 24))}d ago`;
}

export function formatInr(n, { minimumFractionDigits = 0, maximumFractionDigits = 2 } = {}) {
  const value = Number(n);
  if (!Number.isFinite(value)) return "₹0";
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits,
    maximumFractionDigits
  });
}

export function inrFmt(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e7) {
    const cr = abs / 1e7;
    const text = cr >= 10 || cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(1);
    return `${sign}₹${text}Cr`;
  }
  if (abs >= 1e5) {
    const lakhs = abs / 1e5;
    const text = lakhs >= 10 || lakhs % 1 === 0 ? lakhs.toFixed(0) : lakhs.toFixed(1);
    return `${sign}₹${text}L`;
  }
  if (abs >= 1e3) {
    const k = abs / 1e3;
    const text = k >= 10 || k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${sign}₹${text}k`;
  }
  return formatInr(abs, { maximumFractionDigits: 0 });
}

/** @deprecated Use inrFmt */
export const usdFmt = inrFmt;

export function statusOf(row, settings) {
  return statusOfWithSettings(row, settings);
}

export function getAllSkus(skus) {
  return skus || [];
}

export function findSku(id, skus) {
  return (skus || []).find((s) => s.id === id) || null;
}

export function isApparelSku(sku) {
  return sku?.totalStock !== undefined || sku?.kind === "apparel";
}
