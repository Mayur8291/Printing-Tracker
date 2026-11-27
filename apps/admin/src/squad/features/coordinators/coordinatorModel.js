// Admin "Sales Co-ord." / "Prod. Co-ord." tabs (Flutter AdminSCView / AdminPCView).
export const KINDS = Object.freeze({
  sales: { slug: "sales", role: 1, subject: "sales_coordinator", title: "Sales Co-ordinator", plural: "Sales Co-ordinators", empty: "No Sales Co added at the moment", add: "Add SC" },
  factory: { slug: "factory", role: 4, subject: "factory", title: "Factory", plural: "Factories", empty: "No Factories added at the moment", add: "Add factory", addRoles: [0, 2] },
  production: { slug: "production", role: 2, subject: "production_coordinator", title: "Production Co-ordinator", plural: "Production Co-ordinators", empty: "No Production Co added at the moment", add: "Add PC" },
});
/** /squad/coordinators/<sales|production>[/<id>] -> {kind, id} or null. */
export function parseCoordinatorPath(path = "") {
  const m = path.match(/^\/squad\/coordinators\/(sales|production|factory)(?:\/([1-9]\d{0,18}))?\/?$/);
  return m ? { kind: KINDS[m[1]], id: m[2] ?? null } : null;
}
/** Flutter: only Admin may add a coordinator (SC FAB hidden for others; PC list is admin-only). */
export const canAddCoordinator = (identity, kind) => (kind?.addRoles ?? [0]).includes(Number(identity?.role));
/** Flutter: Production Coordinator sees Sales Co-ord. and Factory; only Admin sees Production Co-ord. */
export const canViewKind = (identity, kind) => Number(identity?.role) === 0 || (Number(identity?.role) === 2 && kind.slug !== "production");
