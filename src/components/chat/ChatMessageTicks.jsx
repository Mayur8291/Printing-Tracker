import { Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const LABEL = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Seen"
};

export function ChatMessageTicks({ status, inverted = false }) {
  if (status !== "sent" && status !== "delivered" && status !== "read") return null;

  const grey = inverted ? "text-primary-foreground/65" : "text-muted-foreground";
  const seen = inverted ? "text-sky-300" : "text-sky-600";
  const tone = status === "read" ? seen : grey;
  const Icon = status === "sent" ? Check : CheckCheck;

  return (
    <span className={cn("inline-flex shrink-0", tone)} title={LABEL[status]}>
      <Icon className="size-3.5" aria-label={LABEL[status]} />
    </span>
  );
}
