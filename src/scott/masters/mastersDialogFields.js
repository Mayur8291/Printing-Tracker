// Adapters between a master config's `fields` array and what `ScottEntityDialog` renders.
//
// The dialog (`src/scott/ui/ScottEntityDialog.jsx`) understands
//   text | number | textarea | select/enum | boolean | color | date | image | images
// while the master configs carry three shapes it has never heard of. They are translated
// HERE rather than in the dialog, which is shared with the customers/reports panels:
//
//   switch       -> boolean   identical semantics; the payload builders read a JS boolean
//                             (`boolString(form.order_criteria)`).
//   image-slots  -> images    rmp_classes only. The dialog hands back `File[]`; on submit it
//                             is mapped onto `imageFiles: { image_1: File, … }`, which is what
//                             `toCreatePayload`/`toUpdatePayload` read. An empty slot means
//                             "keep the stored image" (`keepOnEmpty`), so nothing is sent.
//   multiselect  -> multiselect  id arrays, rendered by `ScottMultiSelect` (Popover + Checkbox
//                             list) and filled from the related master's own service.
//
// TWO KINDS OF `multiselect` — the config is the discriminator, and they must not be mixed:
//
//   RELATION field   carries `relation: 'update_fabrics'` matching a writable entry in
//                    `config.relations`. It is NOT part of the create/update body; it is
//                    saved by a SECOND request (`service.updateRelation(action, id, ids)`)
//                    after the record exists — see `mastersRelationWrites.js`. `toWriteForm`
//                    strips these keys so they can never leak into a payload builder.
//   BODY field       no `relation` (fabrics `color_ids`). It feeds `toCreatePayload` /
//                    `toUpdatePayload` directly, where `indexedIds('color_ids', …)` turns it
//                    into `{'color_ids[0]': …}`. `toWriteForm` passes it straight through.
//
// Some writable relations have NO field at all in the config (add_ons `update_colors` /
// `update_base_products`, parts `update_colors`). `relationOnlyFields` synthesizes one per
// relation so those endpoints are reachable too; a relation without an `optionsResource`
// (base_products `update_categories`) stays out, exactly as upstream leaves it.
//
// `select` fields naming an `optionsResource` are filled in from that master's own service —
// see `useMasterRelationOptions.js`. A `select` with neither static options nor a resource we
// can read (`rmp_price_types.zone_id`, sourced from the local Supabase zones master) would be
// an un-answerable empty dropdown, so it degrades to a plain id input.

/** Field types `ScottEntityDialog` can render. */
export const DIALOG_FIELD_TYPES = Object.freeze(
  new Set([
    "text",
    "number",
    "textarea",
    "select",
    "enum",
    "multiselect",
    "boolean",
    "color",
    "date",
    "image",
    "images"
  ])
);

/**
 * Duck-typed `File` check. Never uses `instanceof File`: this module is imported by the
 * SSR smoke tests, where `File` may not exist, and `mastersService` already accepts
 * pre-encoded `{ __base64File: true }` payloads alongside real files.
 * @param {unknown} value
 */
export function isFileLikeValue(value) {
  if (!value || typeof value !== "object") return false;
  if (value.__base64File === true) return true;
  return typeof value.arrayBuffer === "function" && typeof value.name === "string";
}

/**
 * Wire name a freshly picked file must travel under. The configs declare it explicitly
 * (`logo_url` -> `logoFile`, `asset` -> `assetFile`); the RMP family relies on the
 * `<key>File` convention instead (`image` -> `imageFile`).
 * @param {object} field
 * @returns {string}
 */
export function fileKeyFor(field) {
  if (typeof field?.fileKey === "string" && field.fileKey) return field.fileKey;
  return `${field?.key ?? ""}File`;
}

/**
 * Relation masters a config needs option lists for, de-duplicated and in field order.
 *
 * `multiselect` fields are OPT-IN (`includeMultiselect`): they are only ever read by the
 * dialog, and pulling e.g. base_products' fabrics + parts + size types just because a bulk
 * grid opened would drain three masters nobody asked for.
 *
 * @param {object} config
 * @param {{includeMultiselect?: boolean}} [options]
 * @returns {string[]}
 */
