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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "../../supabaseClient";
import { formatSizeBreakdownSummary } from "../../orderViewUtils";
import {
  productReceiptComparison,
  productReceiptState,
  productReceiptSummary
} from "../../orderTabUtils";

function jobColors(order) {
  if (Array.isArray(order?.colors)) return order.colors.filter(Boolean).join(", ");
  return String(order?.colors ?? "").trim();
}

function parseReceivedQty(value) {
  const text = String(value ?? "").trim();
  if (!text) return { error: "Enter the quantity received." };
  if (!/^\d+$/.test(text)) return { error: "Enter a whole number of pieces." };
  const qty = Number(text);
  if (!Number.isSafeInteger(qty) || qty > 2147483647) {
    return { error: "That quantity is too large." };
  }
  return { qty };
}

export default function ProductReceiptControl({ order, canEdit, userId, onSaved }) {
  const state = productReceiptState(order);
  const [open, setOpen] = useState(false);
  const [receivedQty, setReceivedQty] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const typed = parseReceivedQty(receivedQty);
  const preview = typed.qty === undefined ? null : productReceiptComparison(order.qty, typed.qty);
  const previewText = preview ? productReceiptSummary(order.qty, typed.qty) : "";
  const savedText =
    state === "missing"
      ? "Product not yet reached printing"
      : state === "issue"
        ? `Issue: ${String(order.product_received_issue).trim()}`
        : productReceiptSummary(order.qty, order.product_received_qty) || "Product received";

  function openDialog() {
    setReceivedQty(
      order?.product_received_qty === null || order?.product_received_qty === undefined
        ? ""
        : String(order.product_received_qty)
    );
    setFile(null);
    setError("");
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!canEdit || !order?.id || !userId) return;
    const parsed = parseReceivedQty(receivedQty);
    if (parsed.error) {
      setError(parsed.error);
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
      const result = productReceiptComparison(order.qty, parsed.qty);
      const patch = {
        product_received_at: receivedAt,
        product_received_by: userId,
        product_received_proof_url: proofUrl,
        product_received_qty: parsed.qty,
        product_received_issue: result === "match" ? null : productReceiptSummary(order.qty, parsed.qty),
        received_at_printing: order.received_at_printing || receivedAt
      };
      const { data: saved, error: updateError } = await supabase
        .from("orders")
        .update(patch)
        .eq("id", order.id)
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!saved?.id) {
        throw new Error("Product status was not saved, so order history was not recorded.");
      }
      onSaved?.({ id: order.id, ...patch });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const icon =
    state === "match" ? (
      <CircleCheck className="size-4 text-emerald-600" aria-hidden />
    ) : (
      <CircleAlert
        className={
          state === "short" || state === "issue"
            ? "size-4 text-destructive"
            : state === "extra"
              ? "size-4 text-yellow-500"
              : "size-4 text-amber-600"
        }
        aria-hidden
      />
    );

  const previewClass =
    preview === "match"
      ? "text-emerald-700 dark:text-emerald-400"
      : preview === "extra"
        ? "text-yellow-700 dark:text-yellow-400"
        : preview === "short"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <>
      <div className="flex w-full justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={savedText}
              onClick={openDialog}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{savedText}</TooltipContent>
        </Tooltip>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Product status</DialogTitle>
            <DialogDescription>
              Enter how many pieces arrived. Green matches the job quantity, red is short, and yellow is extra. The result is stamped in order history.
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
              <dt className="text-muted-foreground">Job quantity</dt>
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
                <div className="grid gap-1.5">
                  <Label htmlFor={`product-received-qty-${order.id}`}>Quantity received</Label>
                  <Input
                    id={`product-received-qty-${order.id}`}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(e.target.value)}
                    required
                  />
                </div>
                <p className={`text-sm font-medium ${previewClass}`}>
                  {previewText || "Enter the quantity to compare it with the job."}
                </p>
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
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button
                    type="submit"
                    variant={preview === "short" ? "destructive" : "default"}
                    className={
                      preview === "extra"
                        ? "bg-yellow-400 text-yellow-950 hover:bg-yellow-500"
                        : undefined
                    }
                    disabled={saving}
                  >
                    {saving
                      ? "Saving…"
                      : preview === "short"
                        ? "Mark short quantity"
                        : preview === "extra"
                          ? "Mark extra quantity"
                          : "Mark product received"}
                  </Button>
                </DialogFooter>
              </>
            ) : state === "missing" ? null : (
              <p
                className={
                  state === "short" || state === "issue"
                    ? "text-sm text-destructive"
                    : state === "extra"
                      ? "text-sm text-yellow-700 dark:text-yellow-400"
                      : "text-sm text-emerald-700 dark:text-emerald-400"
                }
              >
                {savedText}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
