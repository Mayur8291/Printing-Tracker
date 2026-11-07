// Local ephemeral toast stack for every Scott screen.
//
// This repo ships NO toast library and no shadcn `Toaster`. The house pattern lives in
// `src/inventory/InventoryDashboard.jsx` (bottom-right, ~3.2s, z-[100]) and is copied here
// so all Scott panels share one implementation instead of re-declaring the state each time.
//
// Success and error both go through the SAME stack — only the leading glyph differs, which
// matches the house convention of `toast(err?.message || "Could not save…")`.

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Lifetime of a toast, in ms. Matches `InventoryDashboard.jsx`. */
export const SCOTT_TOAST_DURATION_MS = 3200;

function messageOf(input) {
  if (input instanceof Error) return input.message || "Something went wrong.";
  if (input && typeof input === "object" && typeof input.message === "string") return input.message;
  return String(input ?? "").trim();
}

/**
 * Ephemeral toast stack.
 *
 * @param {object} [options]
 * @param {number} [options.duration=3200] ms a toast stays on screen.
 * @returns {{
 *   toasts: Array<{ id: string, msg: string, tone: "success" | "error" }>,
 *   toast: (message: unknown, tone?: "success" | "error") => string | null,
 *   toastError: (message: unknown) => string | null,
 *   dismiss: (id: string) => void,
 *   clear: () => void
 * }}
 *
 * @example
 * const { toasts, toast, toastError, dismiss } = useScottToast();
 * try { await save(row); toast(`Updated ${row.name} · ${row.id}`); }
 * catch (err) { toastError(err); }
 * // …
 * <ScottToasts toasts={toasts} onDismiss={dismiss} />
 */
export function useScottToast(options = {}) {
  const duration = Number.isFinite(options.duration) && options.duration > 0
    ? options.duration
    : SCOTT_TOAST_DURATION_MS;

  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(null);
  if (timersRef.current === null) timersRef.current = new Map();

  // Clear every pending timer when the owning panel unmounts.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((handle) => clearTimeout(handle));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id) => {
    if (!id) return;
    const handle = timersRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, tone = "success") => {
      const msg = messageOf(message);
      if (!msg) return null;
      const id = `scott-toast-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      setToasts((list) => [...list, { id, msg, tone: tone === "error" ? "error" : "success" }]);
      const handle = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((list) => list.filter((t) => t.id !== id));
      }, duration);
      timersRef.current.set(id, handle);
      return id;
    },
    [duration]
  );

  const toastError = useCallback((message) => toast(messageOf(message) || "Something went wrong.", "error"), [toast]);

  const clear = useCallback(() => {
    timersRef.current.forEach((handle) => clearTimeout(handle));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  return { toasts, toast, toastError, dismiss, clear };
}

/**
 * Renderer for the stack returned by {@link useScottToast}. Fixed bottom-right, `z-[100]`.
 *
 * @param {object} props
 * @param {Array<{ id: string, msg: string, tone?: "success" | "error" }>} [props.toasts] stack to render.
 * @param {(id: string) => void} [props.onDismiss] called when the close button is pressed.
 * @param {string} [props.className] extra classes on the fixed container.
 */
export function ScottToasts({ toasts = [], onDismiss, className }) {
  if (!Array.isArray(toasts) || toasts.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-[calc(100vw-2rem)] flex-col gap-2 sm:max-w-sm",
        className
      )}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const isError = t.tone === "error";
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg",
              "animate-in slide-in-from-bottom-2 fade-in duration-300",
              isError && "border-destructive/40"
            )}
          >
            <span
              className={cn(
                "shrink-0 font-medium leading-5",
                isError ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
              )}
              aria-hidden
            >
              {isError ? "!" : "✓"}
            </span>
            <span className="min-w-0 flex-1 break-words">{t.msg}</span>
            {onDismiss ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mr-2 -mt-1 size-6 shrink-0 text-muted-foreground"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default useScottToast;
