import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const CHAT_INCOMING_TOAST_MS = 45_000;

export function ChatIncomingToastStack({ toasts, onDismiss }) {
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => onDismiss(toast.id), CHAT_INCOMING_TOAST_MS)
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[12001] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      role="region"
      aria-label="Chat notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <Card key={toast.id} className="pointer-events-auto relative pr-10 shadow-lg">
          <CardHeader className="flex flex-col gap-1.5 p-4">
            <CardTitle className="text-sm">{toast.name}</CardTitle>
            <CardDescription className="line-clamp-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {toast.body}
            </CardDescription>
          </CardHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1.5 size-8"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <X />
          </Button>
        </Card>
      ))}
    </div>
  );
}
