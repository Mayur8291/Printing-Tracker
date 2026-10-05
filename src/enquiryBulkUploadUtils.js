import { parseCsv } from "./mastersUtils";
import { INDIAN_CITIES } from "./indianCities";
import { ENQUIRY_SOURCES, ENQUIRY_SOURCE_REFERENCE, createEnquiry } from "./enquiryUtils";
import { excelCellString } from "./inventory/excelCellUtils";

/** Template header order. Matching is forgiving; see `HEADER_ALIASES`. */
export const ENQUIRY_CSV_HEADERS = ["Customer name", "Concerns", "Source", "Tag", "Date", "Phone", "Email", "City"];

const HEADER_ALIASES = {
  customer_name: ["customername", "customer", "name", "client", "clientname"],
  product_details: ["concerns", "concern", "details", "enquirydetails", "enquiry", "requirement", "query", "message"],
  source: ["source", "channel", "leadsource"],
  tag: ["tag", "tags", "category", "team"],
  date: ["date", "enquirydate", "createdat", "created", "receivedon", "received"],
  customer_phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "whatsapp"],
  customer_email: ["email", "emailid", "mail"],
  customer_city: ["city", "location", "town"]
};

function normHeader(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normKey(v) {
  return String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map CSV header row → field keys. Unknown headers are ignored. */
export function mapEnquiryCsvHeaders(headerRow) {
  const map = {};
  (headerRow ?? []).forEach((raw, idx) => {
    const n = normHeader(raw);
    if (!n) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] == null && aliases.includes(n)) {
        map[field] = idx;
        return;
      }
    }
  });
  return map;
}

const SOURCE_BY_KEY = Object.fromEntries(ENQUIRY_SOURCES.map((s) => [normKey(s), s]));
SOURCE_BY_KEY.wa = "WhatsApp";
SOURCE_BY_KEY.fb = "Facebook";
SOURCE_BY_KEY.ig = "Insta Post";
SOURCE_BY_KEY.instagram = "Insta Post";
SOURCE_BY_KEY.reel = "Insta Reel";
SOURCE_BY_KEY.reels = "Insta Reel";
SOURCE_BY_KEY.walkin = "Walk-in";
SOURCE_BY_KEY.referral = ENQUIRY_SOURCE_REFERENCE;

/** Canonical source text. "Reference - Name" / "Reference: Name" / "Ref Name" keep the name. Unknown → as typed. */
export function normalizeCsvSource(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const refMatch = text.match(/^(reference|referral|ref)\s*[-:–—]?\s*(.*)$/i);
  if (refMatch) {
    const name = refMatch[2].trim();
    return name ? `${ENQUIRY_SOURCE_REFERENCE} - ${name}` : ENQUIRY_SOURCE_REFERENCE;
  }
  return SOURCE_BY_KEY[normKey(text)] ?? text;
}

const CITY_BY_KEY = Object.fromEntries(INDIAN_CITIES.map((c) => [normKey(c), c]));
CITY_BY_KEY.bengaluru = "Bangalore";
CITY_BY_KEY.bombay = "Mumbai";
CITY_BY_KEY.calcutta = "Kolkata";
CITY_BY_KEY.madras = "Chennai";
CITY_BY_KEY.newdelhi = "Delhi";
CITY_BY_KEY.gurgaon = "Gurugram";
CITY_BY_KEY.prayagraj = "Allahabad";
CITY_BY_KEY.trivandrum = "Thiruvananthapuram";
CITY_BY_KEY.cochin = "Kochi";
CITY_BY_KEY.mysore = "Mysuru";
CITY_BY_KEY.belgaum = "Belagavi";
CITY_BY_KEY.hubli = "Hubballi";
CITY_BY_KEY.vizag = "Visakhapatnam";
CITY_BY_KEY.puducherry = "Pondicherry";

/** City from the app list when it matches; otherwise the text as typed (no state will derive). */
export function normalizeCsvCity(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { city: "", known: true };
  const hit = CITY_BY_KEY[normKey(text)];
  return hit ? { city: hit, known: true } : { city: text, known: false };
}

/**
 * Parse Date cell. Accepts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, d MMM yyyy,
 * ISO datetime, Excel serial numbers. Returns ISO string or null when unreadable.
 */
