import test from "node:test";
import assert from "node:assert/strict";
import { sc1Enabled, isTabRoot } from "./sc1.js";

const memory = () => { const data = {}; return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } }; };

test("every staff persona is switched on by default; customer and dealer are not", () => {
  for (const role of [0, 1, 2, 4, 7, 8, 9, 11, 12]) assert.equal(sc1Enabled({ role }), true, `role ${role}`);
  for (const role of [3, 10, 5, 6]) assert.equal(sc1Enabled({ role }), false, `role ${role}`);
});

test("customer and dealer cannot be forced on", () => {
  for (const role of [3, 10]) assert.equal(sc1Enabled({ role }, { search: "?sc1=1", setting: "1,3,10" }), false);
});

test("setting adds roles and the query override is remembered", () => {
  assert.equal(sc1Enabled({ role: 0 }, { setting: "1, 0" }), true);
  assert.equal(sc1Enabled({ role: 2 }, { setting: "1, 0" }), false);
  const storage = memory();
  assert.equal(sc1Enabled({ role: 1 }, { search: "?sc1=0", storage }), false);
  assert.equal(sc1Enabled({ role: 1 }, { storage }), false);
  assert.equal(sc1Enabled({ role: 1 }, { search: "?sc1=1", storage }), true);
});

test("tab roots are recognised, deeper pages are not", () => {
  const tabs = [{ href: "/squad/orders" }, { href: "/squad/orders?scope=own" }, { href: "/squad/customers" }];
  assert.equal(isTabRoot(tabs, "/squad/orders", "?status=1"), true);
  assert.equal(isTabRoot(tabs, "/squad/customers/"), true);
  assert.equal(isTabRoot(tabs, "/squad/customers/42"), false);
  assert.equal(isTabRoot(tabs, "/squad/profile"), false);
});
