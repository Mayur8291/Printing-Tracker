import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "../../supabaseClient";
import { orderChangeSummaryLines } from "../../orderChangeRequestUtils";

export default function OrderChangeRequestQueue({ orders, canReview, isAdmin, userId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    if (!canReview) return;
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("order_change_requests")
      .select("id, order_id, summary, requested_by, requested_by_label, requested_at")
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(50);
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      setRows([]);
      return;
    }
    setError("");
    setRows(data ?? []);
  }, [canReview]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canReview) return null;

  async function review(row, decision) {
    const reviewNote = String(notes[row.id] ?? "").trim();
    if (decision === "denied" && !reviewNote) {
      setError("Write why the change is denied.");
      return;
    }
    setSavingId(row.id);
    setError("");
    const { error: saveError } = await supabase.rpc("review_order_change_request", {
      p_request_id: row.id,
      p_decision: decision,
      p_review_note: reviewNote || null
    });
    setSavingId(null);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setNotes((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await load();
    onChanged?.();
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setOpen(true); load(); }}>
        Change requests{rows.length ? ` (${rows.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change requests</DialogTitle>
            <DialogDescription>Accept or deny a printing order change. The request stays in order history.</DialogDescription>
          </DialogHeader>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No change is waiting.</p>
          ) : null}
          <div className="space-y-4">
            {rows.map((row) => {
              const order = orders.find((item) => item.id === row.order_id);
              const own = userId && row.requested_by === userId;
              const blocked = own && !isAdmin;
              return (
                <div key={row.id} className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {order?.order_id || `Order ${row.order_id}`}
                    {order?.customer_name ? ` · ${order.customer_name}` : ""}
                  </p>
                  <p className="whitespace-pre-line text-sm">{orderChangeSummaryLines(row.summary).join("\n")}</p>
                  <p className="text-xs text-muted-foreground">Requested by {row.requested_by_label || "User"}</p>
                  {blocked ? (
                    <p className="text-sm text-muted-foreground">Someone else has to accept or deny this request.</p>
                  ) : (
                    <>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`queue-note-${row.id}`}>Review note</Label>
                        <Textarea
                          id={`queue-note-${row.id}`}
                          rows={2}
                          value={notes[row.id] ?? ""}
                          onChange={(event) =>
                            setNotes((prev) => ({ ...prev, [row.id]: event.target.value }))
                          }
                          placeholder="Required when denying"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={savingId === row.id}
                          onClick={() => review(row, "denied")}
                        >
                          Deny
                        </Button>
                        <Button type="button" disabled={savingId === row.id} onClick={() => review(row, "accepted")}>
                          Accept
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
