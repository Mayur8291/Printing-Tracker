import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Share2 } from "lucide-react";
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
  productReceiptHistoryText,
  productReceiptReview,
  productReceiptSizeRows,
  productReceiptState,
  productReceiptSummary
} from "../../orderTabUtils";
import { swatchBackgroundForColor } from "../../orderColorUtils";
import { shareElementImage } from "../../dealerCardShare";

function colorList(order) {
  if (Array.isArray(order?.colors)) {
    return order.colors.map((color) => String(color ?? "").trim()).filter(Boolean);
  }
  const raw = String(order?.colors ?? "").trim();
  if (!raw) return [];
  return raw.split(/[,;/]+/).map((color) => color.trim()).filter(Boolean);
}

function varianceLines(review) {
  const rows = [];
  if (review.noPicklist) rows.push("No picklist — rejected by printing");
  for (const line of review.lines || []) {
    if (line.result === "short") {
      rows.push(`${line.label}: received ${line.received} of ${line.job} — short ${line.job - line.received}`);
    } else if (line.result === "extra") {
      rows.push(`${line.label}: received ${line.received} of ${line.job} — extra ${line.received - line.job}`);
    }
  }
  if (!review.noPicklist && review.outcome && review.colorOk === false) rows.push("Color issue");
  if (review.productMismatch) rows.push("Product mismatch");
  return rows;
}