export function parseCsvDate(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  if (/^\d{4,6}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
  }

  let m = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day, Number(m[4] ?? 9), Number(m[5] ?? 0));
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d.toISOString();
    return null;
  }

  m = text.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(year, month - 1, day, Number(m[4] ?? 9), Number(m[5] ?? 0));
    if (d.getMonth() === month - 1 && d.getDate() === day) return d.toISOString();
    return null;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Turn CSV text into import candidates.
 * Returns { headerMap, rows: [{ line, form, warnings, skip, skipReason }], missingHeaders }.
 */
export function parseEnquiryCsv(text, options = {}) {
  return parseEnquiryMatrix(parseCsv(text), options);
}

function excelDateToYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Read the first sheet of an .xlsx (ExcelJS, lazy) into the same shape as `parseEnquiryCsv`. */
export async function parseEnquiryWorkbook(file, options = {}) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(TEMPLATE_SHEET) ?? workbook.worksheets.find((ws) => ws.state !== "hidden");
  if (!sheet) throw new Error("No worksheet found in the file.");
  const matrix = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    const last = row.cellCount;
    for (let c = 1; c <= last; c += 1) {
      const cell = row.getCell(c);
      // Excel date cells arrive as UTC-midnight Date objects; keep the UTC day as yyyy-mm-dd.
      cells.push(cell.value instanceof Date ? excelDateToYmd(cell.value) : excelCellString(cell));
    }
    if (cells.some((v) => String(v).trim() !== "")) matrix.push(cells);
  });
  return parseEnquiryMatrix(matrix, options);
}

/** Pick CSV or XLSX by file name / type. */
export async function parseEnquiryFile(file, options = {}) {
  const name = String(file?.name ?? "").toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return parseEnquiryWorkbook(file, options);
  if (name.endsWith(".xls")) throw new Error("Old .xls is not supported — save as .xlsx or .csv.");
  return parseEnquiryCsv(await file.text(), options);
}

