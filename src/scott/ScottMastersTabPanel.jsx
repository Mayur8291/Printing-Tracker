// Scott API → Masters.
//
// Shell only: a left rail over the 22 masters (grouped by `MASTER_NAV`) and, for whichever
// one is selected, `ScottMasterListScreen` — which owns that master's list, dialog, CRUD and
// its three bulk affordances (bulk edit grid, CSV import, bulk delete).
// The selection is remembered in localStorage so a reload lands back on the same master.
//
// Switching master unmounts everything the screen has open, so the swap is guarded when a
// bulk-edit grid is holding unsaved rows (`mastersBulkGuard.js`).
//
// Layout is the `InventoryDashboard` shell: bordered card, rail on the left, content scrolling
// inside its own column. Below `md` the rail is replaced by the grouped Select in the header.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/inventory/inventoryUiUtils";
import { MASTER_CONFIG_LIST, getMasterConfig } from "@/scott/data/masterConfigs";
// Both named, in one statement: `scripts/check-ui-gate.mjs` only reads the first binding of a
// mixed `default, { … }` import and would report the other one as a missing import.
import { ScottMastersNav, ScottMastersNavSelect } from "@/scott/masters/ScottMastersNav";
import ScottMasterListScreen from "@/scott/masters/ScottMasterListScreen";
import { confirmDiscardBulkEdits } from "@/scott/masters/mastersBulkGuard";
import ScottEnvBadge from "@/scott/ui/ScottEnvBadge";
import { ScottToasts, useScottToast } from "@/scott/ui/useScottToast";

/** Namespaced like `SCOTT_API_TARGET_STORAGE_KEY` in `scottRuntime.js`. */
export const SCOTT_MASTERS_ACTIVE_STORAGE_KEY = "scottone:scott-masters-active";

const FIRST_MASTER_KEY = MASTER_CONFIG_LIST[0]?.key ?? "";

/** Last master the user was on — ignored when the key no longer exists in the registry. */
function readStoredMasterKey() {
  if (typeof window === "undefined") return FIRST_MASTER_KEY;
  try {
    const stored = window.localStorage.getItem(SCOTT_MASTERS_ACTIVE_STORAGE_KEY);
    if (stored && getMasterConfig(stored)) return stored;
  } catch {
    /* Safari private mode / storage disabled — fall back to the first master. */
  }
  return FIRST_MASTER_KEY;
}

function writeStoredMasterKey(key) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(SCOTT_MASTERS_ACTIVE_STORAGE_KEY, key);
  } catch {
    /* non-fatal: the panel just forgets the selection next time */
  }
}

/**
 * @param {object} props
 * @param {boolean} [props.isAdmin=false]
 * @param {boolean} [props.canEdit=false]
 * @param {string} [props.sessionUserId] passed by `App.jsx`; the Scott API authenticates
 *   through the edge function, so nothing here needs it yet.
 */
export default function ScottMastersTabPanel({ isAdmin = false, canEdit = false, sessionUserId }) {
  const mayEdit = isAdmin || canEdit;

  const [activeKey, setActiveKey] = useState(readStoredMasterKey);
  const { toasts, toast, toastError, dismiss } = useScottToast();

  useEffect(() => {
    writeStoredMasterKey(activeKey);
  }, [activeKey]);

  const handleSelect = useCallback((key) => {
    if (!key || !getMasterConfig(key)) return;
    // The screen is keyed on the master, so a swap unmounts whatever is open — including a
    // bulk-edit grid with unsaved rows. `confirmDiscardBulkEdits` is a no-op unless one is
    // mounted AND dirty (see `mastersBulkGuard.js`).
    if (!confirmDiscardBulkEdits()) return;
    setActiveKey(key);
  }, []);

  // Registry keys are stable, but a stored key can outlive its config — never render blank.
  const config = getMasterConfig(activeKey) ?? MASTER_CONFIG_LIST[0] ?? null;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-6">
        <PageHeader
          title="Masters"
          subtitle="Scott API — catalogue masters and ready-made product data."
          actions={
            <>
              <ScottMastersNavSelect
                activeKey={config?.key ?? ""}
                onSelect={handleSelect}
                className="md:hidden"
              />
              <ScottEnvBadge showBaseUrl />
            </>
          }
        />

        {config ? (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card shadow-sm">
            <ScottMastersNav
              activeKey={config.key}
              onSelect={handleSelect}
              className="hidden md:flex"
            />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
              {/* Keyed on the master so a swap starts from a clean list, selection and dialog. */}
              <ScottMasterListScreen
                key={config.key}
                config={config}
                mayEdit={mayEdit}
                onToast={toast}
                onError={toastError}
              />
            </div>
          </div>
        ) : (
          <Card className="border-destructive/30">
            <CardContent className="p-6">
              <p className="text-sm text-destructive">
                No Scott masters are registered. Check `src/scott/data/masterConfigs.js`.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <ScottToasts toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}
