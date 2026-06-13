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

export function usdFmt(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

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
