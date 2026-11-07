/** Normalize ExcelJS cell.value shapes (rich text, formulas, hyperlinks) to plain text. */
export function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    if (value.error != null) return String(value.error).trim();
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return cellText(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((part) => (part?.text != null ? String(part.text) : ""))
        .join("")
        .trim();
    }
  }

  return String(value).trim();
}

/** Prefer ExcelJS formatted cell.text; fall back to parsing cell.value. */
export function excelCellString(cell) {
  if (!cell) return "";
  const formatted = cell.text;
  if (formatted != null && String(formatted).trim() !== "") {
    return String(formatted).trim();
  }
  return cellText(cell.value);
}
