/** Search helpers for inventory list filters. */

export function skuMatchesQuery(r, q, supplierOf) {
  return (
    r.id.toLowerCase().includes(q) ||
    r.name.toLowerCase().includes(q) ||
    (r.color || "").toLowerCase().includes(q) ||
    (r.composition || r.type || r.category || "").toLowerCase().includes(q) ||
    (supplierOf(r.supplier)?.name || "").toLowerCase().includes(q)
  );
}
