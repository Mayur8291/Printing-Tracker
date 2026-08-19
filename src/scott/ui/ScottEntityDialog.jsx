// Generic create / edit dialog driven by a config's `fields` array.
//
// Validation convention (house rule): NO per-field error messages anywhere in this codebase.
// One form-level <Alert variant="destructive"> as the first child of the <form>, fed by a
// `validate()` that returns the first problem string.

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { proxifyScottImageUrl } from "@/scott/scottImage";
import ScottMultiSelect, { toIdArray } from "@/scott/ui/ScottMultiSelect";

const DEFAULT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const FULL_WIDTH_TYPES = new Set(["textarea", "images", "image", "multiselect"]);

function optionValue(option) {
  if (option == null) return "";
  if (typeof option === "object") return String(option.value ?? option.id ?? option.label ?? "");
  return String(option);
}

function optionLabel(option) {
  if (option == null) return "";
  if (typeof option === "object") return String(option.label ?? option.name ?? option.value ?? option.id ?? "");
  return String(option);
}

/**
 * Cheap identity for a field's option list, for the memo signature below.
 *
 * Deliberately NOT a full serialization: `fieldsKey` is recomputed on every keystroke, and
 * an option list can hold hundreds of rmp_skus. Length plus the first and last value is
 * enough to notice the transitions that matter (empty -> drained, one master's options
 * swapped for another's) without walking the array.
 */
function optionsFingerprint(options) {
  if (!Array.isArray(options) || options.length === 0) return "0";
  const first = options[0];
  const last = options[options.length - 1];
  return `${options.length}:${optionValue(first)}:${optionValue(last)}`;
}

/**
 * The one help line under a control. `note` is what the master configs use for a caveat the
 * user MUST see (sc_sizes: "Display only — never sent to Scott"); only `hint` used to be
 * rendered, so those notes were invisible and the field looked editable when it is not.
 */
function fieldHelpText(field) {
  const hint = String(field?.hint ?? "").trim();
  const note = String(field?.note ?? "").trim();
  if (hint && note) return `${hint} ${note}`;
  return hint || note;
}

function defaultValueFor(field) {
  if (field?.defaultValue !== undefined) return field.defaultValue;
  switch (field?.type) {
    case "boolean":
      return false;
    case "images":
    case "multiselect":
      return [];
    case "image":
      return null;
    case "number":
      return "";
    default:
      return "";
  }
}

/**
 * Seed the form from a record (edit) or the field defaults (create).
 *
 * `field.valueFrom(record)` is the escape hatch a relation multiselect needs: rmp_brands
 * normalizes its categories to `rmp_categories: [{id, name}]` and never carries the
 * `rmp_category_ids` the form field is keyed on, so the config's `relations[].valueFrom`
 * is bridged onto the field (see `mastersDialogFields.resolveMultiselectField`).
 */
function buildInitialForm(fields, record) {
  const form = {};
  for (const field of fields) {
    if (!field?.key) continue;
    const existing = record
      ? typeof field.valueFrom === "function"
        ? field.valueFrom(record)
        : record[field.key]
      : undefined;
    if (existing === undefined || existing === null) {
      form[field.key] = defaultValueFor(field);
      continue;
    }
    if (field.type === "boolean") {
      form[field.key] = existing === true || existing === 1 || String(existing).toLowerCase() === "true";
    } else if (field.type === "multiselect") {
      // Always string ids: a record may carry `[{id, name}]` or `['1','2']`.
      form[field.key] = toIdArray(Array.isArray(existing) ? existing : [existing]);
    } else if (field.type === "images") {
      form[field.key] = Array.isArray(existing) ? [...existing] : [existing];
    } else if (field.type === "image") {
      form[field.key] = existing;
    } else {
      form[field.key] = String(existing);
    }
  }
  return form;
}

/**
 * Bounds check for one `type: "number"` field.
 *
 * The configs declare `min` / `max` (and occasionally `integer`) on number fields, but until
 * this ran they existed ONLY as HTML attributes on `<Input type="number">` — which the browser
 * enforces on stepper clicks and nowhere else. A pasted `-5` into a `min: 0` field, or `150`
 * into a `max: 100` GST percentage, went straight onto the wire. Upstream (ScottOne) enforced
 * the same bounds with zod, so this restores parity for every master at once.
 *
 * Blank is NOT an error here — `required` already owns that question, and an optional numeric
 * field must stay clearable.
 *
 * @param {object} field
 * @param {unknown} value
 * @returns {string|null}
 */
