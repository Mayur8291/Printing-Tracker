import { Card, CardContent } from "@/components/ui/card";

export default function OrdersListSummary({ label, count, totalQty, filterBits = [] }) {
  return (
    <Card className="mb-4 shadow-sm" role="status">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
            {count}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-sm text-muted-foreground">
          {totalQty != null ? (
            <span>
              Total qty:{" "}
              <strong className="font-semibold text-foreground">{totalQty}</strong>
            </span>
          ) : null}
          {filterBits.length > 0 ? (
            <span className="font-medium text-foreground/80">{filterBits.join(" · ")}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
