import { supabase } from "./supabaseClient";

/**
 * Step 0 masters (One Source of Truth roadmap) — data helpers for
 * crm_party, cat_sku, core_entity/core_gstin, core_location, cat_brand,
 * plus CSV parsing and the dedupe preview used by the import dialog.
 * Writes are admin-only via RLS; this module never touches Scott API tables.
 */

export const PARTY_KINDS = ["customer", "vendor", "job_worker", "transporter", "principal"];

export const PARTY_KIND_LABEL = {
  customer: "Customer",
  vendor: "Vendor",
  job_worker: "Job worker",
  transporter: "Transporter",
  principal: "Principal"
};

export const MSME_CATEGORIES = ["micro", "small", "medium"];

export const ITEM_KINDS = ["finished_good", "raw_material", "packaging", "consumable"];

export const ITEM_KIND_LABEL = {
  finished_good: "Finished good",
  raw_material: "Raw material",
  packaging: "Packaging",
  consumable: "Consumable"
};

export const LOCATION_KINDS = ["warehouse", "zone", "bin", "virtual"];

export const VIRTUAL_KINDS = [
  "qc_hold",
  "damaged",
  "in_transit",
  "job_worker",
  "amazon_fc",
  "distributor",
  "uniware_facility"
];

export const OWNER_SYSTEMS = ["platform", "uniware", "external"];

/** Same normalization as the DB unique indexes: lowercase, collapsed whitespace. */
export function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

const PARTY_SELECT =
  "id, kind, legal_name, trade_name, segment, credit_days, credit_limit, pan, msme_udyam_number, msme_category, payment_terms, lead_time_days, default_qc_required, notes, is_active, merged_into_id, parent_id, created_at";

