import { cn } from "@/lib/utils";
import { formatDrr } from "../inventoryDrrUtils";

/** Read-only inventory metric (e.g. auto-calculated DRR). */
export default function SkuMetricReadonly({ value, className, title }) {
  return (
    <span
      className={cn("inline-flex h-11 w-20 items-center justify-end tabular-nums text-sm", className)}
      title={title}
    >
      {formatDrr(value)}
    </span>
  );
}
