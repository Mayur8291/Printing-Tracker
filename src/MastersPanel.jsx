import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Database, FileUp, Plus, RefreshCw } from "lucide-react";
import MastersImportDialog from "./MastersImportDialog";
import {
  ITEM_KINDS,
  ITEM_KIND_LABEL,
  LOCATION_KINDS,
  MSME_CATEGORIES,
  OWNER_SYSTEMS,
  PARTY_KINDS,
  PARTY_KIND_LABEL,
  VIRTUAL_KINDS,
  addGstin,
  fetchEntities,
  fetchLocations,
  fetchParties,
  fetchSkus,
  saveEntity,
  saveLocation,
  saveParty,
  saveSku
} from "./mastersUtils";

const EMPTY_PARTY = {
  kind: "customer",
  legal_name: "",
  trade_name: "",
  segment: "",
  credit_days: 0,
  pan: "",
  msme_udyam_number: "",
  msme_category: "",
  payment_terms: "",
  notes: ""
};

const EMPTY_SKU = {
  sku_code: "",
  barcode: "",
  size_label: "",
  hsn: "",
  item_kind: "finished_good",
  uom: "pcs",
  weight_grams: "",
  mrp: ""
};

const EMPTY_ENTITY = { code: "", legal_name: "", trade_name: "", pan: "" };

const EMPTY_LOCATION = {
  code: "",
  name: "",
  kind: "warehouse",
  virtual_kind: "",
  owner_system: "platform",
  parent_id: ""
};

