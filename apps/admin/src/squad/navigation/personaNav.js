import ia from "./persona-ia.json" with { type: "json" };
import { canVisit } from "./registry.js";

// Interim routing: Flutter tab -> closest existing web module. NEW screens (Phase 4-6) replace
// these targets; until then the user still lands on the right working feature.
const TAB_TARGET = {
  orders: "/squad/orders", customers: "/squad/customers", distributors: "/squad/distributors",
  products: "/squad/catalogue", todos: "/squad/tasks", "sales-coordinators": "/squad/coordinators/sales",
  "production-coordinators": "/squad/coordinators/production", factories: "/squad/coordinators/factory", tailors: "/squad/tailors",
  delivery: "/squad/delivery", jobsheets: "/squad/production", "placed-orders": "/squad/orders?scope=placed",
  "my-orders": "/squad/orders?scope=own",
};
const ROLE_TAB_TARGET = {
  7: { orders: "/squad/production" }, 9: { orders: "/squad/production" },
};
const DRAWER_TARGET = {
  Personas: "/squad/personas", "Tasks, Roles & Goals": "/squad/goals", "Sync Products": "/squad/administration",
  Catalogues: "/squad/documents", "Change SC": "/squad/change-sc", "Customers Request": "/squad/customer-requests",
  "Force Complete Order": "/squad/force-complete", "Promotional Assets": "/squad/promotions",
  Milestone: "/squad/targets", "Delete Account": "/squad/profile",
};
const ROLE_DRAWER_TARGET = { 3: { "Change SC": "/squad/profile" } };
const MORE = [["stock", "Stock & deliveries"], ["reports", "Reports"], ["documents", "Documents"], ["notifications", "Notifications"], ["administration", "Administration"], ["profile", "My account"]];

const ALIAS = { distributors: "customers", "job-work": "orders" };
const flagged = (item, identity) => !item.flag || identity.capabilities?.[item.flag] === true;
const moduleOf = (href) => href.split("?")[0].replace(/^\/squad\/?/, "").split("/")[0] || "home";

export function personaDefinition(identity) { return ia.personas[String(Number(identity?.role))] ?? null; }

export function tabsFor(identity) {
  const def = personaDefinition(identity);
  if (!def) return [];
  return def.tabs.filter((tab) => flagged(tab, identity)).map((tab) => ({
    key: tab.key, label: tab.label, icon: tab.icon, href: ROLE_TAB_TARGET[identity.role]?.[tab.key] ?? TAB_TARGET[tab.key], status: tab.status,
  })).filter((tab) => tab.href && canVisit(identity, tab.href));
}

export function drawerFor(identity) {
  const def = personaDefinition(identity);
  const used = new Set(tabsFor(identity).map((tab) => moduleOf(tab.href)));
  const seen = new Set();
  const own = (def?.drawer ?? []).filter((item) => flagged(item, identity) && DRAWER_TARGET[item.label]).map((item) => ({ label: item.label, href: ROLE_DRAWER_TARGET[identity.role]?.[item.label] ?? DRAWER_TARGET[item.label], group: "Menu" }))
    .filter((item) => canVisit(identity, item.href) && !seen.has(item.label) && seen.add(item.label));
    const more = MORE.filter(([key]) => !used.has(key) && canVisit(identity, `/squad/${key}`)).map(([key, label]) => ({ label, href: `/squad/${key}`, group: "More" }));
  return [...own, ...more];
}

export function landingFor(identity) { return tabsFor(identity)[0]?.href ?? "/squad/profile"; }

/** Active tab = longest href path prefix whose query (if any) is contained in the current URL; falls back to module match. */
export function activeTabKey(tabs, location) {
  const [rawPath, rawQuery = ""] = String(location).split("?");
  const path = rawPath.replace(/\/$/, ""), query = new URLSearchParams(rawQuery);
  const hit = tabs.filter((tab) => {
    const [h, q = ""] = tab.href.split("?");
    if (!(path === h || path.startsWith(`${h}/`))) return false;
    return [...new URLSearchParams(q)].every(([k, v]) => query.get(k) === v);
  }).sort((a, b) => b.href.length - a.href.length)[0];
  if (hit) return hit.key;
  const module = ALIAS[moduleOf(path)] ?? moduleOf(path);
  return tabs.find((tab) => moduleOf(tab.href) === module)?.key ?? null;
}