export async function fetchParties() {
  const { data, error } = await supabase
    .from("crm_party")
    .select(PARTY_SELECT)
    .is("merged_into_id", null)
    .order("legal_name", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

const SKU_SELECT =
  "id, sku_code, colour_id, barcode, size_label, size_order, hsn, item_kind, is_kit, uom, weight_grams, standard_cost, mrp, is_active, created_at";

export async function fetchSkus() {
  const { data, error } = await supabase
    .from("cat_sku")
    .select(SKU_SELECT)
    .order("sku_code", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchEntities() {
  const { data, error } = await supabase
    .from("core_entity")
    .select("id, code, legal_name, trade_name, pan, is_active, core_gstin ( id, gstin, state_code, is_active )")
    .order("code", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchLocations() {
  const { data, error } = await supabase
    .from("core_location")
    .select("id, code, name, kind, virtual_kind, owner_system, parent_id, party_id, is_active")
    .order("code", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchBrands() {
  const { data, error } = await supabase
    .from("cat_brand")
    .select("id, name, is_active")
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Mutations (RLS: admin only)
// ---------------------------------------------------------------------------

export async function saveParty(patch, partyId) {
  const payload = {
    kind: patch.kind,
    legal_name: String(patch.legal_name ?? "").trim(),
    trade_name: String(patch.trade_name ?? "").trim() || null,
    segment: String(patch.segment ?? "").trim() || null,
    credit_days: Number(patch.credit_days) >= 0 ? Number(patch.credit_days) : 0,
    pan: String(patch.pan ?? "").trim() || null,
    msme_udyam_number: String(patch.msme_udyam_number ?? "").trim() || null,
    msme_category: MSME_CATEGORIES.includes(patch.msme_category) ? patch.msme_category : null,
    payment_terms: String(patch.payment_terms ?? "").trim() || null,
    notes: String(patch.notes ?? "").trim() || null,
    is_active: patch.is_active !== false
  };
  if (!payload.legal_name) throw new Error("Legal name is required.");
  if (!PARTY_KINDS.includes(payload.kind)) throw new Error("Pick a party kind.");

  const query = partyId
    ? supabase.from("crm_party").update(payload).eq("id", partyId)
    : supabase.from("crm_party").insert(payload);
  const { data, error } = await query.select(PARTY_SELECT).single();
  if (error) throw error;
  return data;
}

export async function saveSku(patch, skuId) {
  const payload = {
    sku_code: String(patch.sku_code ?? "").trim(),
    barcode: String(patch.barcode ?? "").trim() || null,
    size_label: String(patch.size_label ?? "").trim() || null,
    hsn: String(patch.hsn ?? "").trim() || null,
    item_kind: ITEM_KINDS.includes(patch.item_kind) ? patch.item_kind : "finished_good",
    uom: String(patch.uom ?? "").trim() || "pcs",
    weight_grams: patch.weight_grams === "" || patch.weight_grams == null ? null : Number(patch.weight_grams),
    mrp: patch.mrp === "" || patch.mrp == null ? null : Number(patch.mrp),
    is_active: patch.is_active !== false
  };
  if (!payload.sku_code) throw new Error("SKU code is required.");

  const query = skuId
    ? supabase.from("cat_sku").update(payload).eq("id", skuId)
    : supabase.from("cat_sku").insert(payload);
  const { data, error } = await query.select(SKU_SELECT).single();
  if (error) throw error;
  return data;
}

export async function saveEntity(patch) {
  const payload = {
    code: String(patch.code ?? "").trim(),
    legal_name: String(patch.legal_name ?? "").trim(),
    trade_name: String(patch.trade_name ?? "").trim() || null,
    pan: String(patch.pan ?? "").trim() || null
  };
  if (!payload.code) throw new Error("Entity code is required.");
  if (!payload.legal_name) throw new Error("Legal name is required.");
  const { data, error } = await supabase.from("core_entity").insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function addGstin({ entityId, gstin }) {
  const value = String(gstin ?? "").trim().toUpperCase();
  if (value.length !== 15) throw new Error("GSTIN must be exactly 15 characters.");
  const { data, error } = await supabase
    .from("core_gstin")
    .insert({ entity_id: entityId, gstin: value })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveLocation(patch) {
  const isVirtual = patch.kind === "virtual";
  const payload = {
    code: String(patch.code ?? "").trim(),
    name: String(patch.name ?? "").trim(),
    kind: LOCATION_KINDS.includes(patch.kind) ? patch.kind : "warehouse",
    virtual_kind: isVirtual && VIRTUAL_KINDS.includes(patch.virtual_kind) ? patch.virtual_kind : null,
    owner_system: OWNER_SYSTEMS.includes(patch.owner_system) ? patch.owner_system : "platform",
    parent_id: patch.parent_id || null
  };
  if (!payload.code) throw new Error("Location code is required.");
  if (!payload.name) throw new Error("Location name is required.");
  if (isVirtual && !payload.virtual_kind) throw new Error("Pick a virtual kind.");
  const { data, error } = await supabase.from("core_location").insert(payload).select().single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// CSV parsing (standalone — quoted fields, CRLF, no dependency on Scott code)
// ---------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text ?? "");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/** First row is the header; returns array of objects keyed by lowercased header. */
export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { headers: rows[0] ?? [], objects: [] };
  const headers = rows[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
  const objects = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, objects };
}

export const PARTY_CSV_HEADERS = [
  "kind",
  "legal_name",
  "trade_name",
  "segment",
  "credit_days",
  "pan",
  "msme_udyam_number",
  "msme_category",
  "payment_terms",
  "notes"
];

export const SKU_CSV_HEADERS = [
  "sku_code",
  "barcode",
  "size_label",
  "hsn",
  "item_kind",
  "uom",
  "weight_grams",
  "mrp"
];

export function downloadCsvTemplate(kind) {
  const headers = kind === "party" ? PARTY_CSV_HEADERS : SKU_CSV_HEADERS;
  const sample =
    kind === "party"
      ? ["customer", "Acme Traders Pvt Ltd", "Acme", "Retail", "30", "", "", "", "30 days", ""]
      : ["SCT-TEE-BLK-M", "", "M", "6109", "finished_good", "pcs", "180", "499"];
  const csv = `${headers.join(",")}\n${sample.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = kind === "party" ? "parties-template.csv" : "skus-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Dedupe preview — law 1: no duplicate masters. Each CSV row is classified as
// ready | duplicate_existing | duplicate_in_file | invalid before import.
// ---------------------------------------------------------------------------

export function buildPartyImportPreview(objects, existingParties) {
  const existingKeys = new Set(
    (existingParties ?? []).map((p) => `${p.kind}::${normalizeName(p.legal_name)}`)
  );
  const seenInFile = new Set();

  return (objects ?? []).map((obj, index) => {
    const kind = PARTY_KINDS.includes(String(obj.kind ?? "").toLowerCase())
      ? String(obj.kind).toLowerCase()
      : "customer";
    const legalName = String(obj.legal_name ?? "").trim();
    const key = `${kind}::${normalizeName(legalName)}`;

    let status = "ready";
    let reason = "";
    if (!legalName) {
      status = "invalid";
      reason = "legal_name missing";
    } else if (obj.credit_days && Number.isNaN(Number(obj.credit_days))) {
      status = "invalid";
      reason = "credit_days is not a number";
    } else if (existingKeys.has(key)) {
      status = "duplicate_existing";
      reason = "same kind + name already in masters";
    } else if (seenInFile.has(key)) {
      status = "duplicate_in_file";
      reason = "repeated inside this file";
    }
    if (status === "ready") seenInFile.add(key);

    return {
      rowNumber: index + 2,
      status,
      reason,
      payload: {
        kind,
        legal_name: legalName,
        trade_name: String(obj.trade_name ?? "").trim() || null,
        segment: String(obj.segment ?? "").trim() || null,
        credit_days: obj.credit_days ? Number(obj.credit_days) : 0,
        pan: String(obj.pan ?? "").trim() || null,
        msme_udyam_number: String(obj.msme_udyam_number ?? "").trim() || null,
        msme_category: MSME_CATEGORIES.includes(String(obj.msme_category ?? "").toLowerCase())
          ? String(obj.msme_category).toLowerCase()
          : null,
        payment_terms: String(obj.payment_terms ?? "").trim() || null,
        notes: String(obj.notes ?? "").trim() || null
      }
    };
  });
}

export function buildSkuImportPreview(objects, existingSkus) {
  const existingCodes = new Set(
    (existingSkus ?? []).map((s) => String(s.sku_code ?? "").trim().toUpperCase())
  );
  const seenInFile = new Set();

  return (objects ?? []).map((obj, index) => {
    const skuCode = String(obj.sku_code ?? "").trim();
    const codeKey = skuCode.toUpperCase();

    let status = "ready";
    let reason = "";
    if (!skuCode) {
      status = "invalid";
      reason = "sku_code missing";
    } else if (existingCodes.has(codeKey)) {
      status = "duplicate_existing";
      reason = "sku_code already in masters";
    } else if (seenInFile.has(codeKey)) {
      status = "duplicate_in_file";
      reason = "repeated inside this file";
    } else if (obj.mrp && Number.isNaN(Number(obj.mrp))) {
      status = "invalid";
      reason = "mrp is not a number";
    }
    if (status === "ready") seenInFile.add(codeKey);

    return {
      rowNumber: index + 2,
      status,
      reason,
      payload: {
        sku_code: skuCode,
        barcode: String(obj.barcode ?? "").trim() || null,
        size_label: String(obj.size_label ?? "").trim() || null,
        hsn: String(obj.hsn ?? "").trim() || null,
        item_kind: ITEM_KINDS.includes(String(obj.item_kind ?? "").toLowerCase())
          ? String(obj.item_kind).toLowerCase()
          : "finished_good",
        uom: String(obj.uom ?? "").trim() || "pcs",
        weight_grams: obj.weight_grams && !Number.isNaN(Number(obj.weight_grams)) ? Number(obj.weight_grams) : null,
        mrp: obj.mrp && !Number.isNaN(Number(obj.mrp)) ? Number(obj.mrp) : null
      }
    };
  });
}

/** Insert ready rows in chunks; returns { inserted, failed: [{rowNumber, message}] }. */
export async function importPreviewRows(table, previewRows) {
  const ready = (previewRows ?? []).filter((r) => r.status === "ready");
  const failed = [];
  let inserted = 0;
  const chunkSize = 100;

  for (let i = 0; i < ready.length; i += chunkSize) {
    const chunk = ready.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk.map((r) => r.payload));
    if (error) {
      // Fall back to row-by-row so one bad row does not sink the chunk.
      for (const row of chunk) {
        const { error: rowError } = await supabase.from(table).insert(row.payload);
        if (rowError) {
          failed.push({ rowNumber: row.rowNumber, message: rowError.message });
        } else {
          inserted += 1;
        }
      }
    } else {
      inserted += chunk.length;
    }
  }

  return { inserted, failed };
}
