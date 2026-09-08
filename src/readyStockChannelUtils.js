export const CHANNEL_TYPE_BADGE_CLASS = {
  MOBILE_APP: "bg-secondary text-secondary-foreground",
  CUSTOM: "bg-secondary text-secondary-foreground",
  SHOPIFY: "bg-secondary text-secondary-foreground",
  AMAZON: "bg-muted text-muted-foreground",
  FLIPKART: "bg-secondary text-secondary-foreground",
  MYNTRA: "bg-secondary text-secondary-foreground",
  JIOMART: "bg-muted text-muted-foreground",
  OTHER: "bg-muted text-muted-foreground"
};

export function readyStockChannelLabel(order) {
  const name = String(order?.channel_name ?? "").trim();
  const code = String(order?.channel_code ?? "").trim();
  return name || code || "Unknown";
}

export function readyStockChannelCode(order) {
  return String(order?.channel_code ?? "").trim() || "UNKNOWN";
}
