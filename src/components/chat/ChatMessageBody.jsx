import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  orderChatToken,
  profileChatLabel,
  splitChatBodyTokens
} from "@/teamChatUtils";

export function ChatMessageBody({ body, profiles, orders, onOpenOrder, inverted = false }) {
  if (!(body ?? "").trim()) return null;

  const profileByLabel = useMemo(() => {
    const map = new Map();
    for (const p of profiles ?? []) {
      const label = profileChatLabel(p);
      if (label) map.set(`@${label}`, p);
    }
    return map;
  }, [profiles]);

  const orderByToken = useMemo(() => {
    const map = new Map();
    for (const o of orders ?? []) {
      const token = orderChatToken(o);
      if (token) map.set(`#${token}`, o);
    }
    return map;
  }, [orders]);

  const parts = splitChatBodyTokens(body);
  const tokenClass = inverted
    ? "bg-primary-foreground/15 text-primary-foreground"
    : "bg-background/80 text-foreground";

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.kind === "text") {
          return <span key={i}>{part.value}</span>;
        }
        const user = profileByLabel.get(part.value);
        if (user) {
          return (
            <Badge key={i} variant="secondary" className={cn("mx-0.5 align-baseline text-xs", tokenClass)}>
              {part.value}
            </Badge>
          );
        }
        const order = orderByToken.get(part.value);
        if (order && onOpenOrder) {
          return (
            <Button
              key={i}
              type="button"
              variant="link"
              className={cn(
                "h-auto px-1 py-0 text-xs font-semibold underline-offset-2",
                inverted ? "text-primary-foreground" : "text-primary"
              )}
              onClick={() => onOpenOrder(order)}
            >
              {part.value}
            </Button>
          );
        }
        if (part.value.startsWith("#")) {
          return (
            <Badge key={i} variant="outline" className="mx-0.5 align-baseline text-xs">
              {part.value}
            </Badge>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}
