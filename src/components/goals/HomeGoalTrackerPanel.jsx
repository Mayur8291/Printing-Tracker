import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CalendarClock, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  currentGoalYear,
  fetchGoalsForUser,
  fetchMyAssignedTasks,
  formatGoalDeadline,
  GOAL_STATUS_LABEL,
  summarizeHomeGoals,
  TASK_STATUS_LABEL
} from "../../goalTrackerUtils";

export default function HomeGoalTrackerPanel({ userId, onOpenGoalsTab }) {
  const year = currentGoalYear();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const [goals, tasks] = await Promise.all([
        fetchGoalsForUser(userId, year),
        fetchMyAssignedTasks(userId, year)
      ]);
      setSummary(summarizeHomeGoals(goals, tasks));
    } catch (e) {
      setError(e.message || "Could not load goals.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [userId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!userId) return null;

  return (
    <section className="space-y-4" aria-labelledby="home-goals-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="home-goals-title" className="text-xl font-semibold tracking-tight">
            My {year} goals & tasks
          </h2>
          <p className="text-sm text-muted-foreground">
            Annual goals from admin and tasks assigned to you.
          </p>
        </div>
        {onOpenGoalsTab ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenGoalsTab}>
            Open Goals & Tasks
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="text-sm font-medium">Annual goals</CardTitle>
                <Target className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-3xl font-bold tabular-nums">{summary?.goalCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">
                  {summary?.activeGoalCount ?? 0} active
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="text-sm font-medium">Open tasks</CardTitle>
                <CalendarClock className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-3xl font-bold tabular-nums">{summary?.openTaskCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">Assigned to you</p>
              </CardContent>
            </Card>
            <Card
              className={cn(
                "shadow-sm",
                (summary?.overdueCount ?? 0) > 0 && "border-destructive/40 bg-destructive/5"
              )}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="text-sm font-medium">Overdue</CardTitle>
                <AlertCircle
                  className={cn(
                    "size-4",
                    (summary?.overdueCount ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"
                  )}
                />
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-3xl font-bold tabular-nums">{summary?.overdueCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">Past deadline</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="text-sm font-medium">Year</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-3xl font-bold tabular-nums">{year}</p>
                <p className="text-xs text-muted-foreground">Annual cycle</p>
              </CardContent>
            </Card>
          </div>

          {(summary?.upcoming?.length ?? 0) > 0 ? (
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">Upcoming deadlines</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {summary.upcoming.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{task.title}</p>
                      {task.goal?.title ? (
                        <p className="text-xs text-muted-foreground">Goal: {task.goal.title}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatGoalDeadline(task.deadline_date)}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : summary?.goalCount === 0 && summary?.openTaskCount === 0 ? (
            <Card className="shadow-sm">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No goals or tasks yet for {year}. Admin can set annual goals; anyone can assign tasks
                with deadlines.
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </section>
  );
}
