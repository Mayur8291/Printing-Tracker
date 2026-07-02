import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  new: "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  approval_pending:
    "border-transparent bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-300",
  in_production:
    "border-transparent bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  printing: "border-transparent bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  fusing: "border-transparent bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  ironing: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  packing: "border-transparent bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  pending: "border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  on_hold: "border-red-500/60 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-300",
  ready: "border-transparent bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  sent_to_dispatch:
    "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  dispatch_fail: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  dispatched:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
};

export default function OrderStatusBadge({ status, label, icon = null, className }) {
  const key = status ?? "new";
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap font-medium",
        STATUS_STYLES[key] ?? STATUS_STYLES.new,
        className
      )}
    >
      {icon}
      {label}
    </Badge>
  );
}
