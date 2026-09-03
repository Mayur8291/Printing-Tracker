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
import { AlertTriangle, FileText, IndianRupee, PhoneCall, Plus, Receipt, RefreshCw } from "lucide-react";
import { fetchEntities } from "./mastersUtils";
import { formatMoney } from "./procurementUtils";
import {
  AR_MODES,
  closeFollowup,
  createFollowup,
  fetchArCustomerLedger,
  fetchCreditNotes,
  fetchFollowups,
  fetchInvoices,
  fetchOutstandingInvoices,
  fetchReceipts,
  fetchUninvoicedDispatches,
  generateInvoice,
  issueCreditNote,
  recordReceipt
} from "./billingArUtils";

const BUCKET_BADGE = {
  NOT_DUE: "bg-slate-50 text-slate-700 border-slate-200",
  "0-30": "bg-amber-50 text-amber-700 border-amber-200",
  "31-60": "bg-orange-50 text-orange-700 border-orange-200",
  "61-90": "bg-red-50 text-red-700 border-red-200",
  "90+": "bg-red-100 text-red-800 border-red-300",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200"
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
// Generate invoice dialog
// ---------------------------------------------------------------------------

function GenerateInvoiceDialog({ open, onOpenChange, dispatches, entities, onGenerated }) {
  const [dispatchId, setDispatchId] = useState("");
  const [gstinId, setGstinId] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const dispatch = dispatches.find((d) => d.id === dispatchId);
  const entity = dispatch ? entities.find((e) => e.id === dispatch.so_order?.entity_id) : null;
  const gstins = (entity?.core_gstin ?? []).filter((g) => g.is_active);

  useEffect(() => {
    if (!open) return;
    setDispatchId("");
    setGstinId("");
    setPlaceOfSupply("");
    setInvoiceDate(todayIso());
    setNote("");
    setError("");
  }, [open]);

  useEffect(() => {
    setGstinId(gstins.length === 1 ? gstins[0].id : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatchId]);

  const submit = async () => {
    setError("");
    if (!dispatchId || !gstinId) {
      setError("Pick a dispatch and the GSTIN to invoice from.");
      return;
    }
    if (placeOfSupply && placeOfSupply.trim().length !== 2) {
      setError("Place of supply must be a 2-digit state code (leave blank for the GSTIN's state).");
      return;
    }
    setSaving(true);
    try {
      const no = await generateInvoice({
        dispatchId,
        gstinId,
        placeOfSupply: placeOfSupply.trim() || null,
        invoiceDate,
        note
      });
      onOpenChange(false);
      onGenerated(no);
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate invoice from dispatch</DialogTitle>
          <DialogDescription>
            Invoices are generated, never typed — lines, rates and GST come from the order and dispatch.
            The number is gapless per GSTIN per FY and the document is immutable once created.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Dispatch (uninvoiced)</Label>
            <Select value={dispatchId} onValueChange={setDispatchId}>
              <SelectTrigger><SelectValue placeholder="Pick dispatch" /></SelectTrigger>
              <SelectContent>
                {dispatches.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.dispatch_no} · {d.so_order?.so_no} · {d.so_order?.customer?.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>GSTIN</Label>
              <Select value={gstinId} onValueChange={setGstinId} disabled={!dispatch}>
                <SelectTrigger><SelectValue placeholder="Pick GSTIN" /></SelectTrigger>
                <SelectContent>
                  {gstins.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.gstin}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Invoice date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Place of supply (state code)</Label>
              <Input
                placeholder="Blank = GSTIN state"
                maxLength={2}
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not generate</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Generating…" : "Generate invoice"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail (read-only) + credit note issue
// ---------------------------------------------------------------------------

function InvoiceDetailDialog({ invoice, onOpenChange, onChanged }) {
  const [cnAmount, setCnAmount] = useState("");
  const [cnReason, setCnReason] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCnAmount("");
    setCnReason("");
    setError("");
    setInfo("");
  }, [invoice?.id]);

  if (!invoice) return null;

  const issueCn = async () => {
    setError("");
    setInfo("");
    const amount = Number(cnAmount);
    if (!(amount > 0) || !cnReason.trim()) {
      setError("Credit note needs an amount > 0 and a reason.");
      return;
    }
    setBusy(true);
    try {
      const no = await issueCreditNote({
        invoiceId: invoice.id,
        amount,
        reason: cnReason.trim(),
        noteDate: todayIso()
      });
      setInfo(`Credit note issued: ${no}`);
      setCnAmount("");
      setCnReason("");
      onChanged();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(v) => !v && onOpenChange(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {invoice.invoice_no}
            <Badge variant="outline" className="font-normal">
              {invoice.intra_state ? "CGST + SGST" : "IGST"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {invoice.customer?.legal_name} · {invoice.gstin?.gstin} · dispatch {invoice.so_dispatch?.dispatch_no} · due{" "}
            {formatDate(invoice.due_date)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-56 overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">GST %</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoice.bill_invoice_line ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.cat_sku?.sku_code}</TableCell>
                  <TableCell className="text-xs">{l.hsn ?? "—"}</TableCell>
                  <TableCell className="text-right">{Number(l.qty)}</TableCell>
                  <TableCell className="text-right">{formatMoney(l.rate)}</TableCell>
                  <TableCell className="text-right">{formatMoney(l.taxable_value)}</TableCell>
                  <TableCell className="text-right">{Number(l.gst_rate)}</TableCell>
                  <TableCell className="text-right">{formatMoney(l.line_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-sm text-muted-foreground">
          Subtotal ₹{formatMoney(invoice.subtotal)}
          {invoice.intra_state
            ? ` · CGST ₹${formatMoney(invoice.cgst_amount)} · SGST ₹${formatMoney(invoice.sgst_amount)}`
            : ` · IGST ₹${formatMoney(invoice.igst_amount)}`}{" "}
          · <span className="font-medium text-foreground">Total ₹{formatMoney(invoice.total)}</span>
        </p>

        {info ? (
          <Alert>
            <AlertTitle>Done</AlertTitle>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-end gap-2 border-t pt-3">
          <div className="grid w-32 gap-1.5">
            <Label>Credit ₹</Label>
            <Input type="number" min="0" value={cnAmount} onChange={(e) => setCnAmount(e.target.value)} />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label>Reason</Label>
            <Input
              placeholder="Return / rate difference…"
              value={cnReason}
              onChange={(e) => setCnReason(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={busy} onClick={issueCn}>
            Issue credit note
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Record receipt dialog with allocations
// ---------------------------------------------------------------------------

function RecordReceiptDialog({ open, onOpenChange, outstanding, entities, onRecorded }) {
  const [customerId, setCustomerId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [mode, setMode] = useState("bank");
  const [utr, setUtr] = useState("");
  const [note, setNote] = useState("");
  const [allocs, setAllocs] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const customers = useMemo(() => {
    const map = new Map();
    for (const r of outstanding) {
      if (Number(r.outstanding) > 0) map.set(r.customer_id, r.customer_name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [outstanding]);

  const openInvoices = useMemo(
    () => outstanding.filter((r) => r.customer_id === customerId && Number(r.outstanding) > 0),
    [outstanding, customerId]
  );

  useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setEntityId(entities.length === 1 ? entities[0].id : "");
    setAmount("");
    setReceivedOn(todayIso());
    setMode("bank");
    setUtr("");
    setNote("");
    setAllocs({});
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setAllocs({});
  }, [customerId]);

  const allocTotal = Object.values(allocs).reduce((sum, v) => sum + (Number(v) || 0), 0);

  const submit = async () => {
    setError("");
    const amt = Number(amount);
    if (!customerId || !entityId || !(amt > 0)) {
      setError("Customer, entity and an amount > 0 are required.");
      return;
    }
    const allocations = [];
    for (const inv of openInvoices) {
      const a = Number(allocs[inv.id]);
      if (!a) continue;
      if (a < 0 || a > Number(inv.outstanding)) {
        setError(`${inv.invoice_no}: allocation cannot exceed outstanding ₹${formatMoney(inv.outstanding)}.`);
        return;
      }
      allocations.push({ invoiceId: inv.id, amount: a });
    }
    if (allocTotal > amt) {
      setError("Allocations exceed the receipt amount.");
      return;
    }
    setSaving(true);
    try {
      const no = await recordReceipt({
        customerId,
        entityId,
        amount: amt,
        receivedOn,
        mode,
        utr,
        note,
        allocations
      });
      onOpenChange(false);
      onRecorded(no);
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record receipt</DialogTitle>
          <DialogDescription>
            Allocate across open invoices — the database blocks over-allocation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Pick customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Entity</Label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger><SelectValue placeholder="Pick entity" /></SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Amount ₹</Label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Received on</Label>
              <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AR_MODES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>UTR / ref</Label>
              <Input value={utr} onChange={(e) => setUtr(e.target.value)} />
            </div>
          </div>

          {customerId ? (
            <div className="grid gap-1.5">
              <Label>
                Allocations (₹{formatMoney(allocTotal)} of ₹{formatMoney(Number(amount) || 0)})
              </Label>
              <div className="max-h-44 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="w-32 text-right">Allocate ₹</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openInvoices.length ? (
                      openInvoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                          <TableCell>{formatDate(inv.due_date)}</TableCell>
                          <TableCell className="text-right">{formatMoney(inv.outstanding)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              className="h-8 text-right"
                              value={allocs[inv.id] ?? ""}
                              onChange={(e) => setAllocs((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          No open invoices — the receipt stays unallocated (advance).
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not record</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Recording…" : "Record receipt"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Follow-up dialog
// ---------------------------------------------------------------------------

function AddFollowupDialog({ open, onOpenChange, ledger, outstanding, onCreated }) {
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [nextDate, setNextDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const customerInvoices = useMemo(
    () => outstanding.filter((r) => r.customer_id === customerId && Number(r.outstanding) > 0),
    [outstanding, customerId]
  );

  useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setInvoiceId("");
    setNextDate(todayIso());
    setNote("");
    setError("");
  }, [open]);

  const submit = async () => {
    setError("");
    if (!customerId || !nextDate) {
      setError("Customer and next date are required.");
      return;
    }
    setSaving(true);
    try {
      await createFollowup({ customerId, invoiceId: invoiceId || null, nextDate, note });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New follow-up</DialogTitle>
          <DialogDescription>Next action for collections, optionally tied to one invoice.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setInvoiceId(""); }}>
              <SelectTrigger><SelectValue placeholder="Pick customer" /></SelectTrigger>
              <SelectContent>
                {ledger.map((c) => (
                  <SelectItem key={c.customer_id} value={c.customer_id}>
                    {c.customer_name} (₹{formatMoney(c.balance)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Invoice (optional)</Label>
            <Select
              value={invoiceId || "__account__"}
              onValueChange={(v) => setInvoiceId(v === "__account__" ? "" : v)}
              disabled={!customerId}
            >
              <SelectTrigger><SelectValue placeholder="Whole account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__account__">Whole account</SelectItem>
                {customerInvoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.invoice_no} · ₹{formatMoney(inv.outstanding)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Next date</Label>
            <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function BillingArPanel() {
  const [tab, setTab] = useState("invoices");
  const [invoices, setInvoices] = useState([]);
  const [uninvoiced, setUninvoiced] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [inv, und, cns, rcs, out, led, fus, ents] = await Promise.all([
        fetchInvoices(),
        fetchUninvoicedDispatches(),
        fetchCreditNotes(),
        fetchReceipts(),
        fetchOutstandingInvoices(),
        fetchArCustomerLedger(),
        fetchFollowups(),
        fetchEntities()
      ]);
      setInvoices(inv);
      setUninvoiced(und);
      setCreditNotes(cns);
      setReceipts(rcs);
      setOutstanding(out);
      setLedger(led);
      setFollowups(fus);
      setEntities(ents.filter((e) => e.is_active));
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detailInvoice) return;
    const fresh = invoices.find((i) => i.id === detailInvoice.id);
    if (fresh && fresh !== detailInvoice) setDetailInvoice(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  const ageingTotals = useMemo(() => {
    const totals = {};
    for (const r of outstanding) {
      if (r.bucket === "PAID") continue;
      totals[r.bucket] = (totals[r.bucket] ?? 0) + Number(r.outstanding);
    }
    return totals;
  }, [outstanding]);

  const doneFollowup = async (id) => {
    setBusy(true);
    setError("");
    try {
      await closeFollowup(id, "done");
      await load();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <IndianRupee className="h-5 w-5" /> Billing & Receivables
          </h2>
          <p className="text-sm text-muted-foreground">
            Step 4 — invoices generated from dispatch, corrections are credit notes, receipts allocate, ageing is a view.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
          {tab === "invoices" ? (
            <Button size="sm" onClick={() => setShowGenerate(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Generate invoice
            </Button>
          ) : null}
          {tab === "receipts" ? (
            <Button size="sm" onClick={() => setShowReceipt(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Record receipt
            </Button>
          ) : null}
          {tab === "followups" ? (
            <Button size="sm" onClick={() => setShowFollowup(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Follow-up
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {msg ? (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="invoices"><FileText className="mr-1 h-3.5 w-3.5" /> Invoices</TabsTrigger>
          <TabsTrigger value="receipts"><Receipt className="mr-1 h-3.5 w-3.5" /> Receipts & credits</TabsTrigger>
          <TabsTrigger value="ageing"><IndianRupee className="mr-1 h-3.5 w-3.5" /> Ageing</TabsTrigger>
          <TabsTrigger value="followups"><PhoneCall className="mr-1 h-3.5 w-3.5" /> Follow-ups</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {!loading && tab === "invoices" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Order / dispatch</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead className="text-right">Total ₹</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length ? (
                invoices.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => setDetailInvoice(i)}>
                    <TableCell className="font-mono text-xs">{i.invoice_no}</TableCell>
                    <TableCell>{i.customer?.legal_name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {i.so_order?.so_no} / {i.so_dispatch?.dispatch_no}
                    </TableCell>
                    <TableCell>{formatDate(i.invoice_date)}</TableCell>
                    <TableCell>{formatDate(i.due_date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {i.intra_state ? "CGST+SGST" : "IGST"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(i.total)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No invoices yet — generate one from a dispatch.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {!loading && tab === "receipts" ? (
        <div className="grid gap-4">
          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>UTR</TableHead>
                  <TableHead className="text-right">Amount ₹</TableHead>
                  <TableHead className="text-right">Allocated ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.length ? (
                  receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.receipt_no}</TableCell>
                      <TableCell>{r.customer?.legal_name}</TableCell>
                      <TableCell>{formatDate(r.received_on)}</TableCell>
                      <TableCell>{r.mode}</TableCell>
                      <TableCell className="text-xs">{r.utr ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney((r.ar_allocation ?? []).reduce((s, a) => s + Number(a.amount), 0))}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      No receipts yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Credit notes</p>
            <div className="overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CN no</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount ₹</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNotes.length ? (
                    creditNotes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.cn_no}</TableCell>
                        <TableCell className="font-mono text-xs">{c.bill_invoice?.invoice_no}</TableCell>
                        <TableCell>{c.customer?.legal_name}</TableCell>
                        <TableCell>{formatDate(c.note_date)}</TableCell>
                        <TableCell className="text-xs">{c.reason}</TableCell>
                        <TableCell className="text-right">{formatMoney(c.amount)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                        No credit notes.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && tab === "ageing" ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {["NOT_DUE", "0-30", "31-60", "61-90", "90+"].map((b) => (
              <div key={b} className={cn("rounded border px-3 py-2 text-sm", BUCKET_BADGE[b])}>
                <span className="font-medium">{b === "NOT_DUE" ? "Not due" : b}</span> · ₹
                {formatMoney(ageingTotals[b] ?? 0)}
              </div>
            ))}
          </div>

          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Total ₹</TableHead>
                  <TableHead className="text-right">Outstanding ₹</TableHead>
                  <TableHead className="text-right">Days past due</TableHead>
                  <TableHead>Bucket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outstanding.filter((r) => r.bucket !== "PAID").length ? (
                  outstanding
                    .filter((r) => r.bucket !== "PAID")
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.invoice_no}</TableCell>
                        <TableCell>{r.customer_name}</TableCell>
                        <TableCell>{formatDate(r.due_date)}</TableCell>
                        <TableCell className="text-right">{formatMoney(r.total)}</TableCell>
                        <TableCell className="text-right">{formatMoney(r.outstanding)}</TableCell>
                        <TableCell className="text-right">{r.days_past_due}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("font-normal", BUCKET_BADGE[r.bucket])}>
                            {r.bucket === "NOT_DUE" ? "Not due" : r.bucket}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Nothing outstanding.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Customer balances</p>
            <div className="overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Invoiced ₹</TableHead>
                    <TableHead className="text-right">Credited ₹</TableHead>
                    <TableHead className="text-right">Received ₹</TableHead>
                    <TableHead className="text-right">Balance ₹</TableHead>
                    <TableHead className="text-right">Oldest overdue (days)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.length ? (
                    ledger.map((c) => (
                      <TableRow key={c.customer_id}>
                        <TableCell>{c.customer_name}</TableCell>
                        <TableCell className="text-right">{formatMoney(c.invoiced)}</TableCell>
                        <TableCell className="text-right">{formatMoney(c.credited)}</TableCell>
                        <TableCell className="text-right">{formatMoney(c.received)}</TableCell>
                        <TableCell className="text-right font-medium">{formatMoney(c.balance)}</TableCell>
                        <TableCell className="text-right">{c.oldest_overdue_days}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                        No customer activity yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && tab === "followups" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Next date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {followups.length ? (
                followups.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{formatDate(f.next_date)}</TableCell>
                    <TableCell>{f.customer?.legal_name}</TableCell>
                    <TableCell className="font-mono text-xs">{f.bill_invoice?.invoice_no ?? "account"}</TableCell>
                    <TableCell className="text-xs">{f.note ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {f.status}{f.outcome ? ` · ${f.outcome}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {f.status === "open" ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => doneFollowup(f.id)}>
                          Mark done
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No follow-ups.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <GenerateInvoiceDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        dispatches={uninvoiced}
        entities={entities}
        onGenerated={(no) => {
          setMsg(`Invoice generated: ${no}`);
          load();
        }}
      />
      <RecordReceiptDialog
        open={showReceipt}
        onOpenChange={setShowReceipt}
        outstanding={outstanding}
        entities={entities}
        onRecorded={(no) => {
          setMsg(`Receipt recorded: ${no}`);
          load();
        }}
      />
      <AddFollowupDialog
        open={showFollowup}
        onOpenChange={setShowFollowup}
        ledger={ledger}
        outstanding={outstanding}
        onCreated={load}
      />
      <InvoiceDetailDialog invoice={detailInvoice} onOpenChange={setDetailInvoice} onChanged={load} />
    </div>
  );
}