function shareFileName(order) {
  const base = String(order?.order_id || "order")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "order"}-shortage.png`;
}

function ReceiptShareCard({ order, coordinatorName, lines, remark }) {
  const row = { display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid #e2e8f0" };
  const label = { color: "#64748b", fontSize: 13 };
  const value = { fontWeight: 700, fontSize: 15, textAlign: "right" };
  return (
    <div
      style={{
        width: 420,
        boxSizing: "border-box",
        background: "#ffffff",
        color: "#0f172a",
        fontFamily: "system-ui, sans-serif",
        padding: 20
      }}
    >
      <div style={{ background: "#b91c1c", color: "#ffffff", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em" }}>PRINTING</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Shortage and extra</div>
      </div>
      <div style={row}>
        <span style={label}>Order number</span>
        <span style={value}>{order.order_id || "—"}</span>
      </div>
      <div style={row}>
        <span style={label}>Customer</span>
        <span style={value}>{order.customer_name?.trim() || "—"}</span>
      </div>
      <div style={row}>
        <span style={label}>Coordinator</span>
        <span style={value}>{coordinatorName?.trim() || "—"}</span>
      </div>
      <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: "#64748b" }}>Details</div>
      <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-line" }}>
        {lines.length ? lines.join("\n") : "No shortage or extra."}
      </div>
      <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: "#64748b" }}>Remarks</div>
      <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-line" }}>
        {remark?.trim() || "—"}
      </div>
    </div>
  );
}

function ColorBoxes({ order }) {
  const colors = colorList(order);
  if (colors.length === 0) return "—";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="list" aria-label="Colors">
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          role="listitem"
          title={color}
          className="inline-block size-6 shrink-0 rounded-md border border-white/70 shadow-sm ring-1 ring-black/25"
          style={{ backgroundColor: swatchBackgroundForColor(color) }}
        >
          <span className="sr-only">{color}</span>
        </span>
      ))}
    </span>
  );
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

export default function ProductReceiptControl({ order, canEdit, userId, onSaved, coordinatorName }) {
  const state = productReceiptState(order);
  const [open, setOpen] = useState(false);
  const [sizes, setSizes] = useState({});
  const [colorOk, setColorOk] = useState(false);
  const [productMismatch, setProductMismatch] = useState(false);
  const [noPicklist, setNoPicklist] = useState(false);
  const [remark, setRemark] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [error, setError] = useState("");
  const shareCardRef = useRef(null);

  const review = useMemo(
    () => productReceiptReview(order, sizes, { colorOk, productMismatch, noPicklist }),
    [order, sizes, colorOk, productMismatch, noPicklist]
  );
  const previewText = productReceiptHistoryText({
    lines: noPicklist ? review.lines.filter((line) => line.received !== null) : review.lines,
    colorOk: noPicklist ? null : colorOk,
    productMismatch,
    noPicklist,
    remark
  });
  const savedText =
    state === "missing"
      ? "Product not yet reached printing"
      : productReceiptSummary(order) || "Product received";

  function openDialog() {
    setSizes(savedSizes(order));
    setColorOk(order?.product_received_color_ok === true);
    setProductMismatch(order?.product_received_product_ok === false);
    setNoPicklist(order?.product_received_no_picklist === true);
    setRemark(String(order?.product_received_issue ?? ""));
    setFile(null);
    setError("");
    setShareNote("");
    setOpen(true);
  }

  const shortageLines = varianceLines(review);
  const coordinator = coordinatorName || order?.coordinator_name;

  async function shareSnapshot() {
    const element = shareCardRef.current;
    if (!element || sharing) return;
    setSharing(true);
    setShareNote("");
    try {
      const result = await shareElementImage(element, shareFileName(order));
      if (result.method === "download") {
        setShareNote("Image saved. Attach it in WhatsApp.");
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        setShareNote(err instanceof Error ? err.message : "Could not share the image.");
      }
    } finally {
      setSharing(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!canEdit || !order?.id || !userId) return;
    if (!noPicklist && !review.outcome) {
      setError("Enter a whole number for every size.");
      return;
    }
    const note = remark.trim();
    if (review.outcome !== "match" && !note) {
      setError("Write a remark for what does not match.");
      return;
    }
    if (!noPicklist && !file && !order.product_received_proof_url) {
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
      const counted = review.lines.filter((line) => line.received !== null);
      const receivedSizes = counted.length
        ? Object.fromEntries(counted.map((line) => [line.key, line.received]))
        : null;
      const receivedAt = order.product_received_at || new Date().toISOString();
      const patch = {
        product_received_at: receivedAt,
        product_received_by: userId,
        product_received_proof_url: proofUrl,
        product_received_sizes: receivedSizes,
        product_received_qty: counted.length
          ? counted.reduce((sum, line) => sum + line.received, 0)
          : null,
        product_received_color_ok: noPicklist ? null : colorOk,
        product_received_product_ok: productMismatch ? false : true,
        product_received_no_picklist: noPicklist,
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
          state === "short" || state === "issue" || state === "rejected"
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
        : review.outcome === "short" || review.outcome === "rejected"
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
        <DialogContent data-mobile-fullscreen="" className="max-h-[85vh] max-w-lg overflow-y-auto max-md:rounded-none">
          <DialogHeader>
            <DialogTitle>Product status</DialogTitle>
            <DialogDescription>
              Enter each size. Short and extra sizes are flagged. Mark a color issue or a product mismatch when it applies. Use the no-picklist option when printing rejects the order. The remark stays your own note.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto" onSubmit={save}>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Order number</dt>
              <dd>{order.order_id || "—"}</dd>
              <dt className="text-muted-foreground">Customer</dt>
              <dd>{order.customer_name?.trim() || "—"}</dd>
              <dt className="text-muted-foreground">Product</dt>
              <dd>{order.product_name?.trim() || "—"}</dd>
              <dt className="text-muted-foreground">Colors</dt>
              <dd>
                <ColorBoxes order={order} />
              </dd>
            </dl>
            {canEdit ? (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`product-no-picklist-${order.id}`}
                    checked={noPicklist}
                    onCheckedChange={(checked) => setNoPicklist(checked === true)}
                  />
                  <Label htmlFor={`product-no-picklist-${order.id}`}>
                    No picklist — rejected by printing
                  </Label>
                </div>
                <div className="grid grid-cols-[4.5rem_3rem_1fr_4.5rem] items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Size</span>
                  <span className="text-muted-foreground">Job</span>
                  <span className="text-muted-foreground">Received</span>
                  <span className="text-muted-foreground">Flag</span>
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
                        required={!noPicklist}
                      />
                      <span
                        className={
                          line.result === "short"
                            ? "font-medium text-destructive"
                            : line.result === "extra"
                              ? "font-medium text-yellow-700 dark:text-yellow-400"
                              : line.result === "match"
                                ? "font-medium text-emerald-700 dark:text-emerald-400"
                                : "text-muted-foreground"
                        }
                      >
                        {line.result === "short" ? "Short" : line.result === "extra" ? "Extra" : line.result === "match" ? "OK" : "—"}
                      </span>
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
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`product-mismatch-${order.id}`}
                    checked={productMismatch}
                    onCheckedChange={(checked) => setProductMismatch(checked === true)}
                  />
                  <Label htmlFor={`product-mismatch-${order.id}`}>Product mismatch</Label>
                </div>
                <p className={`whitespace-pre-line text-sm font-medium ${previewClass}`}>
                  {previewText || "Enter every size to compare it with the job."}
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
                {shareNote ? <p className="text-sm text-muted-foreground">{shareNote}</p> : null}
                <DialogFooter className="flex-row justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={sharing}
                    onClick={() => void shareSnapshot()}
                  >
                    <Share2 />
                    {sharing ? "Preparing…" : "Share"}
                  </Button>
                  <Button
                    type="submit"
                    variant={review.outcome === "short" || review.outcome === "rejected" ? "destructive" : "default"}
                    className={
                      review.outcome === "extra"
                        ? "min-h-11 bg-yellow-400 text-yellow-950 hover:bg-yellow-500"
                        : "min-h-11"
                    }
                    disabled={saving}
                  >
                    {saving
                      ? "Saving…"
                      : review.outcome === "rejected"
                        ? "Reject — no picklist"
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
                className={`whitespace-pre-line text-sm ${
                  state === "short" || state === "issue" || state === "rejected"
                    ? "text-destructive"
                    : state === "extra"
                      ? "text-yellow-700 dark:text-yellow-400"
                      : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {savedText}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
      {open
        ? createPortal(
            <div
              ref={shareCardRef}
              aria-hidden
              style={{ position: "fixed", left: -2000, top: 0, width: 420 }}
            >
              <ReceiptShareCard
                order={order}
                coordinatorName={coordinator}
                lines={shortageLines}
                remark={remark}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
