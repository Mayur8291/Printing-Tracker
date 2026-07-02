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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  fetchPrintingDeptThresholds,
  formatQtyWithUnit,
  inventoryItemsFromState,
  PRINTING_DEPT_MATERIALS,
  savePrintingDeptThresholds
} from "./printingDeptInventoryUtils";

export default function PrintingDeptThresholdModal({ open, onClose, state, sessionUserId, isAdmin = false }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setError("");
    setMessage("");
    void fetchPrintingDeptThresholds()
      .then((thresholds) => {
        const next = {};
        for (const material of PRINTING_DEPT_MATERIALS) {
          next[material.key] = String(thresholds[material.key] ?? 0);
        }
        setDrafts(next);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [open]);

  const items = inventoryItemsFromState(state);

  async function handleSave(e) {
    e.preventDefault();
    if (!isAdmin) {
      setError("Only admins can set printing inventory thresholds.");
      return;
    }
    if (!sessionUserId) {
      setError("You must be signed in to save thresholds.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {};
      for (const material of PRINTING_DEPT_MATERIALS) {
        const raw = drafts[material.key] ?? "0";
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Enter a valid threshold for ${material.label}.`);
        }
        payload[material.key] = value;
      }
      await savePrintingDeptThresholds({ thresholds: payload, userId: sessionUserId, isAdmin });
      setMessage("Thresholds saved.");
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Low-stock thresholds</DialogTitle>
          <DialogDescription>
            Set minimum stock per material. Admins get a notification when stock drops below the threshold.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Current stock</TableHead>
                  <TableHead className="text-right">Alert below</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell>{item.label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatQtyWithUnit(item.quantity, item.unit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          className="h-8 w-24 text-right"
                          value={drafts[item.key] ?? "0"}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                        />
                        {item.unit ? (
                          <span className="text-xs text-muted-foreground">{item.unit}</span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="destructive" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="success" disabled={saving}>
              {saving ? "Saving…" : "Save thresholds"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
