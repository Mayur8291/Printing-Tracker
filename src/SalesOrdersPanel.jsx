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
import { AlertTriangle, ClipboardList, Plus, RefreshCw, Timer, Truck, Wrench } from "lucide-react";
import { fetchEntities, fetchLocations, fetchParties, fetchSkus } from "./mastersUtils";
import { formatMoney } from "./procurementUtils";
import {
  JW_KINDS,
  JW_STATUS_LABEL,
  SLA_STAGES,
  SO_CHANNELS,
  SO_STATUS_LABEL,
  allocateSo,
  cancelJob,
  cancelSo,
  closeJob,
  confirmSo,
  createDraftJob,
  createDraftSo,
  fetchDispatches,
  fetchJobs,
  fetchSalesOrders,
  fetchSlaPolicies,
  fetchSlaRows,
  issueJob,
  orderTotals,
  postDispatch,
  receiveJob,
  saveSlaPolicy,
  setSoStatus
} from "./salesOrdersUtils";

const SO_STATUS_BADGE = {
  draft: "bg-slate-50 text-slate-700 border-slate-200",
  confirmed: "bg-blue-50 text-blue-700 border-blue-200",
  in_production: "bg-violet-50 text-violet-700 border-violet-200",
  ready: "bg-cyan-50 text-cyan-700 border-cyan-200",
  partially_dispatched: "bg-amber-50 text-amber-700 border-amber-200",
  dispatched: "bg-emerald-50 text-emerald-700 border-emerald-200",
  invoiced: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
  cancelled: "bg-red-50 text-red-700 border-red-200"
};

