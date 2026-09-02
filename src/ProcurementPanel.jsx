import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AlertTriangle, FileText, Plus, RefreshCw, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { supabase } from "./supabaseClient";
import { fetchEntities, fetchLocations, fetchParties, fetchSkus } from "./mastersUtils";
import {
  BILL_STATUS_LABEL,
  PAYMENT_MODES,
  PO_STATUS_LABEL,
  approveBill,
  approvePo,
  cancelBill,
  cancelPo,
  closePo,
  createDraftBill,
  createDraftPo,
  fetchBills,
  fetchGrnsForPoLines,
  fetchOutstandingBills,
  fetchPayments,
  fetchPoSettings,
  fetchPurchaseOrders,
  fetchUnbilledGrnLines,
  fetchVendorLedger,
  formatMoney,
  poLinePending,
  receiveGrn,
  recordPayment,
  recordQc,
  savePoSettings,
  shortClosePo
} from "./procurementUtils";

const PO_STATUS_BADGE = {
  draft: "bg-slate-50 text-slate-700 border-slate-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  partially_received: "bg-amber-50 text-amber-700 border-amber-200",
  fulfilled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  short_closed: "bg-orange-50 text-orange-700 border-orange-200",
  cancelled: "bg-red-50 text-red-700 border-red-200"
};

