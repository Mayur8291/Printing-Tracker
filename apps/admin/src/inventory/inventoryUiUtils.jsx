import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const STOCK_STATUS_STYLES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
  info: "border-blue-200 bg-blue-50 text-blue-700"
};

export const PO_STATUS_STYLES = {
  Draft: STOCK_STATUS_STYLES.neutral,
  "Awaiting Approval": STOCK_STATUS_STYLES.warning,
  Approved: STOCK_STATUS_STYLES.info,
  "In Production": STOCK_STATUS_STYLES.info,
  "In Transit": STOCK_STATUS_STYLES.info,
  Received: STOCK_STATUS_STYLES.success
};

export const MOVEMENT_TYPE_STYLES = {
  IN: STOCK_STATUS_STYLES.success,
  OUT: STOCK_STATUS_STYLES.danger,
  TRANSFER: STOCK_STATUS_STYLES.info,
  ADJUST: STOCK_STATUS_STYLES.warning
};

export function StockStatusBadge({ status, className }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={cn("font-normal", STOCK_STATUS_STYLES[status.kind] || STOCK_STATUS_STYLES.neutral, className)}>
      {status.label}
    </Badge>
  );
}

export function PoStatusBadge({ status, className }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PO_STATUS_STYLES[status] || STOCK_STATUS_STYLES.neutral, className)}>
      {status}
    </Badge>
  );
}

export function MovementTypeBadge({ type, className }) {
  return (
    <Badge variant="outline" className={cn("font-normal", MOVEMENT_TYPE_STYLES[type] || STOCK_STATUS_STYLES.neutral, className)}>
      {type}
    </Badge>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyHint({ children, className }) {
  return <div className={cn("py-10 text-center text-sm text-muted-foreground", className)}>{children}</div>;
}

export function SortIndicator({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <span className="ml-1 inline opacity-40" aria-hidden>↕</span>;
  return (
    <span className="ml-1 inline" aria-hidden>
      {sortDir === "asc" ? "↑" : "↓"}
    </span>
  );
}

export function ExpandToggle({ open, className }) {
  return (
    <span className={cn("inline-block w-4 shrink-0 text-center text-xs leading-none", className)} aria-hidden>
      {open ? "▾" : "▸"}
    </span>
  );
}
