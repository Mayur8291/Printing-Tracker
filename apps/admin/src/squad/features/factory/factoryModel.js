// Flutter TailorsView / DeliveryView / drawer parity. Pure.
/** Cutting Master sub-tab and add buttons are Factory Manager only (Flutter isCuttingMaster gating); dispatch/inspector see tailors. */
export function tailorTabs(role) {
  const tailors = { key: "tailors", label: "Tailors", role: 5, empty: "No Tailor Found", add: "Add tailor", canAdd: [4].includes(Number(role)) };
  return Number(role) === 4 ? [tailors, { key: "cutting", label: "Cutting Master", role: 9, empty: "No Cutting Master Found", add: "Add cutting master", canAdd: true }] : [tailors];
}
export const deliveryTabs = () => [
  { key: "dispatch", label: "Dispatch In Charge", role: 7, empty: "No Dispatch In Charge Found", add: "Add dispatch in charge" },
  { key: "inspector", label: "Inspector", role: 8, empty: "No Inspector Found", add: "Add inspector" },
];
/** Dispatch incharge and cutting master get the Flutter counter strip over their queue. */
export const queueCounterRoles = [7, 9];