const BILL_STATUS_BADGE = {
  draft: "bg-slate-50 text-slate-700 border-slate-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200"
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Create PO dialog
// ---------------------------------------------------------------------------

function CreatePoDialog({ open, onOpenChange, vendors, entities, locations, skus, onCreated }) {
  const [vendorId, setVendorId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [expectedDate, setExpectedDate] = useState("");
  const [creditDays, setCreditDays] = useState("0");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ skuCode: "", qty: "", rate: "", taxPct: "" }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const skuByCode = useMemo(() => {
    const map = new Map();
    for (const s of skus) map.set(s.sku_code.toLowerCase(), s);
    return map;
  }, [skus]);

  const reset = () => {
    setVendorId("");
    setEntityId(entities.length === 1 ? entities[0].id : "");
    setLocationId("");
    setOrderDate(todayIso());
    setExpectedDate("");
    setCreditDays("0");
    setNote("");
    setLines([{ skuCode: "", qty: "", rate: "", taxPct: "" }]);
    setError("");
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickVendor = (id) => {
    setVendorId(id);
    const v = vendors.find((x) => x.id === id);
    if (v) setCreditDays(String(v.credit_days ?? 0));
  };

  const updateLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    setError("");
    if (!vendorId || !entityId || !locationId) {
      setError("Vendor, entity and delivery location are required.");
      return;
    }
    const parsed = [];
    for (const [i, l] of lines.entries()) {
      if (!l.skuCode.trim() && !l.qty && !l.rate) continue; // blank row
      const sku = skuByCode.get(l.skuCode.trim().toLowerCase());
      if (!sku) {
        setError(`Line ${i + 1}: SKU code "${l.skuCode}" not found in masters.`);
        return;
      }
      const qty = Number(l.qty);
      const rate = Number(l.rate);
      if (!(qty > 0) || !(rate >= 0)) {
        setError(`Line ${i + 1}: quantity must be > 0 and rate ≥ 0.`);
        return;
      }
      parsed.push({ skuId: sku.id, qty, rate, taxPct: Number(l.taxPct) || 0 });
    }
    if (!parsed.length) {
      setError("Add at least one line.");
      return;
    }
    setSaving(true);
    try {
      await createDraftPo({
        entityId,
        vendorId,
        deliveryLocationId: locationId,
        orderDate,
        expectedDate: expectedDate || null,
        creditDays: Number(creditDays) || 0,
        note,
        lines: parsed
      });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError(e.message || "Could not create the PO.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Saved as a draft — nothing is committed until an admin approves it (number assigned then).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={pickVendor}>
              <SelectTrigger><SelectValue placeholder="Pick vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Buying entity</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Pick entity" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.code} — {e.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Delivery location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Pick location" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Credit days</Label>
            <Input type="number" min="0" value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Order date</Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Expected date</Label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Lines</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, { skuCode: "", qty: "", rate: "", taxPct: "" }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add line
            </Button>
          </div>
          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_90px_70px_32px] items-center gap-2">
              <Input
                placeholder="SKU code"
                value={l.skuCode}
                onChange={(e) => updateLine(idx, { skuCode: e.target.value })}
              />
              <Input
                type="number" min="0" placeholder="Qty"
                value={l.qty}
                onChange={(e) => updateLine(idx, { qty: e.target.value })}
              />
              <Input
                type="number" min="0" placeholder="Rate"
                value={l.rate}
                onChange={(e) => updateLine(idx, { rate: e.target.value })}
              />
              <Input
                type="number" min="0" placeholder="Tax %"
                value={l.taxPct}
                onChange={(e) => updateLine(idx, { taxPct: e.target.value })}
              />
              <Button
                type="button" variant="ghost" size="icon"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                disabled={lines.length === 1}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>

        <div className="grid gap-1.5">
          <Label>Note</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create draft PO"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Receive-goods dialog (creates + posts a GRN against the open PO)
// ---------------------------------------------------------------------------

function ReceiveGrnDialog({ open, onOpenChange, po, onReceived }) {
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [lrNo, setLrNo] = useState("");
  const [transporter, setTransporter] = useState("");
  const [note, setNote] = useState("");
  const [qtyByLine, setQtyByLine] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setReceivedDate(todayIso());
      setLrNo("");
      setTransporter("");
      setNote("");
      setQtyByLine({});
      setError("");
    }
  }, [open]);

  if (!po) return null;
  const openLines = po.po_line.filter((l) => poLinePending(l) > 0);

  const submit = async () => {
    setError("");
    const lines = [];
    for (const l of po.po_line) {
      const raw = qtyByLine[l.id];
      if (!raw) continue;
      const qty = Number(raw);
      if (!(qty > 0)) continue;
      lines.push({ poLineId: l.id, qty });
    }
    if (!lines.length) {
      setError("Enter a received quantity on at least one line.");
      return;
    }
    setSaving(true);
    try {
      const grnNo = await receiveGrn({
        entityId: po.entity.id,
        vendorId: po.vendor.id,
        locationId: po.location.id,
        receivedDate,
        lrNo,
        transporter,
        note,
        lines
      });
      onOpenChange(false);
      onReceived(grnNo);
    } catch (e) {
      setError(e.message || "Could not post the GRN.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Receive goods — {po.po_no ?? "PO"}</DialogTitle>
          <DialogDescription>
            Posts a GRN into {po.location?.code}. QC-required stock lands in QC hold; over-receipt
            beyond tolerance is blocked by the database.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Received date</Label>
            <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>LR no.</Label>
            <Input value={lrNo} onChange={(e) => setLrNo(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Transporter</Label>
            <Input value={transporter} onChange={(e) => setTransporter(e.target.value)} />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="w-28 text-right">Receive qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  Nothing pending on this PO.
                </TableCell>
              </TableRow>
            ) : (
              openLines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.cat_sku?.sku_code}</TableCell>
                  <TableCell className="text-right">{poLinePending(l)}</TableCell>
                  <TableCell>
                    <Input
                      type="number" min="0" className="text-right"
                      value={qtyByLine[l.id] ?? ""}
                      onChange={(e) => setQtyByLine((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="grid gap-1.5">
          <Label>Note (shortage / damage remarks)</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || openLines.length === 0}>
            {saving ? "Posting…" : "Post GRN"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PO detail dialog: lines, GRN history, QC queue, lifecycle actions
// ---------------------------------------------------------------------------

function PoDetailDialog({ open, onOpenChange, po, onChanged }) {
  const [grnLines, setGrnLines] = useState([]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [qcDraft, setQcDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const loadGrns = useCallback(async () => {
    if (!po) return;
    try {
      setGrnLines(await fetchGrnsForPoLines(po.po_line.map((l) => l.id)));
    } catch (e) {
      setError(e.message || "Could not load GRNs.");
    }
  }, [po]);

  useEffect(() => {
    if (open) {
      setError("");
      setInfo("");
      setReason("");
      setQcDraft({});
      loadGrns();
    }
  }, [open, loadGrns]);

  if (!po) return null;

  const skuByPoLine = Object.fromEntries(po.po_line.map((l) => [l.id, l.cat_sku?.sku_code]));
  const qcQueue = grnLines.filter(
    (g) =>
      g.po_grn?.status === "posted" &&
      g.qc_required &&
      Number(g.qty) - Number(g.qty_qc_pass) - Number(g.qty_qc_fail) > 0
  );

  const run = async (fn, okMessage) => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const result = await fn();
      setInfo(typeof result === "string" ? `${okMessage} ${result}` : okMessage);
      setReason("");
      await loadGrns();
      onChanged();
    } catch (e) {
      setError(e.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitQc = async (grnLine) => {
    const draft = qcDraft[grnLine.id] ?? {};
    await run(
      () =>
        recordQc({
          grnLineId: grnLine.id,
          qtyPass: Number(draft.pass) || 0,
          qtyFail: Number(draft.fail) || 0,
          note: draft.note || ""
        }),
      "QC recorded."
    );
    setQcDraft((prev) => ({ ...prev, [grnLine.id]: {} }));
  };

  const needsReason = ["cancel", "short_close"];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {po.po_no ?? "Draft PO"}
              <Badge variant="outline" className={cn(PO_STATUS_BADGE[po.status])}>
                {PO_STATUS_LABEL[po.status] ?? po.status}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {po.vendor?.legal_name} · {po.entity?.code} · deliver to {po.location?.code} · ordered{" "}
              {formatDate(po.order_date)}
              {po.expected_date ? ` · expected ${formatDate(po.expected_date)}` : ""}
              {po.status_reason ? ` · reason: ${po.status_reason}` : ""}
            </DialogDescription>
          </DialogHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
                <TableHead className="text-right">Pending</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.po_line.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.cat_sku?.sku_code}</TableCell>
                  <TableCell className="text-right">{Number(l.qty_ordered)}</TableCell>
                  <TableCell className="text-right">{formatMoney(l.rate)}</TableCell>
                  <TableCell className="text-right">{Number(l.qty_received)}</TableCell>
                  <TableCell className="text-right">{Number(l.qty_rejected)}</TableCell>
                  <TableCell className="text-right">{Math.max(poLinePending(l), 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {grnLines.length > 0 && (
            <div className="space-y-1">
              <Label>Goods receipts</Label>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GRN</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>QC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grnLines.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="whitespace-nowrap">
                        {g.po_grn?.grn_no ?? g.po_grn?.status} · {formatDate(g.po_grn?.received_date)}
                      </TableCell>
                      <TableCell>{skuByPoLine[g.po_line_id]}</TableCell>
                      <TableCell className="text-right">{Number(g.qty)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {g.qc_required
                          ? `${Number(g.qty_qc_pass)} pass / ${Number(g.qty_qc_fail)} fail`
                          : "Exempt"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {qcQueue.length > 0 && (
            <div className="space-y-2">
              <Label>QC pending</Label>
              {qcQueue.map((g) => {
                const remaining = Number(g.qty) - Number(g.qty_qc_pass) - Number(g.qty_qc_fail);
                const draft = qcDraft[g.id] ?? {};
                return (
                  <div key={g.id} className="grid grid-cols-[1fr_70px_70px_1fr_auto] items-center gap-2 rounded-md border p-2">
                    <div className="text-sm">
                      <span className="font-medium">{skuByPoLine[g.po_line_id]}</span>{" "}
                      <span className="text-muted-foreground">{remaining} in QC hold</span>
                    </div>
                    <Input
                      type="number" min="0" placeholder="Pass"
                      value={draft.pass ?? ""}
                      onChange={(e) =>
                        setQcDraft((prev) => ({ ...prev, [g.id]: { ...draft, pass: e.target.value } }))
                      }
                    />
                    <Input
                      type="number" min="0" placeholder="Fail"
                      value={draft.fail ?? ""}
                      onChange={(e) =>
                        setQcDraft((prev) => ({ ...prev, [g.id]: { ...draft, fail: e.target.value } }))
                      }
                    />
                    <Input
                      placeholder="Note (required on fail)"
                      value={draft.note ?? ""}
                      onChange={(e) =>
                        setQcDraft((prev) => ({ ...prev, [g.id]: { ...draft, note: e.target.value } }))
                      }
                    />
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => submitQc(g)}>
                      Record
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {(po.status === "draft" || po.status === "approved" || po.status === "partially_received") && (
            <div className="grid gap-1.5">
              <Label>Reason (for cancel / short close)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {info && (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {po.status === "draft" && (
              <>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => run(() => cancelPo(po.id, reason), "PO cancelled.")}
                >
                  Cancel PO
                </Button>
                <Button disabled={busy} onClick={() => run(() => approvePo(po.id), "Approved as")}>
                  Approve
                </Button>
              </>
            )}
            {(po.status === "approved" || po.status === "partially_received") && (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(() => shortClosePo(po.id, reason), "PO short-closed.")}
                >
                  Short close
                </Button>
                <Button disabled={busy} onClick={() => setReceiveOpen(true)}>
                  Receive goods
                </Button>
              </>
            )}
            {po.status === "fulfilled" && (
              <Button variant="outline" disabled={busy} onClick={() => run(() => closePo(po.id), "PO closed.")}>
                Close PO
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiveGrnDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        po={po}
        onReceived={(grnNo) => {
          setInfo(`GRN ${grnNo} posted.`);
          loadGrns();
          onChanged();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Record bill dialog (three-way match happens at approval in the DB)
// ---------------------------------------------------------------------------

function RecordBillDialog({ open, onOpenChange, vendors, entities, onCreated }) {
  const [vendorId, setVendorId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(todayIso());
  const [creditDays, setCreditDays] = useState("");
  const [unbilled, setUnbilled] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [picked, setPicked] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setVendorId("");
      setEntityId(entities.length === 1 ? entities[0].id : "");
      setBillNo("");
      setBillDate(todayIso());
      setCreditDays("");
      setUnbilled([]);
      setPicked({});
      setError("");
    }
  }, [open, entities]);

  const pickVendor = async (id) => {
    setVendorId(id);
    setPicked({});
    setError("");
    setLoadingLines(true);
    try {
      setUnbilled(await fetchUnbilledGrnLines(id));
    } catch (e) {
      setError(e.message || "Could not load received goods for this vendor.");
    } finally {
      setLoadingLines(false);
    }
  };

  const togglePick = (line) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[line.id]) {
        delete next[line.id];
      } else {
        next[line.id] = {
          qty: String(line.qty),
          rate: String(line.po_line?.rate ?? ""),
          taxPct: String(line.po_line?.tax_pct ?? 0)
        };
      }
      return next;
    });
  };

  const submit = async () => {
    setError("");
    if (!vendorId || !entityId || !billNo.trim()) {
      setError("Vendor, entity and the vendor's invoice number are required.");
      return;
    }
    const lines = Object.entries(picked).map(([grnLineId, v]) => ({
      grnLineId,
      qty: Number(v.qty),
      rate: Number(v.rate),
      taxPct: Number(v.taxPct) || 0
    }));
    if (!lines.length) {
      setError("Pick at least one received line.");
      return;
    }
    if (lines.some((l) => !(l.qty > 0) || !(l.rate >= 0))) {
      setError("Every picked line needs qty > 0 and rate ≥ 0.");
      return;
    }
    setSaving(true);
    try {
      await createDraftBill({
        vendorId,
        entityId,
        billNo: billNo.trim(),
        billDate,
        creditDays: creditDays === "" ? null : Number(creditDays),
        lines
      });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError(e.message || "Could not save the bill.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record vendor bill</DialogTitle>
          <DialogDescription>
            Saved as draft. Approval runs the three-way match (PO rate vs bill rate, billed vs received)
            and computes the due date — MSME vendors are capped automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={pickVendor}>
              <SelectTrigger><SelectValue placeholder="Pick vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Billed entity</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Pick entity" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.code} — {e.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Vendor invoice no.</Label>
            <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Exactly as printed" />
          </div>
          <div className="grid gap-1.5">
            <Label>Invoice date</Label>
            <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Credit days (blank = vendor default)</Label>
            <Input type="number" min="0" value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Received, not yet billed</Label>
          {loadingLines ? (
            <Skeleton className="h-16 w-full" />
          ) : !vendorId ? (
            <p className="text-sm text-muted-foreground">Pick a vendor to see posted GRN lines.</p>
          ) : unbilled.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing unbilled for this vendor.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>GRN · SKU</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="w-24 text-right">Rate</TableHead>
                  <TableHead className="w-20 text-right">Tax %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbilled.map((l) => {
                  const sel = picked[l.id];
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={Boolean(sel)}
                          onChange={() => togglePick(l)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.po_grn?.grn_no} · <span className="font-medium">{l.po_line?.cat_sku?.sku_code}</span>
                        <span className="ml-1 text-muted-foreground">({Number(l.qty)} recd)</span>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min="0" className="text-right" disabled={!sel}
                          value={sel?.qty ?? ""}
                          onChange={(e) =>
                            setPicked((prev) => ({ ...prev, [l.id]: { ...sel, qty: e.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min="0" className="text-right" disabled={!sel}
                          value={sel?.rate ?? ""}
                          onChange={(e) =>
                            setPicked((prev) => ({ ...prev, [l.id]: { ...sel, rate: e.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min="0" className="text-right" disabled={!sel}
                          value={sel?.taxPct ?? ""}
                          onChange={(e) =>
                            setPicked((prev) => ({ ...prev, [l.id]: { ...sel, taxPct: e.target.value } }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save draft bill"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bill approval dialog (handles the variance-override path)
// ---------------------------------------------------------------------------

function ApproveBillDialog({ open, onOpenChange, bill, onDone }) {
  const [overrideReason, setOverrideReason] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setOverrideReason("");
      setNeedsOverride(false);
      setError("");
    }
  }, [open]);

  if (!bill) return null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await approveBill(bill.id, needsOverride ? overrideReason : null);
      onOpenChange(false);
      onDone();
    } catch (e) {
      const message = e.message || "Approval failed.";
      if (message.toLowerCase().includes("variance")) {
        setNeedsOverride(true);
        setError(message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve bill {bill.bill_no}</DialogTitle>
          <DialogDescription>
            Runs the three-way match. Quantity above what was received is always blocked; a rate
            variance beyond tolerance needs an override reason (recorded on the document).
          </DialogDescription>
        </DialogHeader>
        {needsOverride && (
          <div className="grid gap-1.5">
            <Label>Override reason</Label>
            <Textarea
              rows={2}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why is the rate difference accepted?"
            />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (needsOverride && !overrideReason.trim())}>
            {busy ? "Checking…" : needsOverride ? "Approve with override" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Record payment dialog
// ---------------------------------------------------------------------------

function RecordPaymentDialog({ open, onOpenChange, vendors, entities, outstanding, onDone }) {
  const [vendorId, setVendorId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [mode, setMode] = useState("bank");
  const [utr, setUtr] = useState("");
  const [note, setNote] = useState("");
  const [alloc, setAlloc] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setVendorId("");
      setEntityId(entities.length === 1 ? entities[0].id : "");
      setAmount("");
      setPaidOn(todayIso());
      setMode("bank");
      setUtr("");
      setNote("");
      setAlloc({});
      setError("");
    }
  }, [open, entities]);

  const vendorBills = useMemo(
    () => outstanding.filter((b) => b.vendor_id === vendorId && Number(b.outstanding) > 0),
    [outstanding, vendorId]
  );

  const submit = async () => {
    setError("");
    const amt = Number(amount);
    if (!vendorId || !entityId || !(amt > 0)) {
      setError("Vendor, entity and a positive amount are required.");
      return;
    }
    const allocations = Object.entries(alloc)
      .map(([billId, v]) => ({ billId, amount: Number(v) }))
      .filter((a) => a.amount > 0);
    setSaving(true);
    try {
      await recordPayment({ vendorId, entityId, amount: amt, paidOn, mode, utr, note, allocations });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(e.message || "Could not record the payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record vendor payment</DialogTitle>
          <DialogDescription>
            Append-only: corrections are counter entries, never edits. Allocate against approved bills
            below (optional — unallocated stays on account).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={(v) => { setVendorId(v); setAlloc({}); }}>
              <SelectTrigger><SelectValue placeholder="Pick vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Paying entity</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger><SelectValue placeholder="Pick entity" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.code} — {e.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Amount</Label>
            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Paid on</Label>
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>UTR / reference</Label>
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} />
          </div>
        </div>

        {vendorId && vendorBills.length > 0 && (
          <div className="space-y-1">
            <Label>Allocate to bills</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="w-28 text-right">Allocate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorBills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap">
                      {b.bill_no} <span className="text-muted-foreground">due {formatDate(b.due_date)}</span>
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(b.outstanding)}</TableCell>
                    <TableCell>
                      <Input
                        type="number" min="0" className="text-right"
                        value={alloc[b.id] ?? ""}
                        onChange={(e) => setAlloc((prev) => ({ ...prev, [b.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label>Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Record payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Settings tab (editable tolerances — decision 3)
// ---------------------------------------------------------------------------

function SettingsTab({ settings, onSaved }) {
  const [overReceipt, setOverReceipt] = useState("");
  const [rateVariance, setRateVariance] = useState("");
  const [msmeCap, setMsmeCap] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (settings) {
      setOverReceipt(String(settings.over_receipt_tolerance_pct));
      setRateVariance(String(settings.rate_variance_tolerance_pct));
      setMsmeCap(String(settings.msme_due_cap_days));
    }
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const { data } = await supabase.auth.getUser();
      await savePoSettings({
        overReceiptPct: Number(overReceipt),
        rateVariancePct: Number(rateVariance),
        msmeDueCapDays: Number(msmeCap),
        userId: data?.user?.id
      });
      setInfo("Saved. New tolerances apply to the next GRN / bill approval.");
      onSaved();
    } catch (e) {
      setError(e.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md space-y-4">
      <div className="grid gap-1.5">
        <Label>Over-receipt tolerance (% of ordered qty)</Label>
        <Input type="number" min="0" step="0.5" value={overReceipt} onChange={(e) => setOverReceipt(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          A GRN may exceed the pending quantity by this much. Per-vendor-item override lives on the
          vendor-item record (Platform Masters).
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label>Rate variance tolerance (%)</Label>
        <Input type="number" min="0" step="0.5" value={rateVariance} onChange={(e) => setRateVariance(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          Bill rates further than this from the PO rate block approval unless overridden with a reason.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label>MSME due-date cap (days)</Label>
        <Input type="number" min="1" value={msmeCap} onChange={(e) => setMsmeCap(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          Bills of micro / small vendors fall due within this many days regardless of credit terms.
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}
      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save tolerances"}</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function ProcurementPanel() {
  const [tab, setTab] = useState("pos");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [pos, setPos] = useState([]);
  const [bills, setBills] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settings, setSettings] = useState(null);

  const [parties, setParties] = useState([]);
  const [entities, setEntities] = useState([]);
  const [locations, setLocations] = useState([]);
  const [skus, setSkus] = useState([]);

  const [poSearch, setPoSearch] = useState("");
  const [poStatusFilter, setPoStatusFilter] = useState("all");

  const [createPoOpen, setCreatePoOpen] = useState(false);
  const [detailPo, setDetailPo] = useState(null);
  const [recordBillOpen, setRecordBillOpen] = useState(false);
  const [approveBillTarget, setApproveBillTarget] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [billActionError, setBillActionError] = useState("");

  const vendors = useMemo(() => parties.filter((p) => p.kind === "vendor" && p.is_active), [parties]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [posData, billsData, outData, ledgerData, payData, settingsData, partiesData, entitiesData, locationsData, skusData] =
        await Promise.all([
          fetchPurchaseOrders(),
          fetchBills(),
          fetchOutstandingBills(),
          fetchVendorLedger(),
          fetchPayments(),
          fetchPoSettings(),
          fetchParties(),
          fetchEntities(),
          fetchLocations(),
          fetchSkus()
        ]);
      setPos(posData);
      setBills(billsData);
      setOutstanding(outData);
      setLedger(ledgerData);
      setPayments(payData);
      setSettings(settingsData);
      setParties(partiesData);
      setEntities(entitiesData);
      setLocations(locationsData);
      setSkus(skusData);
    } catch (e) {
      setLoadError(
        /relation|does not exist|schema cache/i.test(e.message || "")
          ? "Procurement tables are not on this database yet — apply migration 20260902120000_step2_procurement.sql."
          : e.message || "Could not load procurement data."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the detail dialog's PO in sync after refetches.
  useEffect(() => {
    if (detailPo) {
      const fresh = pos.find((p) => p.id === detailPo.id);
      if (fresh && fresh !== detailPo) setDetailPo(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  const filteredPos = useMemo(() => {
    const q = poSearch.trim().toLowerCase();
    return pos.filter((po) => {
      if (poStatusFilter !== "all" && po.status !== poStatusFilter) return false;
      if (!q) return true;
      return (
        (po.po_no ?? "").toLowerCase().includes(q) ||
        (po.vendor?.legal_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [pos, poSearch, poStatusFilter]);

  const outstandingByBill = useMemo(() => {
    const map = new Map();
    for (const b of outstanding) map.set(b.id, b);
    return map;
  }, [outstanding]);

  const deleteDraftBill = async (bill) => {
    setBillActionError("");
    try {
      const { error } = await supabase.from("ap_bill").delete().eq("id", bill.id);
      if (error) throw error;
      load();
    } catch (e) {
      setBillActionError(e.message || "Could not delete the draft bill.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Procurement unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-3" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShoppingCart className="h-5 w-5" /> Procurement
          </h2>
          <p className="text-sm text-muted-foreground">
            PO → GRN → QC → bill (three-way match) → payment. Stock and money move only through
            locked database functions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pos">Purchase orders</TabsTrigger>
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="ledger">Payments & ledger</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "pos" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search PO no. / vendor…"
              className="max-w-xs"
              value={poSearch}
              onChange={(e) => setPoSearch(e.target.value)}
            />
            <Select value={poStatusFilter} onValueChange={setPoStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.keys(PO_STATUS_LABEL).map((s) => (
                  <SelectItem key={s} value={s}>{PO_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <Button size="sm" onClick={() => setCreatePoOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> New PO
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No purchase orders yet.
                  </TableCell>
                </TableRow>
              ) : (
                filteredPos.map((po) => {
                  const ordered = po.po_line.reduce((s, l) => s + Number(l.qty_ordered), 0);
                  const received = po.po_line.reduce((s, l) => s + Number(l.qty_received), 0);
                  const value = po.po_line.reduce((s, l) => s + Number(l.qty_ordered) * Number(l.rate), 0);
                  return (
                    <TableRow
                      key={po.id}
                      className="cursor-pointer"
                      onClick={() => setDetailPo(po)}
                    >
                      <TableCell className="font-medium">{po.po_no ?? "Draft"}</TableCell>
                      <TableCell>{po.vendor?.legal_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(po.order_date)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(PO_STATUS_BADGE[po.status])}>
                          {PO_STATUS_LABEL[po.status] ?? po.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{ordered}</TableCell>
                      <TableCell className="text-right">{received}</TableCell>
                      <TableCell className="text-right">₹{formatMoney(value)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "bills" && (
        <div className="space-y-3">
          <div className="flex items-center justify-end">
            <Button size="sm" onClick={() => setRecordBillOpen(true)}>
              <FileText className="mr-1 h-4 w-4" /> Record bill
            </Button>
          </div>
          {billActionError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{billActionError}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Match</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No bills yet.
                  </TableCell>
                </TableRow>
              ) : (
                bills.map((b) => {
                  const out = outstandingByBill.get(b.id);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.bill_no}</TableCell>
                      <TableCell>{b.vendor?.legal_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(b.bill_date)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(b.due_date)}
                        {b.msme_capped && (
                          <Badge variant="outline" className="ml-1 bg-purple-50 text-purple-700 border-purple-200">
                            MSME
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(BILL_STATUS_BADGE[b.status])}>
                          {BILL_STATUS_LABEL[b.status] ?? b.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {b.match_status ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              b.match_status === "matched"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            )}
                          >
                            {b.match_status}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.status === "approved" ? `₹${formatMoney(b.total)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {out ? `₹${formatMoney(out.outstanding)}` : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {b.status === "draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setApproveBillTarget(b)}>
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-1 text-red-600"
                              onClick={() => deleteDraftBill(b)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "ledger" && (
        <div className="space-y-6">
          <div className="flex items-center justify-end">
            <Button size="sm" onClick={() => setPaymentOpen(true)}>
              <Wallet className="mr-1 h-4 w-4" /> Record payment
            </Button>
          </div>

          <div className="space-y-1">
            <Label>Vendor ledger (approved bills − open debit notes − payments)</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>MSME</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead className="text-right">Debit notes</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.filter((v) => Number(v.billed) || Number(v.paid) || Number(v.debit_notes)).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No vendor activity yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  ledger
                    .filter((v) => Number(v.billed) || Number(v.paid) || Number(v.debit_notes))
                    .map((v) => (
                      <TableRow key={v.vendor_id}>
                        <TableCell className="font-medium">{v.vendor_name}</TableCell>
                        <TableCell>{v.msme_category ?? "—"}</TableCell>
                        <TableCell className="text-right">₹{formatMoney(v.billed)}</TableCell>
                        <TableCell className="text-right">₹{formatMoney(v.debit_notes)}</TableCell>
                        <TableCell className="text-right">₹{formatMoney(v.paid)}</TableCell>
                        <TableCell className="text-right font-medium">₹{formatMoney(v.balance)}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-1">
            <Label>Outstanding bills (ageing)</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Overdue days</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outstanding.filter((b) => Number(b.outstanding) > 0).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Nothing outstanding.
                    </TableCell>
                  </TableRow>
                ) : (
                  outstanding
                    .filter((b) => Number(b.outstanding) > 0)
                    .map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.bill_no}</TableCell>
                        <TableCell>{b.vendor_name}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(b.due_date)}
                          {b.msme_capped && (
                            <Badge variant="outline" className="ml-1 bg-purple-50 text-purple-700 border-purple-200">
                              MSME
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={cn("text-right", b.days_overdue > 0 && "font-medium text-red-600")}>
                          {b.days_overdue > 0 ? b.days_overdue : "—"}
                        </TableCell>
                        <TableCell className="text-right">₹{formatMoney(b.outstanding)}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-1">
            <Label>Payments</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>UTR</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No payments recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(p.paid_on)}</TableCell>
                      <TableCell>{p.vendor?.legal_name}</TableCell>
                      <TableCell>{p.mode}</TableCell>
                      <TableCell className="text-muted-foreground">{p.utr ?? "—"}</TableCell>
                      <TableCell className="text-right">₹{formatMoney(p.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {tab === "settings" && <SettingsTab settings={settings} onSaved={load} />}

      <CreatePoDialog
        open={createPoOpen}
        onOpenChange={setCreatePoOpen}
        vendors={vendors}
        entities={entities}
        locations={locations}
        skus={skus}
        onCreated={load}
      />
      <PoDetailDialog
        open={Boolean(detailPo)}
        onOpenChange={(v) => !v && setDetailPo(null)}
        po={detailPo}
        onChanged={load}
      />
      <RecordBillDialog
        open={recordBillOpen}
        onOpenChange={setRecordBillOpen}
        vendors={vendors}
        entities={entities}
        onCreated={load}
      />
      <ApproveBillDialog
        open={Boolean(approveBillTarget)}
        onOpenChange={(v) => !v && setApproveBillTarget(null)}
        bill={approveBillTarget}
        onDone={() => {
          setApproveBillTarget(null);
          load();
        }}
      />
      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        vendors={vendors}
        entities={entities}
        outstanding={outstanding}
        onDone={load}
      />
    </div>
  );
}
