import { useEffect, useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  PRINTING_DEPT_MATERIALS,
  PRINTING_UTILIZATION_MATERIAL_KEYS
} from "./printingDeptInventoryUtils";

function emptyQuantitiesMap(materials) {
  return Object.fromEntries(materials.map((item) => [item.key, ""]));
}

export default function RefillPrintingInventoryModal({
  open,
  onClose,
  onSubmit,
  defaultMaterialKey = "",
  mode = "refill"
}) {
  const isIssue = mode === "issue";
  const materialOptions = isIssue
    ? PRINTING_DEPT_MATERIALS.filter((m) => PRINTING_UTILIZATION_MATERIAL_KEYS.has(m.key))
    : PRINTING_DEPT_MATERIALS;

  const inkMaterials = materialOptions.filter((m) => m.group === "Ink");
  const otherMaterials = materialOptions.filter((m) => m.group !== "Ink");

  const [materialKey, setMaterialKey] = useState(() => materialOptions[0]?.key || "");
  const [quantities, setQuantities] = useState(() => emptyQuantitiesMap(materialOptions));
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const allowed = isIssue
      ? PRINTING_DEPT_MATERIALS.filter((m) => PRINTING_UTILIZATION_MATERIAL_KEYS.has(m.key))
      : PRINTING_DEPT_MATERIALS;
    const preferred = defaultMaterialKey && allowed.some((m) => m.key === defaultMaterialKey)
      ? defaultMaterialKey
      : allowed[0]?.key || "";
    setMaterialKey(preferred);
    setQuantities(emptyQuantitiesMap(allowed));
    setQuantity("");
    setNote("");
    setSubmitting(false);
    setError("");
  }, [open, defaultMaterialKey, mode, isIssue]);

  const material = materialOptions.find((m) => m.key === materialKey) ?? materialOptions[0];

  function setBulkQty(key, value) {
    setQuantities((prev) => ({ ...prev, [key]: value }));
  }

  function renderBulkRows(items) {
    return items.map((item) => (
      <div className="printing-dept-bulk-refill-row grid grid-cols-[1fr_7rem] items-center gap-2" key={item.key}>
        <Label htmlFor={`printing-inv-qty-${item.key}`} className="font-normal">
          {item.label}
        </Label>
        <Input
          id={`printing-inv-qty-${item.key}`}
          type="number"
          min="0"
          step="any"
          className="h-8"
          value={quantities[item.key] ?? ""}
          onChange={(e) => setBulkQty(item.key, e.target.value)}
          placeholder="—"
        />
      </div>
    ));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (isIssue) {
      const amount = Number(quantity);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError("Enter how much was used (must be greater than 0).");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        await onSubmit?.({ materialKey, quantity: amount, note, mode });
        onClose?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const bulkRefills = materialOptions
      .map((item) => ({
        materialKey: item.key,
        quantity: Number(quantities[item.key])
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!bulkRefills.length) {
      setError("Enter at least one amount to refill. Blank rows are skipped.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.({ bulkRefills, note, mode });
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className={isIssue ? "sm:max-w-md" : "sm:max-w-2xl"}>
        <DialogHeader>
          <DialogTitle>{isIssue ? "Record usage" : "Refill inventory"}</DialogTitle>
          {!isIssue ? (
            <DialogDescription>
              Fill any materials you received. Leave blank what you are not refilling.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {isIssue ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="printing-inv-material">Material</Label>
                <Select value={materialKey} onValueChange={setMaterialKey} required>
                  <SelectTrigger id="printing-inv-material">
                    <SelectValue placeholder="Select material" />
                  </SelectTrigger>
                  <SelectContent>
                    {materialOptions.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                        {item.unit ? ` (${item.unit})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="printing-inv-qty">
                  Amount used
                  {material?.unit ? ` (${material.unit})` : ""}
                </Label>
                <Input
                  id="printing-inv-qty"
                  type="number"
                  min="0.01"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 5"
                  required
                />
              </div>
            </>
          ) : (
            <div className="printing-dept-bulk-refill max-h-[50vh] space-y-4 overflow-y-auto pr-1">
              {inkMaterials.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Ink</p>
                  <div className="grid gap-2">{renderBulkRows(inkMaterials)}</div>
                </div>
              ) : null}
              {otherMaterials.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Materials</p>
                  <div className="grid gap-2">{renderBulkRows(otherMaterials)}</div>
                </div>
              ) : null}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="printing-inv-note">Note (optional)</Label>
            <Input
              id="printing-inv-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isIssue ? "Job, order, reason…" : "Supplier, batch, etc."}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="destructive" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant={isIssue ? "destructive" : "success"} disabled={submitting}>
              {submitting ? "Saving…" : isIssue ? "Record usage" : "Record refill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
