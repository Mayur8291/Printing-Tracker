import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Image preview for View order (mockups, designs, customer assets, payment proof).
 * Must render *inside* the View order DialogContent. A body portal sits outside
 * Radix modal `inert`, so open/close used to flash the page and eat clicks.
 */
export default function ImagePreviewModal({
  images,
  index = 0,
  onClose,
  onPrev,
  onNext,
  alt = "Preview"
}) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  const max = list.length;
  const safeIndex = max ? Math.min(Math.max(Number(index) || 0, 0), max - 1) : 0;

  useEffect(() => {
    if (!max) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (max > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev?.();
      } else if (max > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        onNext?.();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [max, onClose, onNext, onPrev]);

  if (!max) return null;

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col bg-background/95 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="text-sm font-medium text-muted-foreground">
          {max > 1 ? `${safeIndex + 1} / ${max}` : "Preview"}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => onClose?.()}>
          <X />
          Close
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center gap-2">
        {max > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => onPrev?.()}
            aria-label="Previous image"
          >
            <ChevronLeft />
          </Button>
        ) : null}
        <img
          src={list[safeIndex]}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain"
        />
        {max > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => onNext?.()}
            aria-label="Next image"
          >
            <ChevronRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
