import {
  filterDispatchActiveOrders,
  filterDispatchOrders,
  filterDispatchProcessedOrders,
  filterPrintingDepartmentOrders,
  isProductionTrackerOrder
} from "./orderTabUtils";
import { isJobSheetOrder } from "./jobSheetUtils";
import { isSampleJobSheetOrder } from "./sampleJobSheetUtils";
import { sampleJobSheetIsClosed } from "./sampleJobSheetStages";
import { formatOcCreatedAt, ocTransportLabel } from "./outwardChallanUtils";
import { splitOrderIds, STAGE_LABEL } from "./orderViewUtils";
import { stageLabelForOrder } from "./stickerOrderUtils";

const MAX_SUGGESTIONS = 24;

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function orderMatchesGlobalQuery(order, query) {
  const q = norm(query);
  if (!q) return false;
  const hay = [
    order.order_id,
    order.customer_name,
    order.coordinator_name,
    order.product_name,
    order.owner_name,
    order.status,
    STAGE_LABEL[order.status],
    stageLabelForOrder(order, order.status),
    String(order.id)
  ]
    .map(norm)
    .join(" ");
  return hay.includes(q);
}

function contactMatchesGlobalQuery(contact, query) {
  const q = norm(query);
  if (!q) return false;
  const hay = [
    contact.name,
    contact.email,
    contact.department,
    contact.designation,
    contact.contact_number,
    contact.alternate_contact_number,
    String(contact.id)
  ]
    .map(norm)
    .join(" ");
  return hay.includes(q);
}

function outwardMatchesGlobalQuery(record, query) {
  const q = norm(query);
  if (!q) return false;
  const hay = [
    record.id,
    record.sender,
    record.product_material,
    record.purpose,
    record.sent_to,
    record.receiver_name,
    record.sender_contact,
    record.receiver_contact,
    record.quantity,
    record.bora_carton_count,
    ocTransportLabel(record.mode_of_transport),
    formatOcCreatedAt(record)
  ]
    .map(norm)
    .join(" ");
  return hay.includes(q) || String(record.id ?? "").includes(q.replace(/\D/g, ""));
}

function orderTitle(order) {
  const ids = splitOrderIds(order.order_id);
  if (ids.length) return ids.join(", ");
  return `Order #${order.id}`;
}

function orderSubtitle(order) {
  const bits = [
    order.customer_name?.trim(),
    order.product_name?.trim(),
    order.coordinator_name?.trim() ? `Coord: ${order.coordinator_name.trim()}` : ""
  ].filter(Boolean);
  return bits.join(" · ") || "—";
}

function pushOrderHit(suggestions, order, hit) {
  suggestions.push({
    id: `order-${order.id}-${hit.tabId}-${hit.dispatchSubview ?? "x"}-${hit.productionSubTab ?? "x"}-${hit.trackerListTab ?? "x"}`,
    kind: "order",
    tabId: hit.tabId,
    areaLabel: hit.areaLabel,
    contextLine: hit.contextLine,
    badgeTone: hit.badgeTone,
    title: orderTitle(order),
    subtitle: orderSubtitle(order),
    meta: stageLabelForOrder(order, order.status),
    order,
    dispatchSubview: hit.dispatchSubview ?? null,
    productionSubTab: hit.productionSubTab ?? null,
    trackerListTab: hit.trackerListTab ?? null
  });
}

