import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";
import { nextParentCode } from "../inventorySkuGrouping";
import AddSubSkuDialog from "./AddSubSkuDialog";

const TAB_KIND = { fabrics: "fabric", trims: "trim", apparel: "apparel" };

const KIND_LABEL = { fabric: "Fabric", trim: "Trim", apparel: "Apparel" };

export default function SkuManagementModal({ tabKind = "apparel", onClose, onSkuCreated, openSku }) {
  const invKind = TAB_KIND[tabKind] || "apparel";
  const { styleParents, skus, createStyleParent } = useInventory();
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [showAddParent, setShowAddParent] = useState(false);
  const [addSubForParent, setAddSubForParent] = useState(null);
  const [parentForm, setParentForm] = useState({ parentSkuCode: "", styleName: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parents = useMemo(
    () =>
      (styleParents || [])
        .filter((p) => p.kind === invKind)
        .filter((p) => {
          if (!query) return true;
          const q = query.toLowerCase();
          return (
            (p.parentSkuCode || "").toLowerCase().includes(q) ||
            (p.styleName || "").toLowerCase().includes(q)
          );
        })
        .sort((a, b) => (a.styleName || "").localeCompare(b.styleName || "")),
    [styleParents, invKind, query]
  );

  const childCountByParent = useMemo(() => {
    const map = new Map();
    for (const s of skus) {
      if (s.kind !== invKind || !s.parentStyleId) continue;
      map.set(s.parentStyleId, (map.get(s.parentStyleId) || 0) + 1);
    }
    return map;
  }, [skus, invKind]);

  const selected = parents.find((p) => p.id === selectedId) || null;

  const children = useMemo(() => {
    if (!selectedId) return [];
    return skus
      .filter((s) => s.parentStyleId === selectedId && s.kind === invKind)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [skus, selectedId, invKind]);

  const openAddParent = () => {
    setParentForm({
      parentSkuCode: nextParentCode(styleParents || [], invKind),
      styleName: ""
    });
    setShowAddParent(true);
    setError("");
  };

  const submitParent = async (e) => {
    e?.preventDefault();
    if (!parentForm.styleName.trim()) {
      setError("Style name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const parent = await createStyleParent({
        parentSkuCode: parentForm.parentSkuCode.trim(),
        styleName: parentForm.styleName.trim(),
        kind: invKind
      });
      setShowAddParent(false);
      setSelectedId(parent.id);
      setAddSubForParent(parent);
    } catch (err) {
      setError(err?.message || "Could not create parent SKU.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>SKU management</DialogTitle>
            <DialogDescription>
              Parent styles and sub SKUs for {KIND_LABEL[invKind] || invKind}. Select a parent to view its variants.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6 pt-4">
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={openAddParent}>
                Add parent SKU
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!selected}
                onClick={() => selected && setAddSubForParent(selected)}
              >
                Add sub SKU
              </Button>
              <div className="relative ml-auto w-full sm:w-56">
                <Input
                  placeholder="Search parent SKUs…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(220px,280px)_1fr]">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border">
                <div className="shrink-0 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Parent SKUs ({parents.length})
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {parents.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No parent SKUs yet. Add one to group sub SKUs.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {parents.map((p) => {
                        const count = childCountByParent.get(p.id) || 0;
                        const active = p.id === selectedId;
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(p.id)}
                              className={cn(
                                "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                                active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                              )}
                            >
                              <span className="font-mono text-xs opacity-80">{p.parentSkuCode}</span>
                              <span className="font-medium leading-snug">{p.styleName}</span>
                              <Badge
                                variant={active ? "outline" : "secondary"}
                                className={cn("mt-1 h-5 px-1.5 text-[10px] font-normal", active && "border-primary-foreground/30 text-primary-foreground")}
                              >
                                {count} sub SKU{count === 1 ? "" : "s"}
                              </Badge>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border">
                <div className="shrink-0 border-b bg-muted/40 px-4 py-2">
                  {selected ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-xs text-muted-foreground">{selected.parentSkuCode}</span>
                      <span className="text-sm font-medium">{selected.styleName}</span>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">Select a parent SKU</span>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {!selected ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                      Click a parent on the left to see its sub SKUs.
                    </p>
                  ) : children.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                      <p className="text-sm text-muted-foreground">No sub SKUs under this parent yet.</p>
                      <Button type="button" size="sm" onClick={() => setAddSubForParent(selected)}>
                        Add sub SKU
                      </Button>
                    </div>
                  ) : (
                    <Table data-shadcn-table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sub SKU</TableHead>
                          <TableHead>Color</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                          <TableHead className="w-[88px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {children.map((sku) => (
                          <TableRow key={sku._uuid || sku.id}>
                            <TableCell className="font-mono text-xs">{sku.id}</TableCell>
                            <TableCell>{sku.color || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {Number(sku.totalStock ?? sku.stock ?? 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => openSku?.(sku)}
                              >
                                Open
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAddParent ? (
        <Dialog open onOpenChange={(open) => !open && setShowAddParent(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add parent SKU</DialogTitle>
              <DialogDescription>
                Create a parent style for {KIND_LABEL[invKind]}. You will add the first sub SKU next so it appears in inventory.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitParent} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="parent-sku-code">Parent SKU code</Label>
                <Input
                  id="parent-sku-code"
                  value={parentForm.parentSkuCode}
                  onChange={(e) => setParentForm((f) => ({ ...f, parentSkuCode: e.target.value }))}
                  className="font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parent-style-name">Style name</Label>
                <Input
                  id="parent-style-name"
                  value={parentForm.styleName}
                  onChange={(e) => setParentForm((f) => ({ ...f, styleName: e.target.value }))}
                  placeholder="e.g. Essential Crew Tee"
                  required
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddParent(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Create parent"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {addSubForParent ? (
        <AddSubSkuDialog
          parent={addSubForParent}
          kind={invKind}
          onClose={() => setAddSubForParent(null)}
          onCreated={(created) => {
            setSelectedId(addSubForParent.id);
            onSkuCreated?.(created);
          }}
        />
      ) : null}
    </>
  );
}
