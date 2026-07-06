/**
 * Group apparel (or any kind) SKUs under parent style rows for list UI.
 */

export function nextParentCode(styleParents, kind) {
  const prefix = kind === "apparel" ? "STY" : kind === "fabric" ? "STY-FAB" : "STY-TRM";
  const nums = (styleParents || [])
    .filter((p) => p.kind === kind)
    .map((p) => parseInt((p.parentSkuCode.split("-").pop() || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(...nums, 0) + 1;
  return `${prefix}-${next}`;
}

export function applyExistingParent(form, parent) {
  if (!parent) return form;
  return {
    ...form,
    parentMode: "existing",
    parentStyleId: parent.id,
    parentStyleName: parent.styleName,
    name: parent.styleName
  };
}

export function nextSkuCode(kind, pool) {
  const nums = (pool || [])
    .map((p) => parseInt((p.id.split("-")[1] || "").replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(...nums, 0) + 1;
  if (kind === "apparel") return `APP-X${next}`;
  if (kind === "fabric") return `FAB-${next}`;
  return `TRM-${next}`;
}

export function mergeEmptyStyleParents(groups, styleParents, kind) {
  const groupIds = new Set((groups || []).map((g) => g.id));
  const empty = (styleParents || [])
    .filter((p) => p.kind === kind && !groupIds.has(p.id))
    .map((p) => ({
      id: p.id,
      parentSkuCode: p.parentSkuCode,
      styleName: p.styleName,
      kind: p.kind,
      children: [],
      totalStock: 0,
      totalValue: 0,
      variantCount: 0
    }));
  return [...(groups || []), ...empty].sort((a, b) => (a.styleName || "").localeCompare(b.styleName || ""));
}

export function groupSkusByParent(rows, { kind = "apparel" } = {}) {
  const filtered = rows.filter((r) => !kind || r.kind === kind);
  const groups = new Map();
  const standalone = [];

  for (const sku of filtered) {
    if (sku.parentStyleId) {
      const key = sku.parentStyleId;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          parentSkuCode: sku.parentStyleCode || key,
          styleName: sku.parentStyleName || sku.name,
          kind: sku.kind,
          children: []
        });
      }
      groups.get(key).children.push(sku);
    } else {
      standalone.push(sku);
    }
  }

  const grouped = [...groups.values()].map((g) => {
    const totalStock = g.children.reduce((s, c) => s + Number(c.totalStock ?? c.stock ?? 0), 0);
    const totalValue = g.children.reduce(
      (s, c) => s + Number(c.totalStock ?? c.stock ?? 0) * Number(c.cost ?? 0),
      0
    );
    return { ...g, totalStock, totalValue, variantCount: g.children.length };
  });

  grouped.sort((a, b) => (a.styleName || "").localeCompare(b.styleName || ""));

  return { groups: grouped, standalone };
}

export function apparelMatchesQuery(group, query, supplierOf) {
  if (!query) return true;
  const q = query.toLowerCase();
  if ((group.parentSkuCode || "").toLowerCase().includes(q)) return true;
  if ((group.styleName || "").toLowerCase().includes(q)) return true;
  return group.children.some((r) => skuMatchesQuery(r, q, supplierOf));
}

export function skuMatchesQuery(r, q, supplierOf) {
  return (
    r.id.toLowerCase().includes(q) ||
    r.name.toLowerCase().includes(q) ||
    (r.color || "").toLowerCase().includes(q) ||
    (r.parentStyleCode || "").toLowerCase().includes(q) ||
    (r.parentStyleName || "").toLowerCase().includes(q) ||
    (r.composition || r.type || r.category || "").toLowerCase().includes(q) ||
    (supplierOf(r.supplier)?.name || "").toLowerCase().includes(q)
  );
}

/** Groups + standalone SKUs for apparel list (before pagination). */
export function buildApparelDisplayLists(rows, styleParents, query, supplierOf) {
  const { groups, standalone } = groupSkusByParent(rows);
  const allGroups = mergeEmptyStyleParents(groups, styleParents, "apparel");
  const q = String(query ?? "").trim().toLowerCase();
  const visibleGroups = allGroups.filter((g) => apparelMatchesQuery(g, query, supplierOf));
  const visibleStandalone = !q
    ? standalone
    : standalone.filter((r) => skuMatchesQuery(r, q, supplierOf));
  return { visibleGroups, visibleStandalone };
}

/** Flat top-level rows for apparel pagination (one group header or one SKU per entry). */
export function buildApparelTopLevelEntries(rows, styleParents, query, supplierOf) {
  const { visibleGroups, visibleStandalone } = buildApparelDisplayLists(
    rows,
    styleParents,
    query,
    supplierOf
  );
  return [
    ...visibleGroups.map((group) => ({ kind: "group", group })),
    ...visibleStandalone.map((sku) => ({ kind: "standalone", sku }))
  ];
}
