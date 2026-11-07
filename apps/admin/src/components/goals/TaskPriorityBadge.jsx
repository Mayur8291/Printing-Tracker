import { cn } from "@/lib/utils";
import { TASK_PRIORITY_LABEL, normalizeTaskPriority } from "../../goalTrackerUtils";

export const TASK_PRIORITY_CLASS = {
  P0: "task-priority-badge task-priority-p0",
  P1: "task-priority-badge task-priority-p1",
  P2: "task-priority-badge task-priority-p2"
};

export default function TaskPriorityBadge({ priority, className, compact = false }) {
  const p = normalizeTaskPriority(priority);
  const label = TASK_PRIORITY_LABEL[p];
  return (
    <span className={cn(TASK_PRIORITY_CLASS[p], className)}>
      {compact ? p : `${p} · ${label}`}
    </span>
  );
}

export function prioritySelectItemClass(priority) {
  return TASK_PRIORITY_CLASS[normalizeTaskPriority(priority)];
}