export function relationResourcesFor(config, { includeMultiselect = false } = {}) {
  const seen = [];
  const fields = includeMultiselect ? allDialogFields(config) : (config?.fields ?? []);
  for (const field of fields) {
    const type = field?.type || "text";
    const isMulti = type === "multiselect";
    if (type !== "select" && type !== "enum" && !isMulti) continue;
    if (isMulti && !includeMultiselect) continue;
    if (Array.isArray(field.options) && field.options.length > 0) continue;
    const resource = field.optionsResource;
    if (typeof resource === "string" && resource && !seen.includes(resource)) seen.push(resource);
  }
  return seen;
}

/** A `config.relations[]` entry that really writes (not a descriptive FK / inverse entry). */
function isWritableRelation(relation) {
  if (!relation || relation.readOnly === true) return false;
  if (relation.kind === "belongsTo" || relation.kind === "inverse") return false;
  return typeof relation.action === "string" && relation.action.length > 0;
}

/** The `config.relations[]` entry a field's `relation` action names, when it is writable. */
export function writableRelationFor(config, action) {
  if (!action) return null;
  const relation = (config?.relations ?? []).find((rel) => rel?.action === action);
  return isWritableRelation(relation) ? relation : null;
}

/**
 * Pseudo-fields for writable relations the config never gave a form field to.
 *
 * add_ons declares `update_colors` / `update_base_products` and parts declares
 * `update_colors` with no matching entry in `fields`, so without this they stay unreachable
 * from every screen (audit CRIT-1). A relation with no `optionsResource` is skipped —
 * base_products' `update_categories` has none (spec §9: "exported; UI currently uses size
 * types/fabrics/parts"), and a picker with nothing to pick is worse than no picker.
 *
 * Where the entity's read shape does not carry the current list (add_ons never returns its
 * colors), the field says so: whatever is picked REPLACES the stored list.
 */
export function relationOnlyFields(config) {
  const declared = new Set(
    (config?.fields ?? []).filter((f) => f?.relation).map((f) => f.relation)
  );

  const out = [];
  for (const relation of config?.relations ?? []) {
    if (!isWritableRelation(relation) || declared.has(relation.action)) continue;
    const resource = relation.optionsResource;
    if (typeof resource !== "string" || !resource) continue;

    const hasValueFrom = typeof relation.valueFrom === "function";
    out.push({
      key: relation.param || `${relation.action}_ids`,
      label: relation.label || relation.key || relation.action,
      type: "multiselect",
      defaultValue: [],
      relation: relation.action,
      optionsResource: resource,
      hint: hasValueFrom
        ? undefined
        : "Scott does not return the current list here — what you pick replaces it.",
      relationOnly: true
    });
  }
  return out;
}

/** Declared fields + the relation-only pseudo-fields, in that order. */
function allDialogFields(config) {
  return [...(config?.fields ?? []), ...relationOnlyFields(config)];
}

/**
 * Multiselect fields saved through a relation SUB-ENDPOINT rather than the create/update
 * body. Everything else (fabrics `color_ids`) is a body field and must reach the payload
 * builders untouched.
 * @returns {Array<{key: string, action: string, label: string, valueFrom?: (row: object) => string[]}>}
 */
export function relationMultiselectFields(config) {
  const out = [];
  for (const field of allDialogFields(config)) {
    if (!field?.key || (field.type || "text") !== "multiselect") continue;
    const relation = writableRelationFor(config, field.relation);
    if (!relation) continue;
    out.push({
      key: field.key,
      action: relation.action,
      label: field.label || relation.label || field.key,
      valueFrom: typeof relation.valueFrom === "function" ? relation.valueFrom : undefined
    });
  }
  return out;
}

/**
 * Best display label for an arbitrary normalized master row.
 *
 * PLAIN NAME, no `(#12)` suffix. One option list per master is cached and handed to BOTH
 * the dialog dropdowns and the table columns (`decorateMasterColumns`), so the id suffix
 * leaked into every relation cell, into the CSV export, and into the filter engine — where
 * conditions compare the RENDERED text, making `Size equals "Small"` never match
 * `"Small (#12)"`. The id is still the option's `value`, which is what actually gets saved.
 */
