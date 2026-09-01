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
import { AlertTriangle, ArrowRightLeft, Layers, Plus, RefreshCw } from "lucide-react";
import { fetchLocations, fetchSkus } from "./mastersUtils";
import {
  MOVEMENT_REASON_LABEL,
  MOVEMENT_TYPES,
  STOCK_STATES,
  STOCK_STATE_LABEL,
  balanceKey,
  fetchActiveReservations,
  fetchDriftAlerts,
  fetchStockBalances,
  fetchStockMovements,
  postStockMovement
} from "./stockLedgerUtils";

const STATE_BADGE = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  qc_hold: "bg-amber-50 text-amber-700 border-amber-200",
  damaged: "bg-red-50 text-red-700 border-red-200"
};

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function PostMovementDialog({ open, onOpenChange, skus, locations, onPosted }) {
  const [typeId, setTypeId] = useState("receive");
  const [skuCode, setSkuCode] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState("");
  const [state, setState] = useState("good");
  const [note, setNote] = useState("");
  const [lot, setLot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const type = MOVEMENT_TYPES.find((t) => t.id === typeId) ?? MOVEMENT_TYPES[0];

  useEffect(() => {
    if (open) {
      setTypeId("receive");
      setSkuCode("");
      setFromId("");
      setToId("");
      setQty("");
      setState("good");
      setNote("");
      setLot("");
      setError("");
    }
  }, [open]);

  const skuByCode = useMemo(() => {
    const map = {};
    for (const s of skus ?? []) map[String(s.sku_code).toUpperCase()] = s;
    return map;
  }, [skus]);

  async function handlePost() {
    setError("");
    const sku = skuByCode[skuCode.trim().toUpperCase()];
    if (!sku) {
      setError("SKU code not found in masters — add it in Platform Masters first.");
      return;
    }
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) {
      setError("Quantity must be more than zero.");
      return;
    }
    if (type.needsFrom && !fromId) {
      setError("Pick the from location.");
      return;
    }
    if (type.needsTo && !toId) {
      setError("Pick the to location.");
      return;
    }
    if (type.reason === "adjustment" && !note.trim()) {
      setError("Adjustments need a reason note.");
      return;
    }

    setSaving(true);
    try {
      await postStockMovement({
        skuId: sku.id,
        fromLocationId: type.needsFrom ? fromId : null,
        toLocationId: type.needsTo ? toId : null,
        qty: qtyNum,
        state,
        reason: type.reason,
        note: note.trim() || null,
        lot: lot.trim() || null
      });
      onPosted?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not post movement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post stock movement</DialogTitle>
          <DialogDescription>
            Writes an append-only ledger row through the locked database function. Corrections are
            reversing movements, never edits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENT_TYPES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mv-sku">SKU code *</Label>
              <Input
                id="mv-sku"
                value={skuCode}
                onChange={(e) => setSkuCode(e.target.value)}
                placeholder="As in Platform Masters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mv-qty">Quantity *</Label>
              <Input id="mv-qty" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>
          {type.needsFrom ? (
            <div className="space-y-2">
              <Label>From location</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick location" />
                </SelectTrigger>
                <SelectContent>
                  {(locations ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {type.needsTo ? (
            <div className="space-y-2">
              <Label>To location</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick location" />
                </SelectTrigger>
                <SelectContent>
                  {(locations ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Stock state</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STOCK_STATE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mv-lot">Lot / batch</Label>
              <Input id="mv-lot" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mv-note">
              Note{type.reason === "adjustment" ? " * (why is stock being adjusted?)" : ""}
            </Label>
            <Textarea id="mv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handlePost()}>
            {saving ? "Posting…" : "Post movement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stock Ledger (Step 1, One Source of Truth) — admin view over inv_balance /
 * inv_movement. On-hand is a sum over movements; this screen never edits a
 * quantity, it only posts new movements through the DB function.
 */
export default function StockLedgerPanel() {
  const [view, setView] = useState("balances");
  const [balances, setBalances] = useState([]);
  const [movements, setMovements] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [driftAlerts, setDriftAlerts] = useState([]);
  const [skus, setSkus] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [postOpen, setPostOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, m, r, d, s, l] = await Promise.all([
        fetchStockBalances(),
        fetchStockMovements(),
        fetchActiveReservations(),
        fetchDriftAlerts(),
        fetchSkus(),
        fetchLocations()
      ]);
      setBalances(b);
      setMovements(m);
      setReservations(r);
      setDriftAlerts(d);
      setSkus(s);
      setLocations(l);
      setError("");
    } catch (e) {
      const msg = e.message || "Could not load the stock ledger.";
      if (msg.includes("Could not find the table")) {
        setError("Ledger tables not on this database yet — apply migration 20260901191500_step1_stock_ledger.sql.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const reservedByKey = useMemo(() => {
    const map = {};
    for (const r of reservations) {
      const key = balanceKey(r.sku_id, r.location_id);
      map[key] = (map[key] ?? 0) + Number(r.qty);
    }
    return map;
  }, [reservations]);

  const visibleBalances = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances.filter((b) => {
      if (stateFilter !== "all" && b.state !== stateFilter) return false;
      if (!q) return true;
      return [b.cat_sku?.sku_code, b.core_location?.code, b.core_location?.name]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ")
        .includes(q);
    });
  }, [balances, search, stateFilter]);

  const visibleMovements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return movements;
    return movements.filter((m) =>
      [m.cat_sku?.sku_code, m.from_location?.code, m.to_location?.code, m.reason, m.note, m.ref_id]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ")
        .includes(q)
    );
  }, [movements, search]);

  return (
    <section className="panel table-panel dashboard-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="dashboard-section-title flex items-center gap-2">
            <Layers className="h-5 w-5" aria-hidden />
            Stock Ledger
          </h2>
          <p className="text-sm text-muted-foreground">
            Append-only movements (Step 1). On-hand is a sum — nobody edits a quantity; corrections
            are reversing movements with a reason.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAll()}>
            <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => setPostOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Post movement
          </Button>
        </div>
      </div>

      {driftAlerts.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Stock drift detected</AlertTitle>
          <AlertDescription>
            {driftAlerts.length} balance row{driftAlerts.length === 1 ? "" : "s"} do not match the
            movement ledger. Investigate before trusting stock figures (see docs/DEBUGGING.md).
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="balances">Stock by location</TabsTrigger>
            <TabsTrigger value="movements">Movements</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          className="max-w-xs"
          placeholder="Search SKU or location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {view === "balances" ? (
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {STOCK_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STOCK_STATE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : view === "balances" ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBalances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No stock rows yet — post a Receive (GRN) movement to begin.
                  </TableCell>
                </TableRow>
              ) : (
                visibleBalances.map((b) => {
                  const reserved =
                    b.state === "good" ? reservedByKey[balanceKey(b.sku_id, b.location_id)] ?? 0 : 0;
                  return (
                    <TableRow key={`${b.sku_id}-${b.location_id}-${b.state}`}>
                      <TableCell className="font-medium">{b.cat_sku?.sku_code ?? "—"}</TableCell>
                      <TableCell>
                        {b.core_location?.code ?? "—"}
                        <span className="text-muted-foreground"> · {b.core_location?.name ?? ""}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(STATE_BADGE[b.state])}>
                          {STOCK_STATE_LABEL[b.state] ?? b.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{Number(b.qty)}</TableCell>
                      <TableCell className="text-right">{reserved}</TableCell>
                      <TableCell className="text-right">{Number(b.qty) - reserved}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(b.updated_at)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Move</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note / ref</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleMovements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No movements yet.
                  </TableCell>
                </TableRow>
              ) : (
                visibleMovements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{m.cat_sku?.sku_code ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {m.from_location?.code ?? "∅"}
                      <ArrowRightLeft className="mx-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
                      {m.to_location?.code ?? "∅"}
                    </TableCell>
                    <TableCell className="text-right">{Number(m.qty)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(STATE_BADGE[m.state])}>
                        {STOCK_STATE_LABEL[m.state] ?? m.state}
                      </Badge>
                    </TableCell>
                    <TableCell>{MOVEMENT_REASON_LABEL[m.reason] ?? m.reason}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">
                      {m.note || (m.ref_type ? `${m.ref_type}:${m.ref_id ?? ""}` : "—")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <PostMovementDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        skus={skus}
        locations={locations}
        onPosted={() => void loadAll()}
      />
    </section>
  );
}
