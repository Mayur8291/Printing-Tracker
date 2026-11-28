import test from "node:test";
import assert from "node:assert/strict";
import { sc1Enabled, isTabRoot } from "./sc1.js";

const memory = () => { const data = {}; return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } }; };

test("only the Sales Coordinator is switched on by default", () => {
  assert.equal(sc1Enabled({ role: 1 }), true);
  for (const role of [0, 2, 3, 4, 7, 8, 9, 10, 11, 12]) assert.equal(sc1Enabled({ role }), false, `role ${role}`);
});

test("customer and dealer cannot be forced on", () => {
  for (const role of [3, 10]) assert.equal(sc1Enabled({ role }, { search: "?sc1=1", setting: "1,3,10" }), false);
});

test("setting adds roles and the query override is remembered", () => {
  assert.equal(sc1Enabled({ role: 0 }, { setting: "1, 0" }), true);
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