const JW_STATUS_BADGE = {
  draft: "bg-slate-50 text-slate-700 border-slate-200",
  issued: "bg-blue-50 text-blue-700 border-blue-200",
  received: "bg-amber-50 text-amber-700 border-amber-200",
  closed: "bg-emerald-50 text-emerald-700 border-emerald-200",
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

function channelLabel(value) {
  return SO_CHANNELS.find((c) => c.value === value)?.label ?? value;
}

function stageLabel(value) {
  return SLA_STAGES.find((s) => s.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Create order dialog (counter sales use the same dialog with channel=counter)
// ---------------------------------------------------------------------------

function CreateSoDialog({ open, onOpenChange, customers, entities, locations, skus, onCreated }) {
  const [customerId, setCustomerId] = useState("");
  const [channel, setChannel] = useState("b2b");
  const [entityId, setEntityId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [promisedDate, setPromisedDate] = useState("");
  const [branding, setBranding] = useState(false);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ skuCode: "", qty: "", rate: "" }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const skuByCode = useMemo(() => {
    const map = new Map();
    for (const s of skus) map.set(s.sku_code.toLowerCase(), s);
    return map;
  }, [skus]);

  useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setChannel("b2b");
    setEntityId(entities.length === 1 ? entities[0].id : "");
    setLocationId("");
    setOrderDate(todayIso());
    setPromisedDate("");
    setBranding(false);
    setNote("");
    setLines([{ skuCode: "", qty: "", rate: "" }]);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    setError("");
    if (!customerId || !entityId || !locationId) {
      setError("Customer, entity and fulfilment location are required.");
      return;
    }
    const parsed = [];
    for (const [i, l] of lines.entries()) {
      if (!l.skuCode.trim() && !l.qty && !l.rate) continue;
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
      parsed.push({ skuId: sku.id, qty, rate, taxPct: 0 });
    }
    if (!parsed.length) {
      setError("Add at least one line.");
      return;
    }
    setSaving(true);
    try {
      await createDraftSo({
        entityId,
        customerId,
        channel,
        locationId,
        orderDate,
        promisedDate: promisedDate || null,
        branding,
        note,
        lines: parsed
      });
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New sales order</DialogTitle>
          <DialogDescription>
            Draft first — confirming assigns the SO number and reserves available stock.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Pick customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SO_CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
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
                    <SelectItem key={e.id} value={e.id}>{e.code} — {e.legal_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Fulfilment location</Label>
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
              <Label>Order date</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Promised dispatch</Label>
              <Input type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Lines (one row per SKU / size)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((prev) => [...prev, { skuCode: "", qty: "", rate: "" }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Row
              </Button>
            </div>
            <div className="grid gap-2">
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-[2fr_1fr_1fr] gap-2">
                  <Input
                    placeholder="SKU code"
                    value={l.skuCode}
                    onChange={(e) => updateLine(idx, { skuCode: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="0"
                    placeholder="Qty"
                    value={l.qty}
                    onChange={(e) => updateLine(idx, { qty: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="0"
                    placeholder="Rate ₹"
                    value={l.rate}
                    onChange={(e) => updateLine(idx, { rate: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not create order</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Order detail dialog — lifecycle actions live here
// ---------------------------------------------------------------------------

function SoDetailDialog({ order, onOpenChange, onChanged }) {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showDispatch, setShowDispatch] = useState(false);

  useEffect(() => {
    setError("");
    setInfo("");
    setCancelReason("");
    setShowDispatch(false);
  }, [order?.id]);

  if (!order) return null;
  const totals = orderTotals(order);

  const act = async (fn, successMsg) => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const result = await fn();
      setInfo(typeof result === "string" && successMsg ? `${successMsg} ${result}` : successMsg ?? "");
      onChanged();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(order)} onOpenChange={(v) => !v && onOpenChange(null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order.so_no ?? "Draft order"}
            <Badge variant="outline" className={cn("font-normal", SO_STATUS_BADGE[order.status])}>
              {SO_STATUS_LABEL[order.status]}
            </Badge>
            <Badge variant="outline" className="font-normal">{channelLabel(order.channel)}</Badge>
          </DialogTitle>
          <DialogDescription>
            {order.customer?.legal_name} · {order.location?.code} · ordered {formatDate(order.order_date)}
            {order.promised_date ? ` · promised ${formatDate(order.promised_date)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Dispatched</TableHead>
                <TableHead className="text-right">Rate ₹</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.so_line ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.cat_sku?.sku_code}</TableCell>
                  <TableCell className="text-right">{Number(l.qty)}</TableCell>
                  <TableCell className="text-right">{Number(l.qty_reserved)}</TableCell>
                  <TableCell className="text-right">{Number(l.qty_dispatched)}</TableCell>
                  <TableCell className="text-right">{formatMoney(l.rate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-sm text-muted-foreground">
          {totals.qty} pcs ordered · {totals.reserved} reserved · {totals.dispatched} dispatched · value ₹
          {formatMoney(totals.value)}
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
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {order.status === "draft" ? (
            <Button size="sm" disabled={busy} onClick={() => act(() => confirmSo(order.id), "Confirmed as")}>
              Confirm & reserve
            </Button>
          ) : null}
          {["confirmed", "in_production"].includes(order.status) ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const got = await allocateSo(order.id);
                    return `${got} pcs newly reserved.`;
                  }, "Allocation ran —")
                }
              >
                Allocate stock
              </Button>
              {order.status === "confirmed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(() => setSoStatus(order.id, "in_production"), "Production started.")}
                >
                  Start production
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act(() => setSoStatus(order.id, "ready"), "Order is ready.")}
              >
                Mark ready
              </Button>
            </>
          ) : null}
          {["ready", "partially_dispatched"].includes(order.status) ? (
            <Button size="sm" disabled={busy} onClick={() => setShowDispatch(true)}>
              <Truck className="mr-1 h-3.5 w-3.5" /> Dispatch
            </Button>
          ) : null}
          {order.status === "dispatched" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act(() => setSoStatus(order.id, "closed"), "Order closed.")}
            >
              Close order
            </Button>
          ) : null}
        </div>

        {["draft", "confirmed", "in_production", "ready"].includes(order.status) ? (
          <div className="flex items-end gap-2 border-t pt-3">
            <div className="grid flex-1 gap-1.5">
              <Label>Cancel with reason</Label>
              <Input
                value={cancelReason}
                placeholder="Why is this order cancelled?"
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !cancelReason.trim()}
              onClick={() => act(() => cancelSo(order.id, cancelReason.trim()), "Order cancelled.")}
            >
              Cancel order
            </Button>
          </div>
        ) : null}

        <DispatchDialog
          order={showDispatch ? order : null}
          onOpenChange={() => setShowDispatch(false)}
          onPosted={(no) => {
            setShowDispatch(false);
            setInfo(`Dispatch posted: ${no}`);
            onChanged();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dispatch dialog — qty per line capped at reserved
// ---------------------------------------------------------------------------

function DispatchDialog({ order, onOpenChange, onPosted }) {
  const [qtyByLine, setQtyByLine] = useState({});
  const [dispatchDate, setDispatchDate] = useState(todayIso());
  const [transporter, setTransporter] = useState("");
  const [lrNo, setLrNo] = useState("");
  const [boxes, setBoxes] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [ewayBillNo, setEwayBillNo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!order) return;
    const initial = {};
    for (const l of order.so_line ?? []) {
      const open = Math.min(Number(l.qty_reserved), Number(l.qty) - Number(l.qty_dispatched));
      initial[l.id] = open > 0 ? String(open) : "";
    }
    setQtyByLine(initial);
    setDispatchDate(todayIso());
    setTransporter("");
    setLrNo("");
    setBoxes("");
    setWeightKg("");
    setEwayBillNo("");
    setNote("");
    setError("");
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;

  const submit = async () => {
    setError("");
    const lines = [];
    for (const l of order.so_line ?? []) {
      const qty = Number(qtyByLine[l.id]);
      if (!qty) continue;
      if (qty < 0 || qty > Number(l.qty_reserved)) {
        setError(`${l.cat_sku?.sku_code}: dispatch qty cannot exceed reserved ${Number(l.qty_reserved)}.`);
        return;
      }
      lines.push({ soLineId: l.id, qty });
    }
    if (!lines.length) {
      setError("Enter a quantity on at least one line.");
      return;
    }
    setSaving(true);
    try {
      const no = await postDispatch({
        soId: order.id,
        lines,
        dispatchDate,
        transporter,
        lrNo,
        boxes: boxes === "" ? null : Number(boxes),
        weightKg: weightKg === "" ? null : Number(weightKg),
        ewayBillNo,
        note
      });
      onPosted(no);
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(order)} onOpenChange={(v) => !v && onOpenChange()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dispatch {order.so_no}</DialogTitle>
          <DialogDescription>
            Quantities are capped at what is reserved — the database enforces it too.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="max-h-52 overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="w-28 text-right">Dispatch qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(order.so_line ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.cat_sku?.sku_code}</TableCell>
                    <TableCell className="text-right">{Number(l.qty_reserved)}</TableCell>
                    <TableCell className="text-right">{Number(l.qty) - Number(l.qty_dispatched)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        className="h-8 text-right"
                        value={qtyByLine[l.id] ?? ""}
                        onChange={(e) => setQtyByLine((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Dispatch date</Label>
              <Input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Transporter</Label>
              <Input value={transporter} onChange={(e) => setTransporter(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>LR no</Label>
              <Input value={lrNo} onChange={(e) => setLrNo(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Boxes</Label>
              <Input type="number" min="0" value={boxes} onChange={(e) => setBoxes(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Weight (kg)</Label>
              <Input type="number" min="0" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>E-way bill no</Label>
              <Input value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not dispatch</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange()}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Posting…" : "Post dispatch"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Job work: create + receive dialogs
// ---------------------------------------------------------------------------

function CreateJobDialog({ open, onOpenChange, workers, entities, locations, skus, onCreated }) {
  const [kind, setKind] = useState("printing");
  const [inHouse, setInHouse] = useState(false);
  const [workerPartyId, setWorkerPartyId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [workerLocationId, setWorkerLocationId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [inputs, setInputs] = useState([{ skuCode: "", qty: "" }]);
  const [outputs, setOutputs] = useState([{ skuCode: "", qty: "" }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const skuByCode = useMemo(() => {
    const map = new Map();
    for (const s of skus) map.set(s.sku_code.toLowerCase(), s);
    return map;
  }, [skus]);

  useEffect(() => {
    if (!open) return;
    setKind("printing");
    setInHouse(false);
    setWorkerPartyId("");
    setEntityId(entities.length === 1 ? entities[0].id : "");
    setLocationId("");
    setWorkerLocationId("");
    setExpectedDate("");
    setNote("");
    setInputs([{ skuCode: "", qty: "" }]);
    setOutputs([{ skuCode: "", qty: "" }]);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parseLines = (rows, label) => {
    const parsed = [];
    for (const [i, l] of rows.entries()) {
      if (!l.skuCode.trim() && !l.qty) continue;
      const sku = skuByCode.get(l.skuCode.trim().toLowerCase());
      if (!sku) throw new Error(`${label} line ${i + 1}: SKU "${l.skuCode}" not found.`);
      const qty = Number(l.qty);
      if (!(qty > 0)) throw new Error(`${label} line ${i + 1}: quantity must be > 0.`);
      parsed.push({ skuId: sku.id, qty });
    }
    return parsed;
  };

  const submit = async () => {
    setError("");
    if (!entityId || !locationId || !workerLocationId) {
      setError("Entity, source location and worker location are required.");
      return;
    }
    if (locationId === workerLocationId) {
      setError("Worker location must differ from the source location.");
      return;
    }
    if (!inHouse && !workerPartyId) {
      setError("Pick a job worker or mark the job in-house.");
      return;
    }
    let parsedInputs;
    let parsedOutputs;
    try {
      parsedInputs = parseLines(inputs, "Input");
      parsedOutputs = parseLines(outputs, "Output");
    } catch (e) {
      setError(e.message);
      return;
    }
    if (!parsedInputs.length || !parsedOutputs.length) {
      setError("Add at least one input line and one output line.");
      return;
    }
    setSaving(true);
    try {
      await createDraftJob({
        entityId,
        kind,
        workerPartyId: inHouse ? null : workerPartyId,
        inHouse,
        locationId,
        workerLocationId,
        expectedDate: expectedDate || null,
        note,
        inputs: parsedInputs,
        outputs: parsedOutputs
      });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const renderRows = (rows, setRows) => (
    <div className="grid gap-2">
      {rows.map((l, idx) => (
        <div key={idx} className="grid grid-cols-[2fr_1fr] gap-2">
          <Input
            placeholder="SKU code"
            value={l.skuCode}
            onChange={(e) =>
              setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, skuCode: e.target.value } : r)))
            }
          />
          <Input
            type="number"
            min="0"
            placeholder="Qty"
            value={l.qty}
            onChange={(e) =>
              setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)))
            }
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setRows((prev) => [...prev, { skuCode: "", qty: "" }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Row
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New job-work order</DialogTitle>
          <DialogDescription>
            Issuing moves the inputs to the worker location (challan out); receiving brings outputs in.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JW_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Worker</Label>
              <Select
                value={inHouse ? "in_house" : workerPartyId}
                onValueChange={(v) => {
                  if (v === "in_house") {
                    setInHouse(true);
                    setWorkerPartyId("");
                  } else {
                    setInHouse(false);
                    setWorkerPartyId(v);
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Pick worker" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_house">In-house line</SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.legal_name}</SelectItem>
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
              <Label>Source location</Label>
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
              <Label>Worker location</Label>
              <Select value={workerLocationId} onValueChange={setWorkerLocationId}>
                <SelectTrigger><SelectValue placeholder="Pick location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Expected back</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label>Inputs (issued to worker)</Label>
              {renderRows(inputs, setInputs)}
            </div>
            <div className="grid content-start gap-2">
              <Label>Outputs (expected back)</Label>
              {renderRows(outputs, setOutputs)}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not create job</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveJobDialog({ job, onOpenChange, onReceived }) {
  const [outputQty, setOutputQty] = useState({});
  const [consumedQty, setConsumedQty] = useState({});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inputLines = (job?.jw_job_line ?? []).filter((l) => l.direction === "input");
  const outputLines = (job?.jw_job_line ?? []).filter((l) => l.direction === "output");

  useEffect(() => {
    if (!job) return;
    const outs = {};
    for (const l of outputLines) {
      const pending = Number(l.qty_planned) - Number(l.qty_moved);
      outs[l.sku_id] = pending > 0 ? String(pending) : "";
    }
    const cons = {};
    for (const l of inputLines) cons[l.sku_id] = String(Number(l.qty_moved));
    setOutputQty(outs);
    setConsumedQty(cons);
    setNote("");
    setError("");
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null;

  const submit = async () => {
    setError("");
    const outputs = [];
    for (const l of outputLines) {
      const qty = Number(outputQty[l.sku_id]);
      if (qty > 0) outputs.push({ skuId: l.sku_id, qty });
    }
    if (!outputs.length) {
      setError("Enter at least one output quantity.");
      return;
    }
    const consumed = [];
    for (const l of inputLines) {
      const qty = Number(consumedQty[l.sku_id]);
      if (qty > 0) consumed.push({ skuId: l.sku_id, qty });
    }
    setSaving(true);
    try {
      await receiveJob({ jobId: job.id, outputs, consumed, note });
      onReceived();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(job)} onOpenChange={(v) => !v && onOpenChange()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive {job.job_no ?? "job"}</DialogTitle>
          <DialogDescription>
            Outputs come into {job.location?.code}; consumed inputs burn at the worker location. Whatever
            input remains at the worker location stays visible there as pending/loss.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label>Outputs received</Label>
            {outputLines.map((l) => (
              <div key={l.id} className="grid grid-cols-[2fr_1fr] items-center gap-2">
                <span className="font-mono text-xs">{l.cat_sku?.sku_code}</span>
                <Input
                  type="number"
                  min="0"
                  className="h-8"
                  value={outputQty[l.sku_id] ?? ""}
                  onChange={(e) => setOutputQty((prev) => ({ ...prev, [l.sku_id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="grid content-start gap-2">
            <Label>Inputs consumed</Label>
            {inputLines.map((l) => (
              <div key={l.id} className="grid grid-cols-[2fr_1fr] items-center gap-2">
                <span className="font-mono text-xs">{l.cat_sku?.sku_code} (sent {Number(l.qty_moved)})</span>
                <Input
                  type="number"
                  min="0"
                  className="h-8"
                  value={consumedQty[l.sku_id] ?? ""}
                  onChange={(e) => setConsumedQty((prev) => ({ ...prev, [l.sku_id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Note</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not receive</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange()}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Posting…" : "Receive"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SLA tab — policy editor + live stage measurements
// ---------------------------------------------------------------------------

function SlaTab() {
  const [policies, setPolicies] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState("b2b");
  const [stage, setStage] = useState("confirm_to_production");
  const [targetHours, setTargetHours] = useState("");
  const [saving, setSaving] = useState(false);
  const [breachesOnly, setBreachesOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, r] = await Promise.all([fetchSlaPolicies(), fetchSlaRows()]);
      setPolicies(p);
      setRows(r);
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePolicy = async () => {
    const hours = Number(targetHours);
    if (!(hours > 0)) {
      setError("Target hours must be greater than zero.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveSlaPolicy({ channel, stage, targetHours: hours, isActive: true });
      setTargetHours("");
      await load();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const visible = breachesOnly ? rows.filter((r) => r.breached) : rows;

  return (
    <div className="grid gap-4">
      <div className="rounded border p-3">
        <p className="mb-2 text-sm font-medium">Stage targets (business hours, Mon–Sat 09:30–18:30)</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SO_CHANNELS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SLA_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Target hours</Label>
            <Input
              type="number"
              min="0"
              className="w-28"
              value={targetHours}
              onChange={(e) => setTargetHours(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={savePolicy} disabled={saving}>
            {saving ? "Saving…" : "Save target"}
          </Button>
        </div>
        {policies.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {policies.map((p) => (
              <Badge key={p.id} variant="outline" className="font-normal">
                {channelLabel(p.channel)} · {stageLabel(p.stage)} · {Number(p.target_hours)}h
              </Badge>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No targets yet — orders are unmeasured.</p>
        )}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>SLA error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {breachesOnly ? "Breached stages" : "All measured stages"} ({visible.length})
        </p>
        <Button variant="outline" size="sm" onClick={() => setBreachesOnly((v) => !v)}>
          {breachesOnly ? "Show all" : "Show breaches only"}
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Elapsed h</TableHead>
                <TableHead className="text-right">Target h</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length ? (
                visible.map((r) => (
                  <TableRow key={`${r.so_id}-${r.stage}`}>
                    <TableCell className="font-mono text-xs">{r.so_no}</TableCell>
                    <TableCell>{r.customer_name}</TableCell>
                    <TableCell>{channelLabel(r.channel)}</TableCell>
                    <TableCell>{stageLabel(r.stage)}</TableCell>
                    <TableCell className="text-right">{Number(r.elapsed_hours)}</TableCell>
                    <TableCell className="text-right">{Number(r.target_hours)}</TableCell>
                    <TableCell>
                      {r.breached ? (
                        <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-700">
                          Breached{r.stage_done ? "" : " · still open"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
                          {r.stage_done ? "Met" : "Running"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Nothing here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function SalesOrdersPanel() {
  const [tab, setTab] = useState("orders");
  const [orders, setOrders] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [parties, setParties] = useState([]);
  const [entities, setEntities] = useState([]);
  const [locations, setLocations] = useState([]);
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateSo, setShowCreateSo] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [detailOrder, setDetailOrder] = useState(null);
  const [receiveJobRow, setReceiveJobRow] = useState(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobMsg, setJobMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, d, j, p, e, loc, s] = await Promise.all([
        fetchSalesOrders(),
        fetchDispatches(),
        fetchJobs(),
        fetchParties(),
        fetchEntities(),
        fetchLocations(),
        fetchSkus()
      ]);
      setOrders(o);
      setDispatches(d);
      setJobs(j);
      setParties(p);
      setEntities(e);
      setLocations(loc.filter((l) => l.is_active));
      setSkus(s.filter((x) => x.is_active));
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the detail dialog in sync after actions reload the list.
  useEffect(() => {
    if (!detailOrder) return;
    const fresh = orders.find((o) => o.id === detailOrder.id);
    if (fresh && fresh !== detailOrder) setDetailOrder(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const customers = useMemo(() => parties.filter((p) => p.kind === "customer"), [parties]);
  const workers = useMemo(() => parties.filter((p) => p.kind === "job_worker"), [parties]);

  const jobAct = async (fn, msg) => {
    setJobBusy(true);
    setJobMsg("");
    setError("");
    try {
      const result = await fn();
      setJobMsg(typeof result === "string" ? `${msg} ${result}` : msg);
      await load();
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setJobBusy(false);
    }
  };

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5" /> Sales Orders
          </h2>
          <p className="text-sm text-muted-foreground">
            Step 3 — orders reserve stock, dispatches consume reservations, job work moves it, SLA watches the clock.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
          {tab === "orders" ? (
            <Button size="sm" onClick={() => setShowCreateSo(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New order
            </Button>
          ) : null}
          {tab === "jobwork" ? (
            <Button size="sm" onClick={() => setShowCreateJob(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New job
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
      {jobMsg ? (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{jobMsg}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orders">
            <ClipboardList className="mr-1 h-3.5 w-3.5" /> Orders
          </TabsTrigger>
          <TabsTrigger value="dispatches">
            <Truck className="mr-1 h-3.5 w-3.5" /> Dispatches
          </TabsTrigger>
          <TabsTrigger value="jobwork">
            <Wrench className="mr-1 h-3.5 w-3.5" /> Job work
          </TabsTrigger>
          <TabsTrigger value="sla">
            <Timer className="mr-1 h-3.5 w-3.5" /> SLA
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {!loading && tab === "orders" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SO no</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Dispatched</TableHead>
                <TableHead className="text-right">Value ₹</TableHead>
                <TableHead>Promised</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length ? (
                orders.map((o) => {
                  const t = orderTotals(o);
                  return (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer"
                      onClick={() => setDetailOrder(o)}
                    >
                      <TableCell className="font-mono text-xs">{o.so_no ?? "draft"}</TableCell>
                      <TableCell>{o.customer?.legal_name}</TableCell>
                      <TableCell>{channelLabel(o.channel)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("font-normal", SO_STATUS_BADGE[o.status])}>
                          {SO_STATUS_LABEL[o.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{t.qty}</TableCell>
                      <TableCell className="text-right">{t.reserved}</TableCell>
                      <TableCell className="text-right">{t.dispatched}</TableCell>
                      <TableCell className="text-right">{formatMoney(t.value)}</TableCell>
                      <TableCell>{formatDate(o.promised_date)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                    No orders yet — create the first one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {!loading && tab === "dispatches" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispatch no</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead>LR no</TableHead>
                <TableHead className="text-right">Pieces</TableHead>
                <TableHead className="text-right">Boxes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatches.length ? (
                dispatches.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.dispatch_no}</TableCell>
                    <TableCell className="font-mono text-xs">{d.so_order?.so_no}</TableCell>
                    <TableCell>{d.so_order?.customer?.legal_name}</TableCell>
                    <TableCell>{formatDate(d.dispatch_date)}</TableCell>
                    <TableCell>{d.transporter ?? "—"}</TableCell>
                    <TableCell>{d.lr_no ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {(d.so_dispatch_line ?? []).reduce((sum, l) => sum + Number(l.qty), 0)}
                    </TableCell>
                    <TableCell className="text-right">{d.boxes ?? "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No dispatches yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {!loading && tab === "jobwork" ? (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job no</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Worker</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Inputs</TableHead>
                <TableHead>Outputs</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length ? (
                jobs.map((j) => {
                  const ins = (j.jw_job_line ?? []).filter((l) => l.direction === "input");
                  const outs = (j.jw_job_line ?? []).filter((l) => l.direction === "output");
                  return (
                    <TableRow key={j.id}>
                      <TableCell className="font-mono text-xs">{j.job_no ?? "draft"}</TableCell>
                      <TableCell>{j.kind}</TableCell>
                      <TableCell>{j.in_house ? "In-house" : j.worker?.legal_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("font-normal", JW_STATUS_BADGE[j.status])}>
                          {JW_STATUS_LABEL[j.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {ins.map((l) => `${l.cat_sku?.sku_code}×${Number(l.qty_planned)}`).join(", ")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {outs.map((l) => `${l.cat_sku?.sku_code}×${Number(l.qty_moved)}/${Number(l.qty_planned)}`).join(", ")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {j.status === "draft" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={jobBusy}
                                onClick={() => jobAct(() => issueJob(j.id), "Issued as")}
                              >
                                Issue
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={jobBusy}
                                onClick={() => jobAct(() => cancelJob(j.id, "Cancelled from panel"), "Job cancelled.")}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : null}
                          {["issued", "received"].includes(j.status) ? (
                            <Button size="sm" variant="outline" disabled={jobBusy} onClick={() => setReceiveJobRow(j)}>
                              Receive
                            </Button>
                          ) : null}
                          {j.status === "received" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={jobBusy}
                              onClick={() => jobAct(() => closeJob(j.id), "Job closed.")}
                            >
                              Close
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No job-work orders yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {!loading && tab === "sla" ? <SlaTab /> : null}

      <CreateSoDialog
        open={showCreateSo}
        onOpenChange={setShowCreateSo}
        customers={customers}
        entities={entities}
        locations={locations}
        skus={skus}
        onCreated={load}
      />
      <CreateJobDialog
        open={showCreateJob}
        onOpenChange={setShowCreateJob}
        workers={workers}
        entities={entities}
        locations={locations}
        skus={skus}
        onCreated={load}
      />
      <SoDetailDialog order={detailOrder} onOpenChange={setDetailOrder} onChanged={load} />
      <ReceiveJobDialog
        job={receiveJobRow}
        onOpenChange={() => setReceiveJobRow(null)}
        onReceived={() => {
          setReceiveJobRow(null);
          load();
        }}
      />
    </div>
  );
}