function LoadingRows() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function PartyDialog({ open, onOpenChange, party, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_PARTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(party ? { ...EMPTY_PARTY, ...party, msme_category: party.msme_category ?? "" } : { ...EMPTY_PARTY });
    setError("");
  }, [open, party]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const row = await saveParty(form, party?.id);
      onSaved?.(row, Boolean(party?.id));
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not save party.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{party ? "Edit party" : "New party"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setField("kind", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTY_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {PARTY_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="party-segment">Segment</Label>
              <Input
                id="party-segment"
                value={form.segment ?? ""}
                onChange={(e) => setField("segment", e.target.value)}
                placeholder="Retail, Corporate…"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="party-legal-name">Legal name *</Label>
            <Input
              id="party-legal-name"
              value={form.legal_name ?? ""}
              onChange={(e) => setField("legal_name", e.target.value)}
              placeholder="As on GST / Tally ledger"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="party-trade-name">Trade name</Label>
              <Input
                id="party-trade-name"
                value={form.trade_name ?? ""}
                onChange={(e) => setField("trade_name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="party-pan">PAN</Label>
              <Input id="party-pan" value={form.pan ?? ""} onChange={(e) => setField("pan", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="party-credit-days">Credit days</Label>
              <Input
                id="party-credit-days"
                type="number"
                min="0"
                value={form.credit_days ?? 0}
                onChange={(e) => setField("credit_days", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="party-payment-terms">Payment terms</Label>
              <Input
                id="party-payment-terms"
                value={form.payment_terms ?? ""}
                onChange={(e) => setField("payment_terms", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="party-udyam">MSME / Udyam no.</Label>
              <Input
                id="party-udyam"
                value={form.msme_udyam_number ?? ""}
                onChange={(e) => setField("msme_udyam_number", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>MSME category</Label>
              <Select
                value={form.msme_category || "__none__"}
                onValueChange={(v) => setField("msme_category", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not MSME" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not MSME</SelectItem>
                  {MSME_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="party-notes">Notes</Label>
            <Textarea
              id="party-notes"
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save party"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkuDialog({ open, onOpenChange, sku, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_SKU });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(
      sku
        ? {
            ...EMPTY_SKU,
            ...sku,
            weight_grams: sku.weight_grams ?? "",
            mrp: sku.mrp ?? ""
          }
        : { ...EMPTY_SKU }
    );
    setError("");
  }, [open, sku]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const row = await saveSku(form, sku?.id);
      onSaved?.(row, Boolean(sku?.id));
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not save SKU.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sku ? `Edit ${sku.sku_code}` : "New SKU"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="sku-code">SKU code *</Label>
            <Input
              id="sku-code"
              value={form.sku_code ?? ""}
              onChange={(e) => setField("sku_code", e.target.value)}
              placeholder="Existing codes stay exactly as they are"
              disabled={Boolean(sku?.id)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sku-barcode">Barcode / EAN</Label>
              <Input id="sku-barcode" value={form.barcode ?? ""} onChange={(e) => setField("barcode", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku-size">Size label</Label>
              <Input id="sku-size" value={form.size_label ?? ""} onChange={(e) => setField("size_label", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Item kind</Label>
              <Select value={form.item_kind} onValueChange={(v) => setField("item_kind", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {ITEM_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku-hsn">HSN</Label>
              <Input id="sku-hsn" value={form.hsn ?? ""} onChange={(e) => setField("hsn", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="sku-uom">UOM</Label>
              <Input id="sku-uom" value={form.uom ?? "pcs"} onChange={(e) => setField("uom", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku-weight">Weight (g)</Label>
              <Input
                id="sku-weight"
                type="number"
                min="0"
                value={form.weight_grams ?? ""}
                onChange={(e) => setField("weight_grams", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku-mrp">MRP</Label>
              <Input
                id="sku-mrp"
                type="number"
                min="0"
                value={form.mrp ?? ""}
                onChange={(e) => setField("mrp", e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save SKU"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntityDialog({ open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_ENTITY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_ENTITY });
      setError("");
    }
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await saveEntity(form);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not save entity.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New legal entity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="entity-code">Code *</Label>
            <Input
              id="entity-code"
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
              placeholder="SFIPL"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entity-legal">Legal name *</Label>
            <Input
              id="entity-legal"
              value={form.legal_name}
              onChange={(e) => setForm((p) => ({ ...p, legal_name: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entity-trade">Trade name</Label>
              <Input
                id="entity-trade"
                value={form.trade_name}
                onChange={(e) => setForm((p) => ({ ...p, trade_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-pan">PAN</Label>
              <Input
                id="entity-pan"
                value={form.pan}
                onChange={(e) => setForm((p) => ({ ...p, pan: e.target.value }))}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save entity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GstinDialog({ open, onOpenChange, entities, onSaved }) {
  const [entityId, setEntityId] = useState("");
  const [gstin, setGstin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setEntityId(entities?.[0]?.id ?? "");
      setGstin("");
      setError("");
    }
  }, [open, entities]);

  async function handleSave() {
    if (!entityId) {
      setError("Pick an entity.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addGstin({ entityId, gstin });
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not add GSTIN.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add GSTIN</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Entity</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick entity" />
              </SelectTrigger>
              <SelectContent>
                {(entities ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gstin-value">GSTIN (15 characters)</Label>
            <Input
              id="gstin-value"
              value={gstin}
              maxLength={15}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="29ABCDE1234F1Z5"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Add GSTIN"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LocationDialog({ open, onOpenChange, locations, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_LOCATION });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_LOCATION });
      setError("");
    }
  }, [open]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const parents = (locations ?? []).filter((l) => l.kind === "warehouse" || l.kind === "zone");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await saveLocation(form);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Could not save location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New location</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="loc-code">Code *</Label>
              <Input id="loc-code" value={form.code} onChange={(e) => setField("code", e.target.value)} placeholder="MAKALI" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-name">Name *</Label>
              <Input id="loc-name" value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setField("kind", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Owner system</Label>
              <Select value={form.owner_system} onValueChange={(v) => setField("owner_system", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OWNER_SYSTEMS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.kind === "virtual" ? (
            <div className="space-y-2">
              <Label>Virtual kind</Label>
              <Select value={form.virtual_kind || undefined} onValueChange={(v) => setField("virtual_kind", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick virtual kind" />
                </SelectTrigger>
                <SelectContent>
                  {VIRTUAL_KINDS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {(form.kind === "zone" || form.kind === "bin") && parents.length > 0 ? (
            <div className="space-y-2">
              <Label>Parent location</Label>
              <Select
                value={form.parent_id || "__none__"}
                onValueChange={(v) => setField("parent_id", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No parent</SelectItem>
                  {parents.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Platform Masters (Step 0, One Source of Truth) — admin-only screens over
 * crm_party / cat_sku / core_entity+core_gstin / core_location, with CSV
 * import + dedupe report for parties and SKUs. Separate from the frozen
 * Scott API "Masters" tab.
 */
export default function MastersPanel() {
  const [tab, setTab] = useState("parties");

  const [parties, setParties] = useState([]);
  const [skus, setSkus] = useState([]);
  const [entities, setEntities] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [partySearch, setPartySearch] = useState("");
  const [partyKindFilter, setPartyKindFilter] = useState("all");
  const [skuSearch, setSkuSearch] = useState("");

  const [partyDialogOpen, setPartyDialogOpen] = useState(false);
  const [editingParty, setEditingParty] = useState(null);
  const [skuDialogOpen, setSkuDialogOpen] = useState(false);
  const [editingSku, setEditingSku] = useState(null);
  const [entityDialogOpen, setEntityDialogOpen] = useState(false);
  const [gstinDialogOpen, setGstinDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [importKind, setImportKind] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, e, l] = await Promise.all([
        fetchParties(),
        fetchSkus(),
        fetchEntities(),
        fetchLocations()
      ]);
      setParties(p);
      setSkus(s);
      setEntities(e);
      setLocations(l);
      setError("");
    } catch (err) {
      const msg = err.message || "Could not load masters.";
      if (msg.includes("Could not find the table")) {
        setError("Masters tables not on this database yet — apply migration 20260901180000_step0_masters_and_entities.sql.");
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

  const visibleParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    return parties.filter((p) => {
      if (partyKindFilter !== "all" && p.kind !== partyKindFilter) return false;
      if (!q) return true;
      return [p.legal_name, p.trade_name, p.segment, p.pan]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ")
        .includes(q);
    });
  }, [parties, partySearch, partyKindFilter]);

  const visibleSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter((s) =>
      [s.sku_code, s.barcode, s.size_label, s.hsn]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ")
        .includes(q)
    );
  }, [skus, skuSearch]);

  const locationById = useMemo(() => {
    const map = {};
    for (const l of locations) map[l.id] = l;
    return map;
  }, [locations]);

  function handlePartySaved(row, wasEdit) {
    setParties((prev) => (wasEdit ? prev.map((p) => (p.id === row.id ? row : p)) : [...prev, row]));
  }

  function handleSkuSaved(row, wasEdit) {
    setSkus((prev) => (wasEdit ? prev.map((s) => (s.id === row.id ? row : s)) : [...prev, row]));
  }

  return (
    <section className="panel table-panel dashboard-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="dashboard-section-title flex items-center gap-2">
            <Database className="h-5 w-5" aria-hidden />
            Platform Masters
          </h2>
          <p className="text-sm text-muted-foreground">
            One master per entity (Step 0). Parties, SKUs, legal entities & GSTINs, locations.
            Existing SKU codes are inherited exactly — never renamed.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadAll()}>
          <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="parties">Parties ({parties.length})</TabsTrigger>
          <TabsTrigger value="skus">SKUs ({skus.length})</TabsTrigger>
          <TabsTrigger value="entities">Entities & GSTINs ({entities.length})</TabsTrigger>
          <TabsTrigger value="locations">Locations ({locations.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <LoadingRows />
      ) : (
        <>
          {tab === "parties" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="Search name, PAN, segment…"
                  value={partySearch}
                  onChange={(e) => setPartySearch(e.target.value)}
                />
                <Select value={partyKindFilter} onValueChange={setPartyKindFilter}>
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All kinds</SelectItem>
                    {PARTY_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {PARTY_KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setImportKind("party")}>
                    <FileUp className="mr-1 h-4 w-4" aria-hidden />
                    Import CSV
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditingParty(null);
                      setPartyDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden />
                    New party
                  </Button>
                </div>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Legal name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Segment</TableHead>
                      <TableHead>Credit days</TableHead>
                      <TableHead>MSME</TableHead>
                      <TableHead>PAN</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleParties.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          No parties yet — add one or import the cleaned customer list.
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleParties.map((p) => (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            setEditingParty(p);
                            setPartyDialogOpen(true);
                          }}
                        >
                          <TableCell className="font-medium">
                            {p.legal_name}
                            {p.trade_name ? (
                              <span className="text-muted-foreground"> · {p.trade_name}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{PARTY_KIND_LABEL[p.kind] ?? p.kind}</Badge>
                          </TableCell>
                          <TableCell>{p.segment || "—"}</TableCell>
                          <TableCell>{p.credit_days ?? 0}</TableCell>
                          <TableCell>{p.msme_category || "—"}</TableCell>
                          <TableCell>{p.pan || "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {tab === "skus" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="Search code, barcode, HSN…"
                  value={skuSearch}
                  onChange={(e) => setSkuSearch(e.target.value)}
                />
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setImportKind("sku")}>
                    <FileUp className="mr-1 h-4 w-4" aria-hidden />
                    Import CSV
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditingSku(null);
                      setSkuDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden />
                    New SKU
                  </Button>
                </div>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU code</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Item kind</TableHead>
                      <TableHead>HSN</TableHead>
                      <TableHead>UOM</TableHead>
                      <TableHead>MRP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSkus.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          No SKUs yet — import the cleaned SKU list (codes inherited as-is).
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleSkus.map((s) => (
                        <TableRow
                          key={s.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            setEditingSku(s);
                            setSkuDialogOpen(true);
                          }}
                        >
                          <TableCell className="font-medium">{s.sku_code}</TableCell>
                          <TableCell>{s.size_label || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{ITEM_KIND_LABEL[s.item_kind] ?? s.item_kind}</Badge>
                          </TableCell>
                          <TableCell>{s.hsn || "—"}</TableCell>
                          <TableCell>{s.uom}</TableCell>
                          <TableCell>{s.mrp ?? "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {tab === "entities" && (
            <div className="space-y-3">
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setGstinDialogOpen(true)} disabled={entities.length === 0}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  Add GSTIN
                </Button>
                <Button type="button" size="sm" onClick={() => setEntityDialogOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  New entity
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Legal name</TableHead>
                      <TableHead>PAN</TableHead>
                      <TableHead>GSTINs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          No legal entities yet — add the 15 seller entities/GSTINs here.
                        </TableCell>
                      </TableRow>
                    ) : (
                      entities.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{e.code}</TableCell>
                          <TableCell>
                            {e.legal_name}
                            {e.trade_name ? <span className="text-muted-foreground"> · {e.trade_name}</span> : null}
                          </TableCell>
                          <TableCell>{e.pan || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(e.core_gstin ?? []).length === 0
                                ? "—"
                                : (e.core_gstin ?? []).map((g) => (
                                    <Badge key={g.id} variant="outline">
                                      {g.gstin}
                                    </Badge>
                                  ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {tab === "locations" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={() => setLocationDialogOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  New location
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Parent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          No locations yet — add Makali, Guttahalli, zones and virtual locations.
                        </TableCell>
                      </TableRow>
                    ) : (
                      locations.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.code}</TableCell>
                          <TableCell>{l.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {l.kind}
                              {l.virtual_kind ? ` · ${l.virtual_kind}` : ""}
                            </Badge>
                          </TableCell>
                          <TableCell>{l.owner_system}</TableCell>
                          <TableCell>{l.parent_id ? locationById[l.parent_id]?.code ?? "—" : "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

      <PartyDialog
        open={partyDialogOpen}
        onOpenChange={setPartyDialogOpen}
        party={editingParty}
        onSaved={handlePartySaved}
      />
      <SkuDialog open={skuDialogOpen} onOpenChange={setSkuDialogOpen} sku={editingSku} onSaved={handleSkuSaved} />
      <EntityDialog open={entityDialogOpen} onOpenChange={setEntityDialogOpen} onSaved={() => void loadAll()} />
      <GstinDialog
        open={gstinDialogOpen}
        onOpenChange={setGstinDialogOpen}
        entities={entities}
        onSaved={() => void loadAll()}
      />
      <LocationDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        locations={locations}
        onSaved={() => void loadAll()}
      />
      <MastersImportDialog
        open={importKind != null}
        onOpenChange={(next) => {
          if (!next) setImportKind(null);
        }}
        kind={importKind ?? "party"}
        existingRows={importKind === "sku" ? skus : parties}
        onImported={() => void loadAll()}
      />
    </section>
  );
}
