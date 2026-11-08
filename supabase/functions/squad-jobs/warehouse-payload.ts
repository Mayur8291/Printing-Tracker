import {
  fields,
  identifier,
  object,
  text,
  WarehouseError,
} from "./warehouse-types.ts";
const invalid = () => {
  throw new WarehouseError("REJECTED", "WAREHOUSE_CONTRACT_INVALID");
};
export function optionalText(value: unknown, max = 1000) {
  if (value === undefined || value === null) return;
  if (
    typeof value !== "string" || value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) invalid();
}
function amount(value: unknown) {
  if (
    typeof value !== "number" && typeof value !== "string" ||
    !/^\d+(\.\d+)?$/.test(String(value)) || Number(value) > 1e12
  ) invalid();
}
export function dashboardAddress(value: unknown) {
  const p = object(value);
  fields(p, [
    "name",
    "address_line1",
    "city",
    "state",
    "country",
    "pincode",
    "phone",
    "email",
  ]);
  for (const v of Object.values(p)) optionalText(v);
  return p;
}
export function dashboardPayload(
  p: Record<string, unknown>,
  required: boolean,
) {
  if (
    p.due_on !== undefined && p.due_on !== null &&
    (typeof p.due_on !== "string" || !Number.isFinite(Date.parse(p.due_on)))
  ) invalid();
  optionalText(p.comment, 10000);
  if (p.customer !== undefined) {
    const c = object(p.customer);
    fields(c, ["code", "name", "email", "phone"]);
    for (const v of Object.values(c)) optionalText(v);
    text(c.code);
  }
  if (p.shipping_address !== undefined && p.shipping_address !== null) {
    dashboardAddress(p.shipping_address);
  }
  if (p.payment !== undefined) {
    const payment = object(p.payment);
    fields(payment, ["instrument", "cash_on_delivery"]);
    if (payment.instrument !== "CASH" || payment.cash_on_delivery !== true) {
      invalid();
    }
  }
  if (required && !p.items) invalid();
  if (p.items !== undefined) {
    if (!Array.isArray(p.items) || !p.items.length || p.items.length > 250) {
      invalid();
    }
    const seen = new Set<string>();
    for (const raw of p.items as unknown[]) {
      const line = object(raw);
      fields(line, ["item_code", "sku_code", "quantity", "unit_price"]);
      const code = identifier(line.item_code);
      if (seen.has(code)) invalid();
      seen.add(code);
      text(line.sku_code);
      amount(line.unit_price);
      if (
        typeof line.quantity !== "number" || line.quantity <= 0 ||
        line.quantity > 1000000 ||
        Math.abs(line.quantity * 100 - Math.round(line.quantity * 100)) >
          0.00001
      ) invalid();
    }
  }
}
function customFields(value: unknown, commentLimit: number) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 10) invalid();
  for (const raw of value as unknown[]) {
    const p = object(raw);
    fields(p, ["name", "value"]);
    if (!["Customer_Details", "PICKUPDATE", "Comment"].includes(p.name)) {
      invalid();
    }
    // Match SQL/Ruby character counts, not JavaScript UTF-16 code units.
    const max = p.name === "Comment" ? commentLimit : 10000;
    optionalText(p.value, max * 2);
    if (typeof p.value === "string" && Array.from(p.value).length > max) {
      invalid();
    }
  }
}
export function uniwarePayload(p: Record<string, unknown>) {
  fields(p, [
    "code",
    "displayOrderCode",
    "displayOrderDateTime",
    "customerCode",
    "customerName",
    "channel",
    "notificationEmail",
    "notificationMobile",
    "cashOnDelivery",
    "paymentInstrument",
    "addresses",
    "billingAddress",
    "shippingAddress",
    "totalCashOnDeliveryCharges",
    "fulfillmentTat",
    "customFieldValues",
    "saleOrderItems",
  ]);
  if (p.channel !== "Custom") invalid();
  for (
    const key of ["customerName", "notificationEmail", "notificationMobile"]
  ) optionalText(p[key], 1000);
  for (const key of ["displayOrderDateTime", "fulfillmentTat"]) {
    if (
      p[key] !== undefined &&
      (typeof p[key] !== "string" ||
        !Number.isFinite(Date.parse(p[key] as string)))
    ) invalid();
  }
  if (
    p.totalCashOnDeliveryCharges !== undefined &&
    p.totalCashOnDeliveryCharges !== 0
  ) invalid();
  customFields(p.customFieldValues, 50 * 4000 + 49 * 2);
  if (
    !Array.isArray(p.addresses) || !p.addresses.length || p.addresses.length > 2
  ) invalid();
  const addresses = p.addresses as unknown[];
  for (const raw of addresses) {
    const a = object(raw);
    fields(a, [
      "id",
      "name",
      "addressLine1",
      "city",
      "state",
      "country",
      "pincode",
      "phone",
      "email",
    ]);
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(String(a.id))) invalid();
    for (const [k, v] of Object.entries(a)) if (k !== "id") optionalText(v);
  }
  for (const key of ["billingAddress", "shippingAddress"]) {
    const a = object(p[key]);
    fields(a, ["referenceId"]);
    if (
      !addresses.some((x) => String(object(x).id) === String(a.referenceId))
    ) invalid();
  }
  for (const raw of p.saleOrderItems as unknown[]) {
    const line = object(raw);
    fields(line, [
      "code",
      "itemSku",
      "shippingMethodCode",
      "giftWrap",
      "facilityCode",
      "totalPrice",
      "sellingPrice",
      "prepaidAmount",
      "discount",
      "shippingCharges",
      "customFieldValues",
    ]);
    if (line.shippingMethodCode !== "STD" || line.giftWrap !== false) invalid();
    for (const key of ["prepaidAmount", "discount", "shippingCharges"]) {
      if (line[key] !== 0) invalid();
    }
    amount(line.totalPrice);
    amount(line.sellingPrice);
    customFields(line.customFieldValues, 350);
  }
}
export function uniwareCustomer(p: Record<string, unknown>) {
  fields(p, [
    "name",
    "code",
    "enabled",
    "gstNumber",
    "partyContacts",
    "billingAddress",
    "shippingAddress",
  ]);
  identifier(p.code, 45);
  text(p.name, 200);
  if (typeof p.enabled !== "boolean") invalid();
  optionalText(p.gstNumber, 15);
  if (!Array.isArray(p.partyContacts) || p.partyContacts.length !== 1) {
    invalid();
  }
  for (const raw of p.partyContacts as unknown[]) {
    const c = object(raw);
    fields(c, ["contactType", "partyCode", "name", "email", "phone"]);
    if (c.contactType !== "PRIMARY") invalid();
    identifier(c.partyCode);
    for (const key of ["name", "email", "phone"]) optionalText(c[key]);
  }
  for (const key of ["billingAddress", "shippingAddress"]) {
    const a = object(p[key]);
    fields(a, [
      "addressLine1",
      "city",
      "stateCode",
      "countryCode",
      "partyCode",
      "addressType",
      "pincode",
      "phone",
      "email",
    ]);
    if (a.addressType !== "PRIMARY" || a.countryCode !== "IN") invalid();
    identifier(a.partyCode);
    for (const v of Object.values(a)) optionalText(v);
  }
}