export function validateNumberField(field, value) {
  if ((field?.type ?? "text") !== "number") return null;

  const text = String(value ?? "").trim();
  if (text === "") return null;

  const label = field.label || field.key;
  const num = Number(text);
  if (!Number.isFinite(num)) return `${label} must be a number.`;

  if (field.integer === true && !Number.isInteger(num)) {
    return `${label} must be a whole number.`;
  }

  const min = Number(field.min);
  const hasMin = field.min !== null && field.min !== undefined && field.min !== "" && Number.isFinite(min);
  const max = Number(field.max);
  const hasMax = field.max !== null && field.max !== undefined && field.max !== "" && Number.isFinite(max);

  if (hasMin && hasMax && (num < min || num > max)) {
    return `${label} must be between ${min} and ${max}.`;
  }
  if (hasMin && num < min) return `${label} must be ${min} or more.`;
  if (hasMax && num > max) return `${label} must be ${max} or less.`;
  return null;
}

/**
 * Whole-form validation: `field.required`, the declared numeric bounds
 * (`field.min` / `field.max` / `field.integer`, see `validateNumberField`), per-field
 * `field.validate`, then the ENTITY-level `config.validate(form)` (profit margins'
 * `max_range >= min_range` refine lives there).
 * Exported so the same rules can be exercised without mounting the dialog.
 *
 * @param {Array<object>} fieldList
 * @param {object} form
 * @param {object} [config] entity config; only `validate` is read.
 * @returns {string|null} the FIRST problem, or null.
 */
export function validateEntityForm(fieldList, form, config) {
  for (const field of Array.isArray(fieldList) ? fieldList : []) {
    if (!field?.key) continue;
    const value = form?.[field.key];
    if (field.required) {
      const missing =
        field.type === "images" || field.type === "multiselect"
          ? !Array.isArray(value) || value.length === 0
          : field.type === "image"
            ? !value
            : field.type === "boolean"
              ? value !== true
              : String(value ?? "").trim() === "";
      if (missing) return `${field.label || field.key} is required.`;
    }
    const numberProblem = validateNumberField(field, value);
    if (numberProblem) return numberProblem;
    if (typeof field.validate === "function") {
      const message = field.validate(value, form);
      if (message) return String(message);
    }
  }

  if (typeof config?.validate === "function") {
    const message = config.validate(form);
    if (message) return String(message);
  }

  return null;
}

/**
 * Add picked files to a multi-image value.
 *
 * A SLOT-BACKED field (`field.slots`, i.e. rmp_classes' five `image_N` wire columns) fills
 * the first EMPTY slot instead of appending, so index N stays wire slot N. Appending onto a
 * prefilled array would have been the destructive path: on a class whose slots 1-3 are full,
 * the 4th image has to become `image_4` and must not overwrite `image_1`.
 *
 * Exported (like `validateEntityForm`) so the behaviour is testable without mounting.
 *
 * @param {object} field
 * @param {Array<unknown>} list current value.
 * @param {Array<unknown>} files newly picked files.
 * @returns {Array<unknown>}
 */
export function addImageValues(field, list, files) {
  const current = Array.isArray(list) ? list : [];
  const picked = Array.isArray(files) ? files : [];
  const slots = Array.isArray(field?.slots) && field.slots.length > 0 ? field.slots : null;
  const max = Number.isFinite(field?.maxImages) ? field.maxImages : slots ? slots.length : 12;
  if (!slots) return [...current, ...picked].slice(0, max);

  const next = [...current];
  while (next.length < max) next.push(null);
  for (const file of picked) {
    const free = next.findIndex((item) => !item);
    if (free === -1) break;
    next[free] = file;
  }
  return next.slice(0, max);
}

/**
 * Remove one entry from a multi-image value.
 *
 * A SLOT-BACKED field must leave a HOLE: index N is wire slot N, so compacting the array
 * would silently re-point every image after the removed one at the wrong slot on the next
 * save.
 */
