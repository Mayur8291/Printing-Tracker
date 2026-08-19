// Scott dashboard settings.
//
// Upstream: PATCH {base}/api/dashboard/v1/settings/airtable_sync (multipart form).
// The client sends method "POST" by convention — the edge function forces PATCH and
// requires `settingsAction: "airtable_sync"`, so both must be present or it throws.

import { callScottDashboard } from "./scottClient";

/**
 * Turn Scott's Airtable sync on or off.
 *
 * The flag is sent as the *string* "true"/"false": every upstream write is multipart
 * form-encoded, and Rails only sees strings on the wire.
 *
 * @param {boolean} enabled
 * @returns {Promise<unknown>} the upstream response body
 */
export async function setScottAirtableSyncEnabled(enabled) {
  const { body } = await callScottDashboard({
    resource: "settings",
    method: "POST",
    settingsAction: "airtable_sync",
    body: { enabled: enabled ? "true" : "false" }
  });
  return body;
}
