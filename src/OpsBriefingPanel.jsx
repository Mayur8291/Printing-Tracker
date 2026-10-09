import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Banknote, Factory, ListTodo, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { subscribePostgresChanges } from "./realtimeUtils";
import {
  compactQueueForAi,
  createOpsFollowupTask,
  defaultFollowupTitle,
  fetchOpsBriefing,
  followupLinkKey,
  pingOpsAiChat,
  sendOpsAiChat
} from "./opsBriefingUtils";

function QueueRow({ code, customer, why, linked, saving, onMakeTask }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-b py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {code || "—"}
          {customer ? <span className="font-normal text-muted-foreground"> · {customer}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">{why}</p>
      </div>
      {linked ? (
        <Badge variant="outline">Task made</Badge>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onMakeTask}>
          Make task
        </Button>
      )}
    </li>
  );
}

function QueueCard({ title, icon: QueueIcon, rows, emptyLabel, linked, savingKey, onMakeTask }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <QueueIcon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="mb-2 text-3xl font-bold tabular-nums">{rows.length}</p>
        {rows.length === 0 ? (
          <Empty className="border-0 p-3 md:p-3">
            <EmptyHeader>
              <EmptyTitle className="text-sm">{emptyLabel}</EmptyTitle>
              <EmptyDescription>Nothing in this queue.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="h-56">
            <ul className="pr-3">
              {rows.map((row) => {
                const kind = row.sourceKind;
                const sourceId = row.sourceId;
                const key = followupLinkKey(kind, sourceId);
                return (
                  <QueueRow
                    key={key}
                    code={row.code}
                    customer={row.customer}
                    why={row.why}
                    linked={linked.has(key)}
                    saving={savingKey === key}
                    onMakeTask={() => onMakeTask(row)}
                  />
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default function OpsBriefingPanel({ userId, onOpenGoalsTab }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState([]);
  const [production, setProduction] = useState([]);
  const [pendingPay, setPendingPay] = useState([]);
  const [linked, setLinked] = useState(() => new Set());
  const [savingKey, setSavingKey] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(null);
  const [chatOffReason, setChatOffReason] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!userId) return;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const data = await fetchOpsBriefing();
      setJobs(data.jobs);
      setProduction(data.production);
      setPendingPay(data.pendingPay);
      setLinked(data.linked);
    } catch (e) {
      if (!silent) setError(e.message || "Could not load today queue.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribePostgresChanges({
      channelName: `ops-briefing-live-${userId}`,
      tables: ["orders", "ops_followup_task_link", "ops_briefing_notifications", "user_goal_tasks"],
      onEvent: () => {
        void load({ silent: true });
      }
    });
  }, [userId, load]);

  useEffect(() => {
    if (!chatOpen) return;
    let cancelled = false;
    void pingOpsAiChat().then((res) => {
      if (cancelled) return;
      setChatEnabled(res.chatEnabled);
      setChatOffReason(res.error || "");
    });
    return () => {
      cancelled = true;
    };
  }, [chatOpen]);

  async function handleMakeTask(row) {
    const key = followupLinkKey(row.sourceKind, row.sourceId);
    setSavingKey(key);
    setError("");
    try {
      await createOpsFollowupTask({
        sourceKind: row.sourceKind,
        sourceId: row.sourceId,
        title: defaultFollowupTitle(row.sourceKind, row.code, row.customer),
        description: row.why
      });
      await load({ silent: true });
    } catch (e) {
      setError(e.message || "Could not make task.");
    } finally {
      setSavingKey("");
    }
  }

  const jobRows = jobs.map((row) => ({
    sourceKind: "open_job",
    sourceId: String(row.order_pk),
    code: row.code,
    customer: row.customer_name,
    why: row.why
  }));
  const prodRows = production.map((row) => ({
    sourceKind: "production",
    sourceId: String(row.order_pk),
    code: row.code,
    customer: row.customer_name,
    why: row.why
  }));
  const payRows = pendingPay.map((row) => ({
    sourceKind: row.source_kind,
    sourceId: String(row.source_id),
    code: row.code,
    customer: row.customer_name,
    why: row.why
  }));

  async function handleSendChat() {
    const text = draft.trim();
    if (!text || sending || chatEnabled === false) return;
    setSending(true);
    setError("");
    const nextHistory = [...messages, { role: "user", text }];
    setMessages(nextHistory);
    setDraft("");
    try {
      const result = await sendOpsAiChat({
        message: text,
        history: nextHistory.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        queue: compactQueueForAi({ jobs, production, pendingPay })
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: result.reply || "Done." }
      ]);
      if (result.tasksCreated?.length) {
        await load({ silent: true });
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: e.message || "Chat failed." }
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!userId) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ops-briefing-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="ops-briefing-title" className="text-xl font-semibold tracking-tight">
            Today
          </h2>
          <p className="text-sm text-muted-foreground">
            Follow-ups on jobs you placed, production, and pending pay. Tasks only — no auto orders.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setChatOpen(true)}>
            <Sparkles data-icon="inline-start" />
            Ask AI
          </Button>
          {onOpenGoalsTab ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenGoalsTab}>
              Open Goals & Tasks
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <QueueCard
            title="Follow-ups"
            icon={ListTodo}
            rows={jobRows}
            emptyLabel="No open jobs"
            linked={linked}
            savingKey={savingKey}
            onMakeTask={handleMakeTask}
          />
          <QueueCard
            title="Production"
            icon={Factory}
            rows={prodRows}
            emptyLabel="No production follow-up"
            linked={linked}
            savingKey={savingKey}
            onMakeTask={handleMakeTask}
          />
          <QueueCard
            title="Pending pay"
            icon={Banknote}
            rows={payRows}
            emptyLabel="No pending pay"
            linked={linked}
            savingKey={savingKey}
            onMakeTask={handleMakeTask}
          />
        </div>
      )}

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertCircle />
            {error}
          </CardContent>
        </Card>
      ) : null}

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>Ask AI</SheetTitle>
            <SheetDescription>
              Talk with Wispr in the box. AI can only make follow-up tasks from your Today queue.
            </SheetDescription>
          </SheetHeader>
          {chatEnabled === false ? (
            <p className="text-sm text-muted-foreground">
              {chatOffReason || "Briefing works. Chat off until API key."}
            </p>
          ) : (
            <>
              <ScrollArea className="h-72">
                <div className="flex flex-col gap-3 pr-3">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Example: make a task to chase pending on my oldest job.
                    </p>
                  ) : (
                    messages.map((m, i) => (
                      <p key={`${m.role}-${i}`} className="text-sm">
                        <span className="font-medium">{m.role === "user" ? "You" : "AI"}: </span>
                        <span className="text-muted-foreground whitespace-pre-wrap">{m.text}</span>
                      </p>
                    ))
                  )}
                </div>
              </ScrollArea>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ops-ai-draft">Message</FieldLabel>
                  <Textarea
                    id="ops-ai-draft"
                    rows={4}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Click here, talk with Wispr, then Send…"
                  />
                  <Button
                    type="button"
                    disabled={sending || !draft.trim() || chatEnabled === false}
                    onClick={() => void handleSendChat()}
                  >
                    {sending ? "Thinking…" : "Send"}
                  </Button>
                </Field>
              </FieldGroup>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
