import { useMemo, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "../../supabaseClient";
import {
  productReceiptReview,
  productReceiptSizeRows,
  productReceiptState,
  productReceiptSummary
} from "../../orderTabUtils";

function jobColors(order) {
  if (Array.isArray(order?.colors)) return order.colors.filter(Boolean).join(", ");
  return String(order?.colors ?? "").trim();
}

function savedSizes(order) {
  const rows = productReceiptSizeRows(order);
  const source = order?.product_received_sizes;
  const next = {};
  if (rows.length === 0) {
    next.Total =
      source && source.Total !== undefined && source.Total !== null
        ? String(source.Total)
        : order?.product_received_qty === null || order?.product_received_qty === undefined
          ? ""
          : String(order.product_received_qty);
    return next;
  }
  for (const row of rows) {
    const value = source?.[row.key];
    next[row.key] = value === null || value === undefined ? "" : String(value);
  }
  return next;
}

export default function ProductReceiptControl({ order, canEdit, userId, onSaved }) {
  const state = productReceiptState(order);
  const [open, setOpen] = useState(false);
  const [sizes, setSizes] = useState({});
  const [colorOk, setColorOk] = useState(false);
  const [remark, setRemark] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const review = useMemo(
    () => productReceiptReview(order, sizes, colorOk),
    [order, sizes, colorOk]
  );
  const savedText =
    state === "missing"
      ? "Product not yet reached printing"
      : productReceiptSummary(order) || "Product received";

  function openDialog() {
    setSizes(savedSizes(order));
    setColorOk(order?.product_received_color_ok === true);
    setRemark(String(order?.product_received_issue ?? ""));
    setFile(null);
    setError("");
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!canEdit || !order?.id || !userId) return;
    if (!review.outcome) {
      setError("Enter a whole number for every size.");
      return;
    }
    const note = remark.trim();
    if (review.outcome !== "match" && !note) {
      setError("Write a remark for what does not match.");
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
      const receivedSizes = {};
      for (const line of review.lines) receivedSizes[line.key] = line.received;
      const receivedAt = order.product_received_at || new Date().toISOString();
      const patch = {
        product_received_at: receivedAt,
        product_received_by: userId,
        product_received_proof_url: proofUrl,
        product_received_sizes: receivedSizes,
        product_received_qty: review.lines.reduce((sum, line) => sum + line.received, 0),
        product_received_color_ok: colorOk,
        product_received_issue: review.outcome === "match" ? null : note,
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
    review.outcome === "match"
      ? "text-emerald-700 dark:text-emerald-400"
      : review.outcome === "extra"
        ? "text-yellow-700 dark:text-yellow-400"
        : review.outcome === "short"
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
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product status</DialogTitle>
            <DialogDescription>
              Enter the quantity received for each size. Confirm the color. A size that is short, or a color that does not match, is red. Extra pieces are yellow. A remark is required unless every size and the color match.
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
            </dl>
            {canEdit ? (
              <>
                <div className="grid grid-cols-[5rem_4rem_1fr] items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Size</span>
                  <span className="text-muted-foreground">Job</span>
                  <span className="text-muted-foreground">Received</span>
                  {review.lines.map((line) => (
                    <div key={line.key} className="contents">
                      <span>{line.label}</span>
                      <span>{line.job}</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label={`${line.label} quantity received`}
                        value={sizes[line.key] ?? ""}
                        onChange={(e) =>
                          setSizes((prev) => ({ ...prev, [line.key]: e.target.value }))
                        }
                        required
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`product-color-${order.id}`}
                    checked={colorOk}
                    onCheckedChange={(checked) => setColorOk(checked === true)}
                  />
                  <Label htmlFor={`product-color-${order.id}`}>Color matches the job</Label>
                </div>
                <p className={`text-sm font-medium ${previewClass}`}>
                  {review.outcome === "match"
                    ? "Every size matches and the color is confirmed."
                    : review.outcome === "extra"
                      ? "Extra quantity on at least one size."
                      : review.outcome === "short"
                        ? colorOk
                          ? "A size is short of the job."
                          : "This does not match the job."
                        : "Enter every size to compare it with the job."}
                </p>
                {review.outcome && review.outcome !== "match" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`product-remark-${order.id}`}>Remark</Label>
                    <Textarea
                      id={`product-remark-${order.id}`}
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      placeholder="What does not match"
                      required
                    />
                  </div>
                ) : null}
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
                {order.product_received_proof_url ? (
                  <a
                    className="text-sm underline"
                    href={order.product_received_proof_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open current proof
                  </a>
                ) : null}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                  <Button
                    type="submit"
                    variant={review.outcome === "short" ? "destructive" : "default"}
                    className={
                      review.outcome === "extra"
                        ? "bg-yellow-400 text-yellow-950 hover:bg-yellow-500"
                        : undefined
                    }
                    disabled={saving}
                  >
                    {saving
                      ? "Saving…"
                      : review.outcome === "short"
                        ? "Mark not matching"
                        : review.outcome === "extra"
                          ? "Mark extra quantity"
                          : "Mark product received"}
                  </Button>
                </DialogFooter>
              </>
            ) : (
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
