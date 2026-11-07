// "Does the open bulk-edit grid have unsaved changes?" — asked from OUTSIDE the grid.
//
// `ScottBulkEditGrid` owns its row state and exposes no dirty flag; it only registers a
// `beforeunload` listener while `computeGridStats(rows).hasChanges` is true, and that
// listener calls `preventDefault()`. So the page itself already carries the answer: dispatch
// a SYNTHETIC, cancelable `beforeunload` and read `defaultPrevented`.
//
//   * Dispatching the event by hand never opens the browser's own "Leave site?" dialog —
//     that is bound to a real navigation/unload, not to the event type.
//   * The grid's handler does nothing but `preventDefault()` + `returnValue = ''`, so the
//     probe has no side effects.
//   * `ScottBulkEditGrid` is the only `beforeunload` listener in this app. A future one that
//     cancels for its own reasons would produce a spurious confirm — the safe direction.
//   * When the grid is closed (or clean) no listener is registered, nothing cancels the
//     probe, and navigation is silent.
//
// This keeps the guard working WITHOUT touching the read-only bulk layer, and keeps the
// grid's own `beforeunload` (real tab close / reload) exactly as shipped.

/** House copy for every "you are about to lose bulk edits" prompt. */
export const BULK_DISCARD_MESSAGE = "Discard unsaved bulk edits?\n\nChanges that were not saved will be lost.";

/**
 * True when a mounted bulk-edit grid reports unsaved changes.
 * @returns {boolean}
 */
export function hasUnsavedBulkEdits() {
  if (typeof window === "undefined" || typeof Event !== "function") return false;
  try {
    const probe = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(probe);
    return probe.defaultPrevented === true;
  } catch {
    // A browser that cannot construct the event cannot have a dirty grid either.
    return false;
  }
}

/**
 * Confirm before an action that would throw unsaved bulk edits away. Returns `true` when
 * the caller may proceed — including when nothing is dirty, so call sites stay one-liners.
 *
 * @param {string} [message]
 * @returns {boolean}
 */
export function confirmDiscardBulkEdits(message = BULK_DISCARD_MESSAGE) {
  if (!hasUnsavedBulkEdits()) return true;
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(message);
}

export default confirmDiscardBulkEdits;
