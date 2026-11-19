import { useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "../../supabaseClient";
import { formatSizeBreakdownSummary } from "../../orderViewUtils";
import { productReceiptState } from "../../orderTabUtils";

function jobColors(order) {
  if (Array.isArray(order?.colors)) return order.colors.filter(Boolean).join(", ");
  return String(order?.colors ?? "").trim();
}

export default function ProductReceiptControl({ order, canEdit, userId, onSaved }) {
  const state = productReceiptState(order);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("ok");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const title =
    state === "missing"
      ? "Product not yet reached printing"
      : state === "issue"
        ? `Issue: ${String(order.product_received_issue).trim()}`
        : "Product received";

  function openDialog() {
    setMode(state === "issue" ? "issue" : "ok");
    setReason(String(order?.product_received_issue ?? ""));
    setFile(null);
    setError("");
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!canEdit || !order?.id || !userId) return;
    const issue = mode === "issue" ? reason.trim() : "";
    if (mode === "issue" && !issue) {
      setError("Write what is wrong with the product.");
      return;
    }
    if (!file && !order.product_received_proof_url) {
      setError("Upload a photo or file of the product.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let proofUrl = order.product_received_proof_url || null;
      if (file) {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
        const path = `${order.id}/${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("product-receipts")
          .upload(path, file, { upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        const { data: urlData } = supabase.storage.from("product-receipts").getPublicUrl(path);
        proofUrl = urlData?.publicUrl || null;
        if (!proofUrl) throw new Error("Could not get the proof link.");
      }
      const receivedAt = order.product_received_at || new Date().toISOString();
      const patch = {
        product_received_at: receivedAt,
        product_received_by: userId,
        product_received_proof_url: proofUrl,
        product_received_issue: issue || null,
        received_at_printing: order.received_at_printing || receivedAt
      };
      const { error: updateError } = await supabase.from("orders").update(patch).eq("id", order.id);
      if (updateError) throw new Error(updateError.message);
      onSaved?.({ id: order.id, ...patch });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const icon =
    state === "received" ? (
      <CircleCheck className="size-4 text-emerald-600" aria-hidden />
    ) : (
      <CircleAlert
        className={state === "issue" ? "size-4 text-destructive" : "size-4 text-amber-600"}
        aria-hidden
      />
    );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={title}
            onClick={openDialog}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Product status</DialogTitle>
            <DialogDescription>
              {title}. Check the product against this job, then mark it received or record the issue. Upload proof of what arrived.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={save}>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Job</dt>
              <dd>{order.order_id || "—"}</dd>
              <dt className="text-muted-foreground">Customer</dt>
              <dd>{order.customer_name?.trim() || "—"}</dd>
              <dt className="text-muted-foreground">Product</dt>
              <dd>{order.product_name?.trim() || "—"}</dd>
              <dt className="text-muted-foreground">Colors</dt>
              <dd>{jobColors(order) || "—"}</dd>
              <dt className="text-muted-foreground">Quantity</dt>
              <dd>{order.qty ?? "—"}</dd>
              <dt className="text-muted-foreground">Sizes</dt>
              <dd>{formatSizeBreakdownSummary(order.size_breakdown)}</dd>
            </dl>
            {order.product_received_proof_url ? (
              <a
                className="text-sm underline"
                href={order.product_received_proof_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open current proof
              </a>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                This product has not been marked received yet.
              </p>
            )}
            {canEdit ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={mode === "ok" ? "secondary" : "outline"}
                    onClick={() => setMode("ok")}
                  >
                    Matches the job
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "issue" ? "destructive" : "outline"}
                    onClick={() => setMode("issue")}
                  >
                    Product has an issue
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`product-proof-${order.id}`}>Proof of the product</Label>
                  <input
                    id={`product-proof-${order.id}`}
                    type="file"
                    accept="image/*,application/pdf"
                    className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                {mode === "issue" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`product-issue-${order.id}`}>What is wrong</Label>
                    <Textarea
                      id={`product-issue-${order.id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Describe the issue"
                      required
                    />
                  </div>
                ) : null}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button
                    type="submit"
                    variant={mode === "issue" ? "destructive" : "default"}
                    disabled={saving}
                  >
                    {saving
                      ? "Saving…"
                      : mode === "issue"
                        ? "Mark product issue"
                        : "Mark product received"}
                  </Button>
                </DialogFooter>
              </>
            ) : state === "issue" ? (
              <p className="text-sm text-destructive">{order.product_received_issue}</p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
