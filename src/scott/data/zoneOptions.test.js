import test from "node:test";
import assert from "node:assert/strict";
import { buildScottZoneOptions, filterScottZoneOptions, hasCompleteZoneRows, loadZonePage } from "./zoneOptions.js";

test("Scott names enrich IDs across price types and customers without merging same-name zones", () => {
  const options = buildScottZoneOptions([
    { zone_id: 6 },
    { zone_id: "6", zone: "West" },
    { zone_id: "7", zone: { id: 7, name: "West" } },
    { zone_name: "No upstream ID" },
    { rmp_price_type: { zone_id: 8, zone: { id: 8, name: "East" } } }
  ]);
  assert.deepEqual(options, [
    { value: "8", label: "East" },
    { value: "6", label: "West" },
    { value: "7", label: "West" }
  ]);
  assert.deepEqual(filterScottZoneOptions(options, "WEST").map((item) => item.value), ["6", "7"]);
  assert.deepEqual(filterScottZoneOptions(options, " 6 "), [{ value: "6", label: "West" }]);
});

test("editing preserves an unlisted ID without inventing a name or changing the value", () => {
  assert.deepEqual(buildScottZoneOptions([], { zone_id: "99" }), [
    { value: "99", label: "Zone name unavailable" }
  ]);
  assert.deepEqual(buildScottZoneOptions([{ zone_id: "", zone: { id: 6, name: "West" } }]), [
    { value: "6", label: "West" }
  ]);
});

test("only a complete unfiltered first page can skip the network", () => {
  const list = { page: 1, hasNextPage: false };
  assert.equal(hasCompleteZoneRows(list), true);
  for (const incomplete of [{ search: "Dazzle" }, { debouncedSearch: "Dazzle" }, { isFilterActive: true }, { loading: true }, { error: "offline" }, { page: 2 }, { hasNextPage: true }]) {
    assert.equal(hasCompleteZoneRows({ ...list, ...incomplete }), false);
  }
});

test("fallback loads a single price-type page and never drains further pages", async () => {
  const requests = [];
  const result = await loadZonePage(async (params) => {
    requests.push(params);
    return { data: [{ zone_id: 6, zone: { name: "Pune" } }], totalCountIsExact: true, totalPages: 3 };
  });
  assert.deepEqual(requests, [{ page: 1, items: 100 }]);
  assert.deepEqual(result, { options: [{ value: "6", label: "Pune" }], nextPage: 2 });
});

test("hung requests time out instead of keeping the picker loading", async () => {
  await assert.rejects(loadZonePage(() => new Promise(() => {}), { timeoutMs: 15 }), /taking too long/);
});

test("failed requests reject, and the same page can be retried successfully", async () => {
  await assert.rejects(loadZonePage(async () => { throw new Error("offline"); }), /offline/);
  const result = await loadZonePage(async () => ({ data: [], totalCountIsExact: true, totalPages: 1 }));
  assert.deepEqual(result, { options: [], nextPage: null });
});
