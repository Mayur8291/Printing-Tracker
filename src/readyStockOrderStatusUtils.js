/** Scott RMP order statuses — must match Order API + webhooks exactly. */
export const SCOTT_ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETE",
  "CANCELLED",
  "FAILED"
];

export const SCOTT_ORDER_STATUS_LABELS = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETE: "Complete (dispatched)",
  CANCELLED: "Cancelled",
  FAILED: "Failed"
};

export const SCOTT_ORDER_STATUS_HINTS = {
  PENDING: "Order received from app — stock held.",
  PROCESSING: "Picklist generated — picking in progress.",
  COMPLETE: "Dispatched — stock deducted; app notified.",
  CANCELLED: "Cancelled — held stock released; app notified.",
  FAILED: "Could not fulfil — stock released; app notified."
};

const TERMINAL = new Set(["COMPLETE", "CANCELLED", "FAILED"]);

/**
 * Status actions warehouse staff can pick after picklist / from the order detail dialog.
 * Values match POST .../orders/:id/status (or cancel).
 */
export function scottOrderStatusActions(currentStatus) {
  if (TERMINAL.has(currentStatus)) return [];

  if (currentStatus === "PENDING") {
    return [
      {
        value: "PROCESSING",
        label: "Start processing",
        hint: "Move to picking (same as first picklist generate)."
      },
      {
        value: "COMPLETE",
        label: "Mark dispatched",
        hint: "Skip picking — deduct stock and notify app.",
        confirm: "Mark this order dispatched? Stock will be deducted permanently."
      },
      {
        value: "FAILED",
        label: "Mark failed",
        hint: "Release held stock and notify app.",
        destructive: true,
        confirm: "Mark this order as failed? Held stock will be released."
      },
      {
        value: "CANCELLED",
        label: "Cancel order",
        hint: "Release held stock and notify app.",
        destructive: true,
        action: "cancel",
        confirm: "Cancel this order? Held stock will be released."
      }
    ];
  }

  if (currentStatus === "PROCESSING") {
    return [
      {
        value: "COMPLETE",
        label: "Mark dispatched",
        hint: "Deduct stock and notify app (after pick/pack).",
        confirm: "Mark this order dispatched? Stock will be deducted permanently."
      },
      {
        value: "FAILED",
        label: "Mark failed",
        hint: "Release held stock and notify app.",
        destructive: true,
        confirm: "Mark this order as failed? Held stock will be released."
      },
      {
        value: "CANCELLED",
        label: "Cancel order",
        hint: "Release held stock and notify app.",
        destructive: true,
        action: "cancel",
        confirm: "Cancel this order? Held stock will be released."
      }
    ];
  }

  return [];
}
