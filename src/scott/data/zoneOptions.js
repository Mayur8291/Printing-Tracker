// Only IDs observed on Scott records are options. Names never become wire IDs.
export function buildScottZoneOptions(rows = [], current = null) {
  const zones = new Map();
  for (const row of [...rows, current]) {
    if (!row || typeof row !== "object") continue;
    const source = row.rmp_price_type ?? row;
    const zone = source.zone ?? row.zone;
    const nested = zone && typeof zone === "object" ? zone : null;
    const id = String(source.zone_id ?? "").trim() || String(nested?.id ?? "").trim();
    if (!id) continue;
    const name = String(nested?.name || source.zone_name || (typeof zone === "string" ? zone : "")).trim();
    const previous = zones.get(id);
    if (!previous || (!previous.name && name)) zones.set(id, { value: id, name });
  }
  return [...zones.values()]
    .map(({ value, name }) => ({ value, label: name || "Zone name unavailable" }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value, undefined, { numeric: true }));
}

export function filterScottZoneOptions(options, search) {
  const needle = search.trim().toLowerCase();
  return options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(needle));
}

// A complete, unfiltered first page needs no extra request to build the picker.
export function hasCompleteZoneRows(list) {
  return !list.loading && !list.error && !list.search && !list.debouncedSearch &&
    !list.isFilterActive && list.page === 1 && list.hasNextPage === false;
}

// One bounded request, never a customer or master-table drain. A stalled upstream
// must not leave the picker spinning indefinitely. Already-visible options stay usable.
export async function loadZonePage(fetchPage, { page = 1, timeoutMs = 6000 } = {}) {
  let timer;
  try {
    const result = await Promise.race([
      fetchPage({ page, items: 100 }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Scott is taking too long to load more zones. Please retry.")), timeoutMs);
      })
    ]);
    const rows = result.data ?? [];
    const hasMore = result.hasNextPage ?? (result.totalCountIsExact
      ? page < result.totalPages : rows.length >= (result.pageSize || 100));
    return { options: buildScottZoneOptions(rows), nextPage: hasMore ? page + 1 : null };
  } finally {
    clearTimeout(timer);
  }
}