export function removeImageAt(field, list, index) {
  if (Array.isArray(field?.slots) && field.slots.length > 0) {
    return list.map((item, i) => (i === index ? null : item));
  }
  return list.filter((_, i) => i !== index);
}

/** Stable identity for an image value, so previews only rebuild when images actually change. */
function imageToken(value) {
  if (value instanceof File) return `file:${value.name}:${value.size}:${value.lastModified}`;
  return `url:${String(value ?? "")}`;
}

/**
 * Generic Scott create/edit modal.
 *
 * Supported `config.fields[].type`: `text`, `number`, `textarea`, `select` (alias `enum`),
 * `multiselect` (id array — Popover + Checkbox list), `boolean`, `color`, `date`,
 * `image` (single) and `images` (multi).
 *
 * Field shape:
 * `{ key, label, type, required, placeholder, hint, options, min, max, step, rows, accept, disabled, maxImages, colSpan, defaultValue, valueFrom(record), validate(value, form) }`
 *
 * Entity-level validation: `config.validate(form)` runs after every field rule and its
 * message lands in the same single form-level Alert (house rule: no per-field errors).
 *
 * @param {object} props
 * @param {boolean} props.open dialog visibility.
 * @param {object} [props.config] entity config; uses `config.fields`, `config.label`, `config.singularLabel`.
 * @param {Array<object>} [props.fields] explicit field list (overrides `config.fields`).
 * @param {object|null} [props.record=null] record being edited; `null` means create.
 * @param {(values: object, record: object|null) => Promise<void>|void} props.onSubmit rejected promises surface in the Alert.
 * @param {() => void} props.onClose called on cancel, on the X, and after a successful submit.
 * @param {string} [props.title] overrides the derived "Add …" / "Edit …" title.
 * @param {string} [props.description] overrides the derived subtitle.
 * @param {string} [props.submitLabel] overrides the derived submit button text.
 * @param {boolean} [props.readOnly=false] renders every control disabled and hides submit.
 * @param {string} [props.idPrefix="scott-entity"] prefix for generated input ids.
 */
