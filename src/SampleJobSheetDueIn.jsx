import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getSampleJobSheetSlaSnapshot } from "./sampleJobSheetSlaUtils";

const URGENCY_VARIANT = {
  ok: "secondary",
  warn: "default",
  urgent: "destructive"
};

function useTickingNowMs() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return nowMs;
}

function DueInContent({ snapshot, compact }) {
  if (snapshot.kind === "breached") {
    if (compact) {
      return <Badge variant="destructive">SLA Breached</Badge>;
    }
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>SLA Breached</AlertTitle>
      </Alert>
    );
  }
  return (
    <Badge
      variant={URGENCY_VARIANT[snapshot.urgency] ?? "secondary"}
      className="w-fit font-mono tabular-nums"
    >
      {snapshot.label}
    </Badge>
  );
}

/** Compact cell for Sampling Tracker list (after Order date). */
export function SampleJobSheetDueInCell({ order }) {
  const nowMs = useTickingNowMs();
  const snapshot = getSampleJobSheetSlaSnapshot(order, nowMs);
  if (snapshot.kind === "hidden") {
    return <span className="text-muted-foreground">—</span>;
  }
  return <DueInContent snapshot={snapshot} compact />;
}

/** View Sample Order Due In block. */
export default function SampleJobSheetDueIn({ order }) {
  const nowMs = useTickingNowMs();
  const snapshot = getSampleJobSheetSlaSnapshot(order, nowMs);
  if (snapshot.kind === "hidden") return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h4 className="text-sm font-semibold tracking-tight">Due In</h4>
      <DueInContent snapshot={snapshot} />
    </section>
  );
}
