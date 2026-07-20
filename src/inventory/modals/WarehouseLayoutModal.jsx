import { useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";

const DEFAULT_ZONES = [{ name: "A", rows: 8, cols: 10 }];

function normalizeZones(layout) {
  const zones = Array.isArray(layout?.zones) ? layout.zones : null;
  if (!zones?.length) return DEFAULT_ZONES.map((z) => ({ ...z }));
  return zones.map((z, i) => ({
    name: String(z?.name ?? String.fromCharCode(65 + i))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4) || String.fromCharCode(65 + i),
    rows: Math.min(40, Math.max(1, Number(z?.rows) || 8)),
    cols: Math.min(40, Math.max(1, Number(z?.cols) || 10))
  }));
}

/**
 * Edit the warehouse bin-map layout (zones with rows × cols).
 * Saved to inventory_warehouses.layout — Stock/Order APIs are unaffected.
 */
export default function WarehouseLayoutModal({ warehouse, onClose, onSubmit }) {
  const [zones, setZones] = useState(() => normalizeZones(warehouse?.layout));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateZone = (idx, patch) => {
    setZones((list) => list.map((z, i) => (i === idx ? { ...z, ...patch } : z)));
  };

  const addZone = () => {
    const nextLetter = String.fromCharCode(65 + zones.length);
    setZones((list) => [...list, { name: nextLetter, rows: 8, cols: 10 }]);
  };

  const removeZone = (idx) => {
    if (zones.length <= 1) return;
    setZones((list) => list.filter((_, i) => i !== idx));
  };

  const submit = async (e) => {
    e?.preventDefault();
    const cleaned = normalizeZones({ zones });
    if (!cleaned.length) {
      setError("Add at least one zone.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({ zones: cleaned });
    } catch (err) {
      setError(err?.message || "Could not save layout.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit layout — {warehouse?.name}</DialogTitle>
          <DialogDescription>
            Define zones for the bin map (name, rows, columns). This only affects the warehouse page
            display — stock APIs are unchanged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-3">
            {zones.map((zone, idx) => (
              <div key={idx} className="grid grid-cols-[4rem_1fr_1fr_auto] items-end gap-2 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Zone</Label>
                  <Input
                    value={zone.name}
                    onChange={(e) =>
                      updateZone(idx, {
                        name: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)
                      })
                    }
                    className="h-8 font-mono text-xs"
                    maxLength={4}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Rows</Label>
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={zone.rows}
                    onChange={(e) => updateZone(idx, { rows: e.target.value })}
                    className="h-8"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Columns</Label>
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={zone.cols}
                    onChange={(e) => updateZone(idx, { cols: e.target.value })}
                    className="h-8"
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground"
                  onClick={() => removeZone(idx)}
                  disabled={zones.length <= 1}
                  aria-label={`Remove zone ${zone.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addZone}>
            <Plus className="size-3.5" /> Add zone
          </Button>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save layout"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
