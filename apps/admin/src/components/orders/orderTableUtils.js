import { cn } from "@/lib/utils";
import { isDispatchVerificationFailed, productReceiptState } from "@/orderTabUtils";

export function orderListRowClassName(order, { urgency } = {}) {
  const receipt = productReceiptState(order);
  return cn(
    urgency === "overdue" && "bg-destructive/5 hover:bg-destructive/10",
    urgency === "today" && "bg-orange-50 hover:bg-orange-100/80 dark:bg-orange-950/20 dark:hover:bg-orange-950/30",
    urgency === "tomorrow" && "bg-amber-50 hover:bg-amber-100/80 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
    receipt === "extra" &&
      "bg-yellow-100 hover:bg-yellow-200/80 dark:bg-yellow-950/40 dark:hover:bg-yellow-950/55",
    (isDispatchVerificationFailed(order) || receipt === "short" || receipt === "issue") &&
      "bg-destructive/10 hover:bg-destructive/15"
  );
}

export const PRINTING_URGENCY_LABEL = {
  overdue: "Overdue",
  today: "Due today",
  tomorrow: "Due tomorrow",
  upcoming: "",
  none: ""
};

export function printingUrgencyBadgeClass(urgency) {
  return cn(
    "font-medium",
    urgency === "overdue" &&
      "border-transparent bg-destructive/15 text-destructive dark:bg-destructive/25",
    urgency === "today" &&
      "border-transparent bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
    urgency === "tomorrow" &&
      "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
  );
}
