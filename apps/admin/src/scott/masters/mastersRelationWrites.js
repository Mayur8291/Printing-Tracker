// The SECOND request every relation multiselect needs.
//
// Four masters keep part of their shape outside the create/update body (masters spec §6,
// §7, §9, §17):
//
//   parts          PATCH parts/{id}/update_add_ons          {'add_on_ids[0]': …}
//   add_ons        PATCH add_ons/{id}/update_colors         {'color_ids[0]': …}
//                  PATCH add_ons/{id}/update_base_products  {'base_product_ids[0]': …}
//   base_products  PATCH base_products/{id}/update_fabrics | update_parts | update_size_types
//   rmp_brands     PATCH rmp_brands/{id}/update_categories  {'rmp_category_ids[]': […]}
//
// `mastersService` already builds one method per writable relation and `updateRelation`
// owns the body shape — including the rmp_brands quirk where an EMPTY list must still send
// one field (`{'rmp_category_ids[]': ''}`), because Scott 400s a PATCH with no form fields.
// This module only decides WHICH writes to fire and with WHICH ids.
//
// WHEN A WRITE IS SKIPPED
//   An empty list that was already empty is skipped. `indexedIds('fabric_ids', [])` is `{}`,
//   so firing it would PATCH an empty body — the exact 400 the rmp_brands quirk exists to
//   avoid — on every create. Clearing a non-empty list still fires (ids `[]`), which is how
//   "remove them all" reaches the server.
//
// FAILURES ARE NOT FATAL. The record itself is already saved by the time these run; failing
// the whole submit would leave the dialog open over a row that exists, and a second Save
// would create a duplicate. The caller reports them on the error toast instead.

import { relationMultiselectFields } from "@/scott/masters/mastersDialogFields";
import { toIdArray } from "@/scott/ui/ScottMultiSelect";

/**
 * Which relation sub-endpoints this submit has to call, and with what.
 *
 * @param {object} config a master config.
 * @param {object} values raw dialog values (BEFORE `toWriteForm` strips the relation keys).
 * @param {object|null} [record] the record being edited; `null` on create.
 * @returns {Array<{action: string, key: string, label: string, ids: string[]}>}
 */
export function planRelationWrites(config, values, record = null) {
  const plan = [];

  for (const field of relationMultiselectFields(config)) {
    const raw = values?.[field.key];
    if (raw === undefined) continue; // the dialog never rendered it — nothing to say

    const ids = toIdArray(raw);
    const previous = record
      ? toIdArray(field.valueFrom ? field.valueFrom(record) : record?.[field.key])
      : [];

    if (ids.length === 0 && previous.length === 0) continue;

    plan.push({ action: field.action, key: field.key, label: field.label, ids });
  }

  return plan;
}

/**
 * Fire every planned relation write against one record id.
 *
 * They go out in PARALLEL (the upstream base-product dialog fires its three that way) and
 * every rejection is collected rather than thrown.
 *
 * @param {{updateRelation: (action: string, id: string, ids: string[]) => Promise<unknown>}} service
 * @param {string} id the record the writes belong to — resolved AFTER create.
 * @param {Array<{action: string, label: string, ids: string[]}>} plan
 * @returns {Promise<{written: string[], failures: Array<{action: string, label: string, message: string}>}>}
 */
export async function runRelationWrites(service, id, plan) {
  const recordId = String(id ?? "").trim();
  const writes = Array.isArray(plan) ? plan : [];
  if (!recordId || writes.length === 0) return { written: [], failures: [] };

  const settled = await Promise.all(
    writes.map(async (write) => {
      try {
        await service.updateRelation(write.action, recordId, write.ids);
        return { ok: true, write };
      } catch (error) {
        return {
          ok: false,
          write,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  return {
    written: settled.filter((r) => r.ok).map((r) => r.write.action),
    failures: settled
      .filter((r) => !r.ok)
      .map((r) => ({ action: r.write.action, label: r.write.label, message: r.message }))
  };
}

/** One sentence for the error toast when some relation writes did not land. */
export function summarizeRelationFailures(failures) {
  const list = Array.isArray(failures) ? failures : [];
  if (list.length === 0) return "";
  const details = list.map((failure) => `${failure.label}: ${failure.message}`).join("; ");
  return `Saved, but ${list.length === 1 ? "one linked list" : `${list.length} linked lists`} could not be updated — ${details}`;
}