function buildOrderHits(order, canAccessTab) {
  const hits = [];
  const orderKind = order.order_kind ?? "printing";
  const statusLabel = stageLabelForOrder(order, order.status);

  if (canAccessTab("printing") && !isJobSheetOrder(order) && !isSampleJobSheetOrder(order)) {
    hits.push({
      tabId: "printing",
      areaLabel: "Printing Orders",
      contextLine: order.is_complete ? "Complete list" : "Active jobs",
      badgeTone: "printing"
    });
  }

  if (canAccessTab("printing_department") && filterPrintingDepartmentOrders([order]).length) {
    hits.push({
      tabId: "printing_department",
      areaLabel: "Print Queue",
      contextLine: `Floor queue · ${statusLabel}`,
      badgeTone: "printing-dept"
    });
  }

  if (canAccessTab("billing")) {
    hits.push({
      tabId: "billing",
      areaLabel: "Billing",
      contextLine: "Invoices & payment",
      badgeTone: "billing"
    });
  }

  if (canAccessTab("production_tracker") && isProductionTrackerOrder(order)) {
    hits.push({
      tabId: "production_tracker",
      areaLabel: "Production tracker",
      contextLine: order.is_complete ? "Complete orders" : "Production job",
      badgeTone: "production",
      productionSubTab: "production",
      trackerListTab: order.is_complete ? "complete" : "active"
    });
  }

  if (canAccessTab("production_tracker") && isSampleJobSheetOrder(order)) {
    const sampleClosed = sampleJobSheetIsClosed(order);
    hits.push({
      tabId: "production_tracker",
      areaLabel: "Sampling Tracker",
      contextLine: sampleClosed ? "Complete orders" : "Sample order",
      badgeTone: "production",
      productionSubTab: "sampling",
      trackerListTab: sampleClosed ? "complete" : "active"
    });
  }

  if (canAccessTab("dispatch")) {
    if (orderKind === "regular_stock") {
      if (filterDispatchActiveOrders([order]).length) {
        hits.push({
          tabId: "dispatch",
          dispatchSubview: "inward",
          areaLabel: "Dispatch",
          contextLine: "Inward · Regular stock",
          badgeTone: "dispatch"
        });
      }
      if (filterDispatchProcessedOrders([order]).length) {
        hits.push({
          tabId: "dispatch",
          dispatchSubview: "outward",
          areaLabel: "Dispatch",
          contextLine: "Outward · Dispatched stock",
          badgeTone: "dispatch"
        });
      }
      hits.push({
        tabId: "dispatch",
        dispatchSubview: "regular_stock",
        areaLabel: "Dispatch",
        contextLine: "Regular stock list",
        badgeTone: "dispatch"
      });
    } else if (filterDispatchOrders([order]).length) {
      hits.push({
        tabId: "dispatch",
        dispatchSubview: "printing",
        areaLabel: "Dispatch",
        contextLine: "Printing order · Verify",
        badgeTone: "dispatch"
      });
    }
  }

  return hits;
}

/**
 * Cross-department search suggestions for the header search box.
 */
export function buildGlobalSearchSuggestions({
  query,
  orders = [],
  outwardChallans = [],
  contacts = [],
  canAccessTab = () => true
}) {
  const q = String(query ?? "").trim();
  if (!q) return [];

  const suggestions = [];

  for (const order of orders) {
    if (!orderMatchesGlobalQuery(order, q)) continue;
    const hits = buildOrderHits(order, canAccessTab);
    for (const hit of hits) {
      pushOrderHit(suggestions, order, hit);
      if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
    }
  }

  if (canAccessTab("dispatch")) {
    for (const record of outwardChallans) {
      if (!outwardMatchesGlobalQuery(record, q)) continue;
      suggestions.push({
        id: `oc-${record.id}`,
        kind: "outward_challan",
        tabId: "dispatch",
        areaLabel: "Dispatch",
        contextLine: "Outward challan (OC)",
        badgeTone: "outward",
        title: `OC #${record.id}`,
        subtitle: [record.sender, record.sent_to, record.product_material]
          .map((v) => String(v ?? "").trim())
          .filter(Boolean)
          .join(" · ") || "—",
        meta: formatOcCreatedAt(record),
        outwardChallan: record,
        dispatchSubview: "outward"
      });
      if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
    }
  }

  if (canAccessTab("contact_book")) {
    for (const contact of contacts) {
      if (!contactMatchesGlobalQuery(contact, q)) continue;
      suggestions.push({
        id: `contact-${contact.id}`,
        kind: "contact",
        tabId: "contact_book",
        areaLabel: "Contact Book",
        contextLine: contact.department?.trim() || "Team contact",
        badgeTone: "contact",
        title: contact.name?.trim() || "Contact",
        subtitle: [contact.designation, contact.email, contact.contact_number]
          .map((v) => String(v ?? "").trim())
          .filter(Boolean)
          .join(" · ") || "—",
        meta: contact.department?.trim() || "—",
        contact
      });
      if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
    }
  }

  return suggestions;
}
