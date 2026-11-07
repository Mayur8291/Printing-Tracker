import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function OrderViewActionCell({ order, onViewOrder, className, viewLabel = "View order" }) {
  if (order?._isPending) {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-muted-foreground", className)}
        aria-live="polite"
        aria-label="Saving order"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span className="sr-only">Saving order…</span>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="link"
      className={cn("h-auto px-0", className)}
      onClick={() => onViewOrder(order)}
    >
      {viewLabel}
    </Button>
  );
}