export default function ScottEntityDialog({
  open,
  config,
  fields,
  record = null,
  onSubmit,
  onClose,
  title,
  description,
  submitLabel,
  readOnly = false,
  idPrefix = "scott-entity"
}) {
  // Memoised on a *shape signature* rather than array identity, so a caller passing an inline
  // `fields={[…]}` array cannot make the reset/preview effects below re-fire every render.
  //
  // The signature MUST include the option lists. Relation dropdowns are drained after the
  // dialog is already open (`useMasterRelationOptions`), and only `field.options` changes when
  // they land — a `key:type` signature alone made the memo hand back the stale, empty field
  // list forever, which is why the caller used to remount the whole dialog on every arrival
  // and wiped whatever the user had typed. Fingerprinting the options here is what let that
  // `key={optionsVersion}` remount go away.
  const rawFields = Array.isArray(fields) && fields.length > 0 ? fields : config?.fields;
  const fieldsKey = (Array.isArray(rawFields) ? rawFields : [])
    .map((f) => `${f?.key}:${f?.type || "text"}:${optionsFingerprint(f?.options)}`)
    .join("|");
  const fieldList = useMemo(
    () => (Array.isArray(rawFields) ? rawFields : []).filter((f) => f && f.key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fieldsKey]
  );

  const isEdit = Boolean(record && (record.id ?? record[config?.idField || "id"]));
  const entityLabel = config?.singularLabel || config?.label || "record";

  const [form, setForm] = useState(() => buildInitialForm(fieldList, record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState({});
  const fileInputsRef = useRef({});

  // Reset when the dialog opens, and again if the record is swapped while it stays open.
  const sessionRef = useRef(undefined);
  useEffect(() => {
    if (!open) {
      sessionRef.current = undefined;
      return;
    }
    if (sessionRef.current === record) return;
    sessionRef.current = record;
    setForm(buildInitialForm(fieldList, record));
    setError("");
    setSaving(false);
  }, [open, record, fieldList]);

  const imageFields = useMemo(
    () => fieldList.filter((f) => f.type === "image" || f.type === "images"),
    [fieldList]
  );

  // Signature of just the image values — keeps object URLs from being recreated on every keystroke.
  const imageSignature = imageFields
    .map((f) => {
      const value = form[f.key];
      if (f.type === "images") return `${f.key}=[${(Array.isArray(value) ? value : []).map(imageToken).join("|")}]`;
      return `${f.key}=${imageToken(value)}`;
    })
    .join(";");

  useEffect(() => {
    const created = [];
    const next = {};
    for (const field of imageFields) {
      const value = form[field.key];
      if (field.type === "images") {
        next[field.key] = (Array.isArray(value) ? value : []).map((item) => {
          if (item instanceof File) {
            const url = URL.createObjectURL(item);
            created.push(url);
            return url;
          }
          return proxifyScottImageUrl(item) || "";
        });
      } else if (value instanceof File) {
        const url = URL.createObjectURL(value);
        created.push(url);
        next[field.key] = url;
      } else {
        next[field.key] = proxifyScottImageUrl(value) || "";
      }
    }
    setPreviews(next);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSignature, imageFields]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  function validate() {
    return validateEntityForm(fieldList, form, config);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (saving || readOnly) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Trim every plain-text value so the wire payload never carries stray whitespace.
      const values = { ...form };
      for (const field of fieldList) {
        if (["text", "textarea", "color", "date", "number"].includes(field.type || "text")) {
          if (typeof values[field.key] === "string") values[field.key] = values[field.key].trim();
        }
      }
      await onSubmit?.(values, record);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function pickFiles(field, fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (field.type === "images") {
      set(field.key, addImageValues(field, form[field.key], files));
    } else {
      set(field.key, files[0]);
    }
  }

  function renderField(field) {
    const id = `${idPrefix}-${field.key}`;
    const disabled = saving || readOnly || field.disabled === true;
    const value = form[field.key];

    switch (field.type) {
      case "textarea":
        return (
          <Textarea
            id={id}
            rows={field.rows || 3}
            value={String(value ?? "")}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            required={field.required}
            maxLength={field.maxLength}
          />
        );

      case "number":
        return (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.step ?? "any"}
            value={String(value ?? "")}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            required={field.required}
            className="tabular-nums"
          />
        );

      case "select":
      case "enum": {
        const options = (field.options || []).filter((o) => optionValue(o) !== "");
        return (
          <Select
            value={String(value ?? "")}
            onValueChange={(next) => set(field.key, next)}
            disabled={disabled}
            required={field.required}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={field.placeholder || "Choose…"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={optionValue(option)} value={optionValue(option)}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "multiselect":
        return (
          <ScottMultiSelect
            id={id}
            value={Array.isArray(value) ? value : []}
            options={field.options || []}
            onChange={(next) => set(field.key, next)}
            disabled={disabled}
            placeholder={field.placeholder || "Choose…"}
            emptyMessage={field.emptyMessage || "No options found."}
          />
        );

      case "boolean":
        return (
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor={id}>{field.label || field.key}</Label>
              {fieldHelpText(field) ? (
                <p className="text-xs text-muted-foreground">{fieldHelpText(field)}</p>
              ) : null}
            </div>
            <Switch
              id={id}
              checked={value === true}
              onCheckedChange={(next) => set(field.key, next === true)}
              disabled={disabled}
            />
          </div>
        );

      case "color": {
        const text = String(value ?? "");
        const swatch = /^#?[0-9a-f]{3,8}$/i.test(text) ? (text.startsWith("#") ? text : `#${text}`) : "";
        return (
          <div className="flex items-center gap-2">
            <span
              className="inline-block size-9 shrink-0 rounded-md border shadow-sm"
              style={swatch ? { backgroundColor: swatch } : undefined}
              aria-hidden
            />
            <Input
              id={id}
              value={text}
              onChange={(e) => set(field.key, e.target.value)}
              placeholder={field.placeholder || "#1F2937"}
              disabled={disabled}
              required={field.required}
              className="font-mono uppercase"
            />
          </div>
        );
      }

      case "date":
        return (
          <DatePicker
            id={id}
            value={String(value ?? "")}
            onChange={(next) => set(field.key, next || "")}
            placeholder={field.placeholder || "Pick a date"}
            disabled={disabled}
            required={field.required}
          />
        );

      case "image":
      case "images": {
        const multi = field.type === "images";
        const preview = previews[field.key];
        // Fall back to the direct (proxied) URL so an existing image is visible on the very
        // first render, before the object-URL effect has run.
        const urlFor = (item, cached) =>
          cached || (item instanceof File ? "" : proxifyScottImageUrl(item) || "");

        const items = multi
          ? (Array.isArray(value) ? value : []).map((item, i) => ({
              item,
              url: urlFor(item, Array.isArray(preview) ? preview[i] : ""),
              index: i
            }))
          : value
            ? [{ item: value, url: urlFor(value, typeof preview === "string" ? preview : ""), index: 0 }]
            : [];

        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {items.length === 0 ? (
                <div className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/30 text-muted-foreground">
                  <ImageOff className="size-4" aria-hidden />
                  <span className="text-[10px]">No image</span>
                </div>
              ) : (
                items.map(({ url, index }) => (
                  <div key={`${field.key}-${index}`} className="relative size-20 overflow-hidden rounded-md border bg-muted/30">
                    {url ? (
                      <img src={url} alt={`${field.label || field.key} ${index + 1}`} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-4" aria-hidden />
                      </div>
                    )}
                    {!disabled ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="absolute right-1 top-1 size-6"
                        onClick={() =>
                          multi
                            ? set(
                                field.key,
                                removeImageAt(field, Array.isArray(value) ? value : [], index)
                              )
                            : set(field.key, null)
                        }
                        aria-label="Remove image"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => fileInputsRef.current[field.key]?.click()}
            >
              <Upload className="size-4" />
              {multi ? "Add images" : items.length > 0 ? "Replace image" : "Upload image"}
            </Button>

            {/* Hidden picker — the only way to open a file dialog. Rendered through the
                shadcn `Input` (house rule: no raw form elements in Scott UI); `sr-only` keeps
                it out of the layout exactly as before, and the shadcn wrapper forwards the
                ref that `.click()` is called on. */}
            <Input
              ref={(el) => {
                fileInputsRef.current[field.key] = el;
              }}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              accept={field.accept || DEFAULT_IMAGE_ACCEPT}
              multiple={multi}
              onChange={(e) => {
                pickFiles(field, e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        );
      }

      case "text":
      default:
        return (
          <Input
            id={id}
            type={field.inputType || "text"}
            value={String(value ?? "")}
            onChange={(e) =>
              set(field.key, field.uppercase ? e.target.value.toUpperCase() : e.target.value)
            }
            placeholder={field.placeholder}
            disabled={disabled}
            required={field.required}
            maxLength={field.maxLength}
            className={cn(field.mono && "font-mono")}
          />
        );
    }
  }

  const heading = title || `${isEdit ? "Edit" : "Add"} ${entityLabel}`;
  const subtitle =
    description ||
    (isEdit
      ? `Update this ${entityLabel} on the Scott dashboard.`
      : `Create a new ${entityLabel} on the Scott dashboard.`);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose?.()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {fieldList.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              This entity has no editable fields.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {fieldList.map((field) => {
                const fullWidth = field.colSpan === 2 || FULL_WIDTH_TYPES.has(field.type);
                // The boolean control renders its own label inside the toggle row.
                if (field.type === "boolean") {
                  return (
                    <div key={field.key} className={cn(fullWidth && "sm:col-span-2")}>
                      {renderField(field)}
                    </div>
                  );
                }
                return (
                  <div key={field.key} className={cn("space-y-2", fullWidth && "sm:col-span-2")}>
                    <Label htmlFor={`${idPrefix}-${field.key}`}>
                      {field.label || field.key}
                      {field.required ? <span className="ml-1 text-muted-foreground">*</span> : null}
                    </Label>
                    {renderField(field)}
                    {fieldHelpText(field) ? (
                      <p className="text-xs text-muted-foreground">{fieldHelpText(field)}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onClose?.()} disabled={saving}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly ? (
              <Button type="submit" disabled={saving || fieldList.length === 0}>
                {saving ? "Saving…" : submitLabel || (isEdit ? "Save changes" : `Add ${entityLabel}`)}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
