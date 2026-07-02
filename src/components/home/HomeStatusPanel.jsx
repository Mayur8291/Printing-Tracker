import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function HomeStatusPanel({
  summary,
  refreshing,
  onRefresh,
  lastUpdatedLabel,
  renderStageIcon
}) {
  return (
    <section className="space-y-4" aria-labelledby="home-status-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="home-status-title" className="text-xl font-semibold tracking-tight text-foreground">
          Order counts by status
        </h2>
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh order counts"
            aria-busy={refreshing}
            title="Refresh order counts"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {refreshing ? "Refreshing…" : `Last updated: ${lastUpdatedLabel}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {summary.map((item) => (
          <Card
            key={item.key}
            className="flex h-full flex-col shadow-sm"
            aria-label={`${item.label}: ${item.count} ${item.count === 1 ? "order" : "orders"}`}
          >
            <CardHeader className="space-y-3 p-4 pb-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_.stage-icon-img]:size-5 [&_.stage-icon]:text-base [&_.on-hold-warning-icon]:size-5">
                {item.key === "new" ? (
                  <span className="text-[10px] font-bold tracking-wide">NEW</span>
                ) : (
                  renderStageIcon(item.key, item.label)
                )}
              </div>
              <CardTitle className="text-sm font-medium leading-snug">{item.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <p className="text-3xl font-bold tabular-nums leading-none tracking-tight">{item.count}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">{item.count === 1 ? "order" : "orders"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