/** Shared parser: first row headers, rest data. */
export function parseEnquiryMatrix(matrix, { tags = [] } = {}) {
  if (!matrix?.length) return { headerMap: {}, rows: [], missingHeaders: ENQUIRY_CSV_HEADERS };
  const headerMap = mapEnquiryCsvHeaders(matrix[0]);
  const missingHeaders = [];
  if (headerMap.customer_name == null) missingHeaders.push("Customer name");
  if (headerMap.product_details == null) missingHeaders.push("Concerns");

  const tagByKey = Object.fromEntries((tags ?? []).map((t) => [normKey(t.name), t]));
  const cell = (r, field) => (headerMap[field] == null ? "" : String(r[headerMap[field]] ?? "").trim());

  const rows = matrix.slice(1).map((r, i) => {
    const line = i + 1; // data row number; blank rows are not counted
    const warnings = [];
    let customer_name = cell(r, "customer_name");
    const customer_phone = cell(r, "customer_phone");
    const customer_email = cell(r, "customer_email");
    const product_details = cell(r, "product_details");

    if (!customer_name && !customer_phone && !customer_email) {
      return { line, form: null, warnings, skip: true, skipReason: "No name, phone, or email" };
    }
    if (!customer_name) {
      customer_name = customer_phone || customer_email || "Unknown customer";
      warnings.push("Name blank — used phone/email");
    }

    const source = normalizeCsvSource(cell(r, "source"));
    if (!source) warnings.push("No source");

    const tagText = cell(r, "tag");
    let tag_id = "";
    if (tagText) {
      const hit = tagByKey[normKey(tagText)];
      if (hit) tag_id = hit.id;
      else warnings.push(`Tag "${tagText}" not found — left blank`);
    }

    const dateText = cell(r, "date");
    let created_at = null;
    if (dateText) {
      created_at = parseCsvDate(dateText);
      if (!created_at) warnings.push(`Date "${dateText}" unreadable — used today`);
    }

    const { city, known } = normalizeCsvCity(cell(r, "customer_city"));
    if (city && !known) warnings.push(`City "${city}" not in list — saved as typed, no state`);

    if (!product_details) warnings.push("No concerns");

    return {
      line,
      skip: false,
      warnings,
      form: {
        customer_name,
        customer_phone,
        customer_email,
        product_details,
        source,
        priority: "normal",
        notes: "",
        order_id: "",
        order_type: "customized",
        help_topic: "enquiry",
        ticket_kind: "enquiry",
        tag_id,
        customer_city: city,
        created_at
      }
    };
  });

  return { headerMap, rows, missingHeaders };
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const TEMPLATE_SHEET = "Enquiries";
const LISTS_SHEET = "Lists";
const TEMPLATE_ROWS = 1000;

function sampleRow(tags = []) {
  return [
    "Riya Sharma",
    "Wants 50 custom mugs with logo",
    "WhatsApp",
    tags[0]?.name ?? "Pets",
    "05/10/2026",
    "+91 98765 43210",
    "riya@example.com",
    "Pune"
  ];
}

/** Template text: header + one sample row. */
export function buildEnquiryCsvTemplate(tags = []) {
  return [ENQUIRY_CSV_HEADERS, sampleRow(tags)].map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

function colLetter(idx1) {
  let n = idx1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Excel template with dropdowns on Source, Tag, City (hidden `Lists` sheet feeds them).
 * Returns an ArrayBuffer ready to download.
 */
export async function buildEnquiryXlsxTemplate(tags = []) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Scott Dashboard";

  const lists = wb.addWorksheet(LISTS_SHEET, { state: "veryHidden" });
  const tagNames = (tags ?? []).map((t) => t.name).filter(Boolean);
  const columns = [
    { header: "Sources", values: ENQUIRY_SOURCES },
    { header: "Tags", values: tagNames },
    { header: "Cities", values: INDIAN_CITIES }
  ];
  columns.forEach((col, i) => {
    lists.getCell(1, i + 1).value = col.header;
    col.values.forEach((v, r) => {
      lists.getCell(r + 2, i + 1).value = v;
    });
  });
  const listRef = (i, count) => `'${LISTS_SHEET}'!$${colLetter(i + 1)}$2:$${colLetter(i + 1)}$${Math.max(2, count + 1)}`;

  const ws = wb.addWorksheet(TEMPLATE_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = ENQUIRY_CSV_HEADERS.map((h) => ({ header: h, key: h, width: h === "Concerns" ? 40 : 20 }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(sampleRow(tags));

  const colIndex = (name) => ENQUIRY_CSV_HEADERS.indexOf(name) + 1;
  const sourceCol = colLetter(colIndex("Source"));
  const tagCol = colLetter(colIndex("Tag"));
  const cityCol = colLetter(colIndex("City"));
  const dateCol = colLetter(colIndex("Date"));
  const phoneCol = colLetter(colIndex("Phone"));

  const validation = (formula, title, errorStyle = "stop") => ({
    type: "list",
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: true,
    errorStyle,
    errorTitle: `${title} not in list`,
    error:
      errorStyle === "stop"
        ? `Pick a ${title.toLowerCase()} from the dropdown, or leave blank.`
        : `Pick from the dropdown. Only "Reference - <name>" may be typed.`
  });

  for (let r = 2; r <= TEMPLATE_ROWS; r += 1) {
    // Source warns (not stops) so "Reference - <name>" can still be typed.
    ws.getCell(`${sourceCol}${r}`).dataValidation = validation(listRef(0, ENQUIRY_SOURCES.length), "Source", "warning");
    if (tagNames.length) ws.getCell(`${tagCol}${r}`).dataValidation = validation(listRef(1, tagNames.length), "Tag");
    ws.getCell(`${cityCol}${r}`).dataValidation = validation(listRef(2, INDIAN_CITIES.length), "City");
    ws.getCell(`${dateCol}${r}`).numFmt = "dd/mm/yyyy";
    ws.getCell(`${phoneCol}${r}`).numFmt = "@";
  }
  ws.getCell(`${dateCol}1`).note = "dd/mm/yyyy. Blank = import day.";
  ws.getCell(`${sourceCol}1`).note = "Pick from dropdown. For Reference, type: Reference - <name>";

  return wb.xlsx.writeBuffer();
}

export function downloadBinaryFile(filename, buffer, mime) {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Insert rows one at a time (each needs its own ENQ- code).
 * onProgress(done, total). Returns { created: row[], failed: [{ line, error }] }.
 */
export async function importEnquiryRows({ rows, createdBy, onProgress }) {
  const created = [];
  const failed = [];
  const todo = rows.filter((r) => !r.skip && r.form);
  for (let i = 0; i < todo.length; i += 1) {
    const r = todo[i];
    try {
      const row = await createEnquiry({ createdBy, form: r.form });
      created.push(row);
    } catch (e) {
      failed.push({ line: r.line, error: e?.message || "Could not save" });
    }
    onProgress?.(i + 1, todo.length);
  }
  return { created, failed };
}