export function optionLabelForRow(row, id) {
  const text = row?.name ?? row?.title ?? row?.label ?? row?.sku ?? row?.code ?? "";
  const trimmed = String(text ?? "").trim();
  if (trimmed) return trimmed;
  return id ? `#${id}` : "";
}

function resolveSelectField(field, optionsByResource) {
  if (Array.isArray(field.options) && field.options.length > 0) return field;

  const resource = field.optionsResource;
  if (typeof resource !== "string" || !resource) {
    return {
      ...field,
      type: "text",
      placeholder: field.placeholder || "id",
      hint: field.hint || `${field.label || field.key} is chosen outside Scott — enter the id.`
    };
  }

  const entry = optionsByResource?.[resource];
  const options = Array.isArray(entry?.options) ? entry.options : [];
  // A `noneValue` is a real sentinel the payload builder strips (`__rmp_none__`). A nullable
  // field without one cannot offer "None": the dialog drops options with an empty value.
  const none =
    typeof field.noneValue === "string" && field.noneValue !== ""
      ? [{ value: field.noneValue, label: field.emptyLabel || "None" }]
      : [];

  let placeholder = field.placeholder || "Choose…";
  if (entry?.loading) placeholder = "Loading…";
  else if (entry?.error) placeholder = "Could not load options";
  else if (options.length === 0) placeholder = "No options found";

  return {
    ...field,
    options: [...none, ...options],
    placeholder,
    hint: entry?.error ? `Could not load ${resource}: ${entry.error}` : field.hint
  };
}

/**
 * Multiselect -> dialog field, with the related master's drained options.
 *
 * A relation field also inherits the config relation's `valueFrom`, because the record does
 * not always carry the id array under the field key (rmp_brands normalizes categories to
 * `rmp_categories: [{id, name}]` while the field is keyed `rmp_category_ids`).
 */
function resolveMultiselectField(field, config, optionsByResource) {
  const resource = field.optionsResource;
  const relation = writableRelationFor(config, field.relation);
  const valueFrom =
    typeof field.valueFrom === "function"
      ? field.valueFrom
      : typeof relation?.valueFrom === "function"
        ? relation.valueFrom
        : undefined;

  if (Array.isArray(field.options) && field.options.length > 0) {
    return { ...field, type: "multiselect", valueFrom };
  }

  // No option source at all: a checkbox list with nothing in it can only mislead.
  if (typeof resource !== "string" || !resource) return null;

  const entry = optionsByResource?.[resource];
  const options = Array.isArray(entry?.options) ? entry.options : [];

  let placeholder = field.placeholder || "Choose…";
  if (entry?.loading) placeholder = "Loading…";
  else if (entry?.error) placeholder = "Could not load options";
  else if (options.length === 0) placeholder = "No options found";

  return {
    ...field,
    type: "multiselect",
    options,
    valueFrom,
    placeholder,
    hint: entry?.error ? `Could not load ${resource}: ${entry.error}` : field.hint
  };
}

/**
 * Config fields -> dialog fields.
 *
 * @param {object} config a master config from `masterConfigs.js`.
 * @param {Record<string, {options?: Array<{value:string,label:string}>, loading?: boolean, error?: string}>} [optionsByResource]
 * @returns {Array<object>} fields safe to hand to `ScottEntityDialog`.
 */
export function dialogFieldsFor(config, optionsByResource = {}) {
  const out = [];
  for (const field of allDialogFields(config)) {
    if (!field?.key) continue;
    const type = field.type || "text";

    if (type === "image-list") continue;

    if (type === "multiselect") {
      const resolved = resolveMultiselectField(field, config, optionsByResource);
      if (resolved) out.push(resolved);
      continue;
    }

    if (type === "switch") {
      out.push({ ...field, type: "boolean" });
      continue;
    }

    if (type === "image-slots") {
      const slots = field.slots ?? field.imageSlots ?? [];
      const max = slots.length || 5;
      out.push({
        ...field,
        type: "images",
        maxImages: max,
        hint:
          field.hint ||
          `${max} numbered slots. A new image fills the first empty slot; slots you leave alone keep whatever is already stored.`
      });
      continue;
    }

    if (type === "select" || type === "enum") {
      out.push(resolveSelectField(field, optionsByResource));
      continue;
    }

    out.push(DIALOG_FIELD_TYPES.has(type) ? field : { ...field, type: "text" });
  }
  return out;
}

