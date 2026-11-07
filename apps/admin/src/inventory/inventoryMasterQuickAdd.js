export function nextSupplierId(suppliers = []) {
  const nums = suppliers
    .map((s) => parseInt(String(s.id || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(...nums, 0) + 1;
  return `SUP-${String(next).padStart(3, "0")}`;
}

export function nextWarehouseId(warehouses = []) {
  const nums = warehouses
    .map((w) => parseInt(String(w.id || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(...nums, 0) + 1;
  return `WH-${String(next).padStart(2, "0")}`;
}

export function buildMinimalSupplierRecord(name, suppliers = []) {
  return {
    id: nextSupplierId(suppliers),
    name: String(name ?? "").trim(),
    country: "India",
    city: "",
    leadDays: 14,
    paymentTerms: "Net 30",
    supplierType: "other",
    contact: "",
    gstin: "",
    address: ""
  };
}

export function buildMinimalWarehouseRecord(name, warehouses = []) {
  return {
    id: nextWarehouseId(warehouses),
    name: String(name ?? "").trim(),
    city: "",
    type: "Mixed",
    capacity: 1000
  };
}
