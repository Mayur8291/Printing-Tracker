import { profileDisplayName } from "../../goalTrackerUtils";

/**
 * Labeled goal/task fields for admin review lists.
 */
export default function GoalTaskDetailGrid({ task, assignee, goalTitle }) {
  const resolvedGoalTitle = goalTitle || task?.goal?.title || "—";
  const resolvedAssignee =
    assignee ||
    (task?.assignee && typeof task.assignee === "object" ? task.assignee : null);

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Goal title
        </dt>
        <dd className="mt-0.5 text-sm text-foreground">{resolvedGoalTitle}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Task title
        </dt>
        <dd className="mt-0.5 text-sm font-medium text-foreground">{task?.title || "—"}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Task description
        </dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
          {task?.description?.trim() || "—"}
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          User name
        </dt>
        <dd className="mt-0.5 text-sm text-foreground">{profileDisplayName(resolvedAssignee)}</dd>
      </div>
    </dl>
  );
}