/**
 * Dialog values -> the form shape the config's payload builders expect.
 *
 * `toCreatePayload` / `toUpdatePayload` are ASYNC and are awaited by `mastersService`; this
 * function is the synchronous step *before* them — it only re-homes picked files, because the
 * builders read a fresh `File` and an existing URL from two different keys:
 *
 *   form.logo_url  — the URL already stored on the record (re-uploaded as-is)
 *   form.logoFile  — a File the user just picked (wins over the URL)
 *
 * The dialog puts the File on the field's own key, so it is moved to the file key and the
 * field key is restored to the record's stored URL.
 *
 * It ALSO strips the relation multiselects: those travel to their own sub-endpoint after the
 * save (`mastersRelationWrites.js`) and must never reach a payload builder. Body multiselects
 * (fabrics `color_ids`) are left in place — `indexedIds` is waiting for them.
 *
 * @param {object} config
 * @param {object} values raw values from `ScottEntityDialog`.
 * @param {object|null} [record] the record being edited, `null` on create.
 * @returns {object} form ready for `service.create` / `service.update`.
 */
export function toWriteForm(config, values, record = null) {
  const form = { ...(values ?? {}) };

  for (const relationField of relationMultiselectFields(config)) {
    delete form[relationField.key];
  }

  for (const field of config?.fields ?? []) {
    if (!field?.key) continue;
    const type = field.type || "text";

    if (type === "image") {
      const picked = form[field.key];
      if (isFileLikeValue(picked)) {
        form[fileKeyFor(field)] = picked;
        const stored = record?.[field.key];
        form[field.key] = typeof stored === "string" ? stored : "";
      }
      continue;
    }

    if (type === "image-slots") {
      // `File[]` back onto `{ image_1: File, image_2: File, … }` BY SLOT INDEX.
      //
      // Only freshly picked files are emitted. Every other entry in the array is a stored
      // URL (or a `null` hole) put there by the field's `valueFrom` prefill — it is left
      // alone so the slot it occupies is simply omitted from the PATCH, which is what
      // "keep the stored image" means upstream. That is the whole fix for the destructive
      // path: because the array is prefilled and never compacted, adding a 4th image to a
      // class writes `image_4` and cannot touch `image_1..3`.
      const slots = field.slots ?? field.imageSlots ?? [];
      const picked = Array.isArray(form[field.key]) ? form[field.key] : [];
      const files = {};
      slots.forEach((slot, index) => {
        const item = picked[index];
        if (slot && isFileLikeValue(item)) files[slot] = item;
      });
      form[field.key] = Object.keys(files).length > 0 ? files : undefined;
      continue;
    }

    if (type === "number") {
      // A cleared number input leaves the EMPTY STRING behind, and the payload builders'
      // `String(form.x ?? 0)` does not catch it (`?? 0` only fires on null/undefined), so
      // `position=""` / `gsm=""` went out on the wire. Upstream coerces (`parseInt(…)||0`);
      // coerce here, once, for every number field of every master. `undefined` is left as
      // it is — a PATCH builder reads its absence as "field not touched".
      const raw = form[field.key];
      if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
        form[field.key] = field.defaultValue !== undefined ? field.defaultValue : 0;
      }
      continue;
    }

    if (type === "images") {
      const picked = Array.isArray(form[field.key]) ? form[field.key] : [];
      const files = picked.filter(isFileLikeValue);
      if (files.length > 0) form[fileKeyFor(field)] = files;
      form[field.key] = picked.filter((item) => !isFileLikeValue(item));
    }
  }

  return form;
}
