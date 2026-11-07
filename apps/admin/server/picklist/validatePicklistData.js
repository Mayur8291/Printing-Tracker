import { deriveTotalItems } from "../../src/picklist/picklistFormat.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseDateLike(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function validatePicklistItem(raw, index) {
  const prefix = `items[${index}]`;
  if (!raw || typeof raw !== "object") {
    return `${prefix} must be an object`;
  }
  if (!isFiniteNumber(raw.slNo) || raw.slNo < 1) {
    return `${prefix}.slNo must be a positive number`;
  }
  if (!isNonEmptyString(raw.skuCode)) {
    return `${prefix}.skuCode is required`;
  }
  if (!isNonEmptyString(raw.skuName)) {
    return `${prefix}.skuName is required`;
  }
  if (!isNonEmptyString(raw.shelfCode)) {
    return `${prefix}.shelfCode is required`;
  }
  if (raw.comment != null && typeof raw.comment !== "string") {
    return `${prefix}.comment must be a string or null`;
  }
  if (!parseDateLike(raw.pickupDate)) {
    return `${prefix}.pickupDate must be a valid date string`;
  }
  if (!isFiniteNumber(raw.qty) || raw.qty <= 0) {
    return `${prefix}.qty must be a positive number`;
  }
  return null;
}

function validatePicklistOrder(raw, index) {
  const prefix = `orders[${index}]`;
  if (!raw || typeof raw !== "object") {
    return `${prefix} must be an object`;
  }
  if (!isNonEmptyString(raw.saleOrderNumber)) {
    return `${prefix}.saleOrderNumber is required`;
  }
  if (!isNonEmptyString(raw.customerName)) {
    return `${prefix}.customerName is required`;
  }
  return null;
}

/**
 * Validates POST body and returns normalized PicklistData.
 * @param {unknown} body
 */
export function validatePicklistData(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const picklistNo = String(body.picklistNo ?? "").trim();
  if (!picklistNo) {
    return { ok: false, error: "picklistNo is required." };
  }

  const createdAt = parseDateLike(body.createdAt);
  if (!createdAt) {
    return { ok: false, error: "createdAt must be a valid date string." };
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { ok: false, error: "items must be a non-empty array." };
  }

  if (!Array.isArray(body.orders) || body.orders.length === 0) {
    return { ok: false, error: "orders must be a non-empty array." };
  }

  for (let i = 0; i < body.items.length; i++) {
    const err = validatePicklistItem(body.items[i], i);
    if (err) return { ok: false, error: err };
  }

  for (let i = 0; i < body.orders.length; i++) {
    const err = validatePicklistOrder(body.orders[i], i);
    if (err) return { ok: false, error: err };
  }

  /** @type {import('../../src/picklist/picklistTypes.js').PicklistData} */
  const data = {
    picklistNo,
    createdAt: body.createdAt,
    items: body.items.map((item) => ({
      slNo: item.slNo,
      skuCode: String(item.skuCode).trim(),
      skuName: String(item.skuName).trim(),
      shelfCode: String(item.shelfCode).trim(),
      comment: item.comment == null ? null : String(item.comment),
      pickupDate: item.pickupDate,
      qty: item.qty
    })),
    orders: body.orders.map((order) => ({
      saleOrderNumber: String(order.saleOrderNumber).trim(),
      customerName: String(order.customerName).trim()
    }))
  };

  if (body.totalItems != null) {
    return {
      ok: false,
      error: "totalItems must not be supplied — it is derived from items.qty."
    };
  }

  if (deriveTotalItems(data.items) === 0 && data.items.length > 0) {
    return { ok: false, error: "At least one item must have qty > 0." };
  }

  return { ok: true, data };
}
