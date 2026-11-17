import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CARDS = [
  { key: "total", label: "Total jobs" },
  { key: "newJobs", label: "New jobs" },
  { key: "inProduction", label: "In production" },
  { key: "pendingSamples", label: "Pending samples" },
  { key: "sourcing", label: "Sourcing" },
  { key: "packaging", label: "Packaging" },
  { key: "ready", label: "Ready to dispatch" },
  { key: "completed", label: "Completed" },
  { key: "delayed", label: "Delayed" }
];

export default function ProductionTrackerSummary({ metrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {CARDS.map((card) => (
        <Card key={card.key} className="shadow-sm">
          <CardHeader className="space-y-0 p-4 pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-semibold tabular-nums">{metrics?.[card.key] ?? 0}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
