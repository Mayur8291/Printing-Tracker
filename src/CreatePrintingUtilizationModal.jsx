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
import { createPrintingUtilizationEntry } from "./printingUtilizationUtils";

export default function CreatePrintingUtilizationModal({ open, onClose, sessionUserId, onCreated }) {
  const [printingMetres, setPrintingMetres] = useState("");
  const [pcsFused, setPcsFused] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrintingMetres("");
    setPcsFused("");
    setSubmitting(false);
    setError("");
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const entry = await createPrintingUtilizationEntry({
        printingMetres,
        pcsFused,
        userId: sessionUserId
      });
      onCreated?.(entry);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Make entry</DialogTitle>
          <DialogDescription>Record metres printed and pcs fused for today.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="printing-util-metres">Printing mtrs</Label>
            <Input
              id="printing-util-metres"
              type="number"
              min="0.01"
              step="any"
              value={printingMetres}
              onChange={(e) => setPrintingMetres(e.target.value)}
              placeholder="e.g. 120"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="printing-util-pcs">Number of pcs fused</Label>
            <Input
              id="printing-util-pcs"
              type="number"
              min="1"
              step="1"
              value={pcsFused}
              onChange={(e) => setPcsFused(e.target.value)}
              placeholder="e.g. 48"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">Entries cannot be edited after saving.</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="destructive" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="success" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
