import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TASK_PRIORITY_LABEL, normalizeTaskPriority } from "../../goalTrackerUtils";

const PRIORITY_STYLES = {
  P0: "border-red-400 bg-red-100 text-red-800",
  P1: "border-amber-300 bg-[#F5F0E6] text-amber-950",
  P2: "border-green-400 bg-green-100 text-green-800"
};

export default function TaskPriorityBadge({ priority, className, compact = false }) {
  const p = normalizeTaskPriority(priority);
  const label = TASK_PRIORITY_LABEL[p];
  return (
    <Badge variant="outline" className={cn(PRIORITY_STYLES[p], className)}>
      {compact ? p : `${p} · ${label}`}
    </Badge>
  );
}

export function prioritySelectItemClass(priority) {
  const p = normalizeTaskPriority(priority);
  return PRIORITY_STYLES[p];
}
