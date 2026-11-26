import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "../../supabaseClient";
import {
  ORDER_CHANGE_FIELDS,
  orderChangeDraft,
  orderChangePayload,
  orderChangePreviewLines,
  orderChangeSizeRows,
  orderChangeSizeTotal,
  orderChangeSummaryLines
} from "../../orderChangeRequestUtils";

export default function OrderChangeRequestDialog({
  order,
  open,
  canReview,
  isAdmin,
  userId,
  onClose,
  onChanged
}) {
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState({});
  const [note, setNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !order?.id) return undefined;
    let cancelled = false;
    setDraft(orderChangeDraft(order));
    setNote("");
    setReviewNote("");
    setError("");
    setPending(null);
    setLoading(true);
    supabase
      .from("order_change_requests")
      .select("id, status, summary, note, requested_by, requested_by_label, requested_at")
      .eq("order_id", order.id)
      .eq("status", "pending")
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) setError(loadError.message);
        else setPending(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, order]);

  const preview = useMemo(() => (order ? orderChangePreviewLines(order, draft) : []), [order, draft]);
  const sizeRows = order ? orderChangeSizeRows(order) : [];
  const sizeTotal = order ? orderChangeSizeTotal(order, draft) : null;
  const ownRequest = Boolean(pending && userId && pending.requested_by === userId);
  const canDecide = Boolean(pending && canReview && (isAdmin || !ownRequest));

  async function submit(event) {
    event.preventDefault();
    if (!order?.id || saving) return;
    if (orderChangeSizeRows(order).length > 0 && orderChangeSizeTotal(order, draft) === null) {
      setError("Each size must be a whole number.");
      return;
    }
    const changes = orderChangePayload(order, draft);
    if (Object.keys(changes).length === 0) {
      setError("Change at least one field.");
      return;
    }
    if (!note.trim()) {
      setError("Write a note for the change.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await supabase.rpc("submit_order_change_request", {
      p_order_id: order.id,
      p_changes: changes,
      p_note: note.trim()
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onChanged?.();
    onClose?.();
  }

  async function review(decision) {
    if (!pending?.id || saving) return;
    if (decision === "denied" && !reviewNote.trim()) {
      setError("Write why the change is denied.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await supabase.rpc("review_order_change_request", {
      p_request_id: pending.id,
      p_decision: decision,
      p_review_note: reviewNote.trim() || null
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onChanged?.();
    onClose?.();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose?.()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request change</DialogTitle>
          <DialogDescription>
            {order?.order_id ? `Order ${order.order_id}` : "Printing order"}
            {order?.customer_name ? ` · ${order.customer_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

        {!loading && pending ? (
          <div className="space-y-3">
            <p className="whitespace-pre-line text-sm">
              {orderChangeSummaryLines(pending.summary).join("\n")}
            </p>
            <p className="text-xs text-muted-foreground">
              Requested by {pending.requested_by_label || "User"}
            </p>
            {canDecide ? (
              <div className="grid gap-2">
                <Label htmlFor="order-change-review-note">Review note</Label>
                <Textarea
                  id="order-change-review-note"
                  rows={3}
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="Required when denying"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for someone who can accept or deny this.</p>
            )}
          </div>
        ) : null}

        {!loading && !pending && order ? (
          <form id="order-change-request-form" className="space-y-3" onSubmit={submit}>
            {sizeRows.length > 0 ? (
              <div className="space-y-2">
                <Label>Sizes</Label>
                {sizeRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[4.5rem_4rem_1fr] items-center gap-2">
                    <span className="text-sm">{row.label}</span>
                    <span className="text-sm text-muted-foreground">{row.qty}</span>
                    <Input
                      id={`order-change-size-${row.key}`}
                      type="number"
                      min={0}
                      step={1}
                      aria-label={`New ${row.label}`}
                      value={draft.sizes?.[row.key] ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          sizes: { ...prev.sizes, [row.key]: event.target.value }
                        }))
                      }
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Now {order.qty ?? 0}. New total {sizeTotal ?? order.qty ?? 0}.
                </p>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="order-change-qty">Qty</Label>
                <Input
                  id="order-change-qty"
                  type="number"
                  min={0}
                  step={1}
                  value={draft.qty ?? ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, qty: event.target.value }))}
                />
              </div>
            )}
            {ORDER_CHANGE_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`order-change-${field.key}`}>{field.label}</Label>
                {field.key === "remarks" ? (
                  <Textarea
                    id="order-change-remarks"
                    rows={2}
                    value={draft.remarks ?? ""}
                    onChange={(event) => setDraft((prev) => ({ ...prev, remarks: event.target.value }))}
                  />
                ) : (
                  <Input
                    id={`order-change-${field.key}`}
                    type={field.key === "due_date" ? "date" : "text"}
                    value={draft[field.key] ?? ""}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label htmlFor="order-change-note">Note</Label>
              <Textarea
                id="order-change-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why this change is needed"
              />
            </div>
            {preview.length > 0 ? (
              <p className="whitespace-pre-line rounded-md border bg-muted/40 p-3 text-sm">
                {preview.join("\n")}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Change at least one field. The note is kept in order history.</p>
            )}
          </form>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {!loading && pending && canDecide ? (
            <>
              <Button type="button" variant="destructive" disabled={saving} onClick={() => review("denied")}>
                {saving ? "Saving…" : "Deny"}
              </Button>
              <Button type="button" disabled={saving} onClick={() => review("accepted")}>
                {saving ? "Saving…" : "Accept"}
              </Button>
            </>
          ) : null}
          {!loading && !pending ? (
            <Button type="submit" form="order-change-request-form" disabled={saving}>
              {saving ? "Sending…" : "Send request"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
