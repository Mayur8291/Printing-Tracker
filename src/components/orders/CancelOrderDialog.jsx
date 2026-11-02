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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export default function CancelOrderDialog({ order, open, saving, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError("");
  }, [open, order?.id]);

  function submit() {
    const text = reason.trim();
    if (!text) {
      setError("Write the reason for cancellation.");
      return;
    }
    onConfirm(text);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel order</DialogTitle>
          <DialogDescription>
            {order?.customer_name?.trim() || "This order"}
            {order?.order_id?.trim() ? ` · ${order.order_id}` : ""} moves to Cancelled orders.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="cancel-order-reason">Reason for cancellation</FieldLabel>
          <Textarea
            id="cancel-order-reason"
            rows={4}
            value={reason}
            aria-invalid={error ? true : undefined}
            placeholder="Why is this order cancelled?"
            disabled={saving}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError("");
            }}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={saving}>
            {saving ? "Cancelling…" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
