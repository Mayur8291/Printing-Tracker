export const ROLE_NAMES = Object.freeze({
  0: "Admin", 1: "Sales Coordinator", 2: "Production Coordinator", 3: "Customer",
  4: "Factory Manager", 7: "Dispatch Incharge", 8: "Inspector", 9: "Cutting Master",
  10: "Dealer", 11: "Job Worker", 12: "Assistant Worker / Team",
});
export const HOME_COPY = {
  0: ["Your organization, at a glance", "Review approvals, follow orders and keep your teams moving."],
  1: ["Your sales workspace", "Stay close to your customers, orders and commitments."],
  2: ["Keep production moving", "Plan allocations, follow work and resolve upcoming deadlines."],
  3: ["Made for your business", "Explore products and follow your orders from start to finish."],
  4: ["Your factory workspace", "Coordinate your team and see what needs attention next."],
  7: ["Ready for the next delivery", "Manage dispatch quantities, destinations and delivery records."],
  8: ["Quality, one job sheet at a time", "Review assigned work and record inspection progress."],
  9: ["Your cutting workspace", "Record partial work and keep track of the remaining quantities."],
  10: ["Your dealer workspace", "Connect customer demand, purchases, stock and deliveries."],
  11: ["Your work, clearly organized", "Follow assigned orders, deadlines and each production stage."],
  12: ["Your team workspace", "Everything your team has shared with you, in one place."],
};
const roles = (allowed) => (identity) => allowed.includes(Number(identity.role));
const capability = (key) => (identity) => identity.capabilities?.[key] === true;
export const MODULES = Object.freeze([
  { key: "home", label: "Overview", group: "Workspace", allowed: () => true },
  { key: "catalogue", label: "Products", group: "Commerce", allowed: capability("catalogue") },
  { key: "orders", label: "Orders", group: "Commerce", allowed: roles([0,1,2,3,4,10,11]) },
  { key: "people", label: "People", group: "Workspace", allowed: roles([0,1,2,4,7,8,10]) },
  { key: "production", label: "Production", group: "Operations", allowed: roles([0,2,4,7,8,9]) },
  { key: "job-work", label: "Job work", group: "Operations", allowed: roles([0,2,11]) },
  { key: "stock", label: "Stock & deliveries", group: "Operations", allowed: roles([10]) },
  { key: "tasks", label: "Tasks & notes", group: "Your work", allowed: capability("notes") },
  { key: "goals", label: "Goals & responsibilities", group: "Your work", allowed: capability("goals") },
  { key: "targets", label: "Sales targets", group: "Your work", allowed: roles([0,1]) },
  { key: "reports", label: "Reports", group: "Insights", allowed: roles([0,1,2,4,7,8,9,11]) },
  { key: "documents", label: "Documents", group: "Insights", allowed: (i) => capability("documents")(i) || roles([2,4,7])(i) },
  { key: "promotions", label: "Promotions", group: "Insights", allowed: capability("promotions") },
  { key: "notifications", label: "Notifications", group: "Account", allowed: () => true },
  { key: "administration", label: "Administration", group: "Manage", allowed: roles([0]) },
  { key: "profile", label: "My account", group: "Account", allowed: () => true },
]);
export function navigationFor(identity) {
  return MODULES.filter((module) => module.allowed(identity)).map((module) => ({ ...module, href: `/squad/${module.key}` }));
}
export function canVisit(identity, path) {
  const key = path.replace(/^\/squad\/?/, "").split("/")[0] || "home";
  return MODULES.find((module) => module.key === key)?.allowed(identity) === true;
}
