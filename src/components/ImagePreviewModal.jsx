import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Full-screen image preview. Portaled to document.body so it stacks above Radix Dialog/Sheet (z-50).
 * Closes only via the toolbar Close button (View order Dialog modal trap blocks outside/Esc dismiss).
 */
export default function ImagePreviewModal({
  images,
  index = 0,
  onClose,
  onPrev,
  onNext,
  alt = "Preview"
}) {
  useEffect(() => {
    if (!images?.length) return undefined;

    function onKeyDown(event) {
      if (images.length > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev?.();
      } else if (images.length > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        onNext?.();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [images?.length, onNext, onPrev]);

  if (!images?.length) return null;

  function handleClosePointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return createPortal(
    <div
      className="image-modal-backdrop image-modal-backdrop--stack-top"
      role="presentation"
    >
      <div className="image-modal" role="dialog" aria-modal="true" aria-label="Image preview">
        <div className="image-modal-toolbar">
          {images.length > 1 ? (
            <span className="image-modal-counter">
              {index + 1} / {images.length}
            </span>
          ) : (
            <span className="image-modal-counter" aria-hidden="true" />
          )}
          <button
            type="button"
            className="image-modal-close"
            onPointerDown={handleClosePointerDown}
            onClick={handleClosePointerDown}
            aria-label="Close preview"
          >
            <X aria-hidden="true" />
            <span className="image-modal-close-label">Close</span>
          </button>
        </div>
        <div className="image-modal-stage">
          {images.length > 1 ? (
            <button
              type="button"
              className="image-modal-nav prev"
              onPointerDown={(e) => {
                e.stopPropagation();
                onPrev?.();
              }}
              aria-label="Previous image"
            >
              {"<"}
            </button>
          ) : null}
          <img src={images[index]} alt={alt} draggable={false} />
          {images.length > 1 ? (
            <button
              type="button"
              className="image-modal-nav next"
              onPointerDown={(e) => {
                e.stopPropagation();
                onNext?.();
              }}
              aria-label="Next image"
            >
              {">"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}