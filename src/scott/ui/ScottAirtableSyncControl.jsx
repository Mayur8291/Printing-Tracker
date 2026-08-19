// Scott dashboard settings — the ONLY setting the API exposes: Airtable sync on/off.
//
// Upstream ships this on its own Settings page; this port has none, so it lives as a small
// affordance in the masters list header (masters spec §23).
//
// TWO THINGS MAKE THIS DANGEROUS, and both are handled here rather than papered over:
//
//   1. THE FLAG IS ACCOUNT-WIDE. Flipping it off stops Airtable sync for every Scott user,
//      not just this browser. So the switch is NOT the write. Moving it only stages an
//      intent; nothing leaves the browser until "Save to Scott" is pressed AND the inline
//      confirmation is accepted. This is upstream's own shape (ScottOne `Settings.tsx`
//      separates the toggle from an explicit save button).
//   2. SCOTT HAS NO GET FOR IT. `PATCH settings/airtable_sync` exists and nothing reads it
//      back, so the stored value is genuinely unknown to this UI. The control therefore
//      starts in an explicit UNKNOWN state — never a confident "off", which would invite a
//      user to "turn it on" when it was already on, or read a mis-click as the truth.
//
// A failed save drops back to the staged value with the error on the toast stack, so the
// control never claims a write that did not land.

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { setScottAirtableSyncEnabled } from "@/scott/scottSettingsService";

/** The switch has three positions, not two: the server's value is unreadable. */
export const AIRTABLE_SYNC_UNKNOWN = "unknown";

/**
 * What the control should do for a given staged state — pure, so the "no write on toggle
 * alone" rule is testable without mounting anything.
 *
 * @param {"unknown"|boolean} staged what the switch is showing.
 * @param {boolean} confirming whether the confirmation step is open.
 * @returns {{canSave: boolean, willWrite: boolean}}
 */
export function airtableSyncSaveState(staged, confirming) {
  const canSave = staged === true || staged === false;
  return { canSave, willWrite: canSave && confirming === true };
}

/**
 * @param {object} props
 * @param {boolean} [props.mayEdit=false] hides the control entirely when false.
 * @param {(message: string) => void} [props.onToast]
 * @param {(message: string) => void} [props.onError]
 * @param {string} [props.idPrefix="scott-settings"]
 */
export default function ScottAirtableSyncControl({
  mayEdit = false,
  onToast,
  onError,
  idPrefix = "scott-settings"
}) {
  /** `"unknown"` until this browser has successfully written a value. */
  const [saved, setSaved] = useState(AIRTABLE_SYNC_UNKNOWN);
  /** What the switch is showing right now — staged, NOT sent. */
  const [staged, setStaged] = useState(AIRTABLE_SYNC_UNKNOWN);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!mayEdit) return null;

  const isUnknown = staged === AIRTABLE_SYNC_UNKNOWN;
  const dirty = staged !== saved;
  const { canSave } = airtableSyncSaveState(staged, confirming);

  /** Toggling stages a value and arms the Save button. It never touches the network. */
  function stage(next) {
    setStaged(next === true);
    setConfirming(false);
  }

  function cancel() {
    setStaged(saved);
    setConfirming(false);
  }

  async function save() {
    if (!canSave) return;
    const wanted = staged === true;
    setSaving(true);
    try {
      await setScottAirtableSyncEnabled(wanted);
      setSaved(wanted);
      setConfirming(false);
      onToast?.(`Airtable sync ${wanted ? "enabled" : "disabled"} on the Scott dashboard.`);
    } catch (error) {
      setConfirming(false);
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Scott settings">
          <Settings2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Scott dashboard settings</p>
            <p className="text-xs text-muted-foreground">Applies to the whole Scott account.</p>
          </div>

          <div className="space-y-2 rounded-lg border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${idPrefix}-airtable-sync`}>Airtable sync</Label>
                  <Badge variant={isUnknown ? "outline" : "secondary"} className="text-[10px]">
                    {isUnknown ? "Unknown" : staged ? "On" : "Off"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isUnknown
                    ? "Scott exposes no read endpoint for this flag, so its stored value is unknown here. Choose a position and save to set it."
                    : "Staged only — nothing is sent until you save."}
                </p>
              </div>
              <Switch
                id={`${idPrefix}-airtable-sync`}
                checked={staged === true}
                aria-checked={isUnknown ? "mixed" : staged === true}
                data-state-unknown={isUnknown ? "true" : undefined}
                onCheckedChange={stage}
                disabled={saving}
                className={isUnknown ? "opacity-60" : undefined}
              />
            </div>

            {confirming ? (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <p className="text-xs">
                  This turns Airtable sync <strong>{staged ? "on" : "off"}</strong> for every user
                  on the Scott account. Continue?
                </p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Yes, save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                {dirty ? (
                  <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
                    Reset
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setConfirming(true)}
                  disabled={!canSave || !dirty || saving}
                >
                  Save to Scott
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
