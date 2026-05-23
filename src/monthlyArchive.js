import { deliveryMethodLabel, paymentMethodLabel } from "./orderTabUtils";
import {
  formatSizeBreakdownSummary,
  parseDesignUrls,
  STAGE_LABEL
} from "./orderViewUtils";

const BUCKET = "approved-designs";

export function toLocalDateInputValue(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM` for month picker input */
export function toMonthInputValue(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** First and last calendar day of previous month (local). */
export function getPreviousMonthRange() {
  const now = new Date();
  const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastPrev = new Date(firstThisMonth);
  lastPrev.setDate(0);
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return {
    month: toMonthInputValue(firstPrev),
    start: toLocalDateInputValue(firstPrev),
    end: toLocalDateInputValue(lastPrev)
  };
}

export function monthInputToRange(monthValue) {
  const [y, m] = monthValue.split("-").map(Number);
  if (!y || !m) return { start: "", end: "" };
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function periodRangeToQueryIsos(periodStart, periodEnd) {
  const d = new Date(`${periodEnd}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return {
    startIso: new Date(`${periodStart}T00:00:00`).toISOString(),
    endIso: d.toISOString()
  };
}

export function storagePathFromPublicUrl(url) {
  if (!url || typeof url !== "string") return null;
  const marker = `/object/public/${BUCKET}/`;
  let idx = url.indexOf(marker);
  if (idx === -1) {
    idx = url.indexOf(`/${BUCKET}/`);
    if (idx === -1) return null;
    return decodeURIComponent(url.slice(idx + BUCKET.length + 2).split("?")[0]);
  }
  return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
}

export function collectStoragePathsForOrder(order) {
  const paths = new Set();
  for (const url of parseDesignUrls(order.approved_design_url)) {
    const p = storagePathFromPublicUrl(url);
    if (p) paths.add(p);
  }
  for (const url of parseDesignUrls(order.approved_design_images)) {
    const p = storagePathFromPublicUrl(url);
    if (p) paths.add(p);
  }
  for (const url of parseDesignUrls(order.approved_design_images_archive)) {
    const p = storagePathFromPublicUrl(url);
    if (p) paths.add(p);
  }
  return [...paths];
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  return res.blob();
}

function extFromUrl(url, fallback = "jpg") {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : fallback;
  } catch {
    return fallback;
  }
}

/** Folder name = Order ID (customer-facing); fallback job id; dedupe collisions. */
export function orderArchiveFolderName(order, usedNames) {
  const base = order.order_id?.trim()
    ? String(order.order_id).trim().replace(/[^\w.-]+/g, "_")
    : `job-${order.id}`;
  let name = base;
  let n = 2;
  while (usedNames.has(name)) {
    name = `${base}_job${order.id}`;
    if (usedNames.has(name)) {
      name = `${base}_${n}`;
      n += 1;
    }
  }
  usedNames.add(name);
  return name;
}

function buildOrderDetailRows(order) {
  const colors = Array.isArray(order.colors) ? order.colors.join(", ") : "";
  return [
    ["Job # (internal)", order.id],
    ["Order number", order.order_id ?? ""],
    ["Order date", order.order_date ?? ""],
    ["Delivery date", order.due_date ?? ""],
    ["Owner", order.owner_name ?? ""],
    ["Customer name", order.customer_name ?? ""],
    ["Coordinator", order.coordinator_name ?? ""],
    ["Quantity (total)", order.qty ?? ""],
    ["Sizes breakdown", formatSizeBreakdownSummary(order.size_breakdown)],
    ["Product name", order.product_name ?? ""],
    ["Colors", colors],
    ["Printing metres", order.printing_mtrs ?? ""],
    ["Status", STAGE_LABEL[order.status] ?? order.status ?? ""],
    ["Remarks", order.remarks ?? ""],
    ["Production order", order.is_production_order ? "Yes" : "No"],
    ["Expected handover to printing", order.expected_handover_to_printing ?? ""],
    ["Payment method", paymentMethodLabel(order.payment_method)],
    ["Delivery", deliveryMethodLabel(order.delivery_method)],
    ["Received at printing", order.received_at_printing ?? ""],
    ["Design review status", order.post_approved_design_review_status ?? ""],
    ["Design changes note", order.post_approved_design_changes_note ?? ""],
    ["Marked complete", order.is_complete ? "Yes" : "No"],
    ["Created at", order.created_at ?? ""]
  ];
}

async function writeOrderFolderArchive({
  ExcelJS,
  orderFolder,
  order,
  historyEntries,
  onProgress,
  index,
  total
}) {
  onProgress?.(`Order ${index + 1} / ${total}: ${order.order_id?.trim() || order.id}…`);

  const mockupsDir = orderFolder.folder("mockups");
  const approvedDir = orderFolder.folder("approved-designs");

  const mockupUrls = parseDesignUrls(order.approved_design_url);
  for (let m = 0; m < mockupUrls.length; m++) {
    const url = mockupUrls[m];
    const ext = extFromUrl(url, "jpg");
    const name = `mockup-${String(m + 1).padStart(2, "0")}.${ext}`;
    try {
      const blob = await fetchBlob(url);
      mockupsDir.file(name, blob);
    } catch {
      mockupsDir.file(`mockup-${String(m + 1).padStart(2, "0")}-FAILED.txt`, `Could not download: ${url}`);
    }
  }

  const approvedUrls = parseDesignUrls(order.approved_design_images);
  for (let a = 0; a < approvedUrls.length; a++) {
    const url = approvedUrls[a];
    const ext = extFromUrl(url, "jpg");
    const name = `approved-${String(a + 1).padStart(2, "0")}.${ext}`;
    try {
      const blob = await fetchBlob(url);
      approvedDir.file(name, blob);
    } catch {
      approvedDir.file(
        `approved-${String(a + 1).padStart(2, "0")}-FAILED.txt`,
        `Could not download: ${url}`
      );
    }
  }

  const archivedUrls = parseDesignUrls(order.approved_design_images_archive);
  if (archivedUrls.length) {
    const archivedDir = approvedDir.folder("archived-superseded");
    for (let a = 0; a < archivedUrls.length; a++) {
      const url = archivedUrls[a];
      const ext = extFromUrl(url, "jpg");
      const name = `archived-${String(a + 1).padStart(2, "0")}.${ext}`;
      try {
        const blob = await fetchBlob(url);
        archivedDir.file(name, blob);
      } catch {
        archivedDir.file(
          `archived-${String(a + 1).padStart(2, "0")}-FAILED.txt`,
          `Could not download: ${url}`
        );
      }
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Printing Live Tracker";
  workbook.created = new Date();

  const detailsSheet = workbook.addWorksheet("Job details");
  detailsSheet.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 48 }
  ];
  for (const [field, value] of buildOrderDetailRows(order)) {
    detailsSheet.addRow({ field, value: value ?? "" });
  }

  const historySheet = workbook.addWorksheet("Order history");
  historySheet.columns = [
    { header: "When", key: "created_at", width: 22 },
    { header: "Event", key: "event_type", width: 24 },
    { header: "Message", key: "message", width: 52 },
    { header: "By", key: "actor_label", width: 20 }
  ];
  if (historyEntries.length) {
    for (const entry of historyEntries) {
      historySheet.addRow({
        created_at: entry.created_at,
        event_type: entry.event_type,
        message: entry.message,
        actor_label: entry.actor_label
      });
    }
  } else {
    historySheet.addRow({
      created_at: "",
      event_type: "",
      message: "(No history recorded for this job)",
      actor_label: ""
    });
  }

  const xlsxBuffer = await workbook.xlsx.writeBuffer();
  orderFolder.file("order-details.xlsx", xlsxBuffer);
}

/**
 * Monthly ZIP: one folder per Order ID with mockups/, approved-designs/, order-details.xlsx.
 */
export async function buildAndDownloadMonthlyArchive({
  supabase,
  periodStart,
  periodEnd,
  monthLabel,
  onProgress
}) {
  const [{ default: ExcelJS }, { default: JSZip }] = await Promise.all([
    import("exceljs"),
    import("jszip")
  ]);

  onProgress?.("Loading orders for selected month…");
  const { startIso, endIso } = periodRangeToQueryIsos(periodStart, periodEnd);

  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select(
      "id, order_id, order_date, due_date, owner_name, customer_name, coordinator_name, qty, size_breakdown, product_name, colors, approved_design_url, approved_design_images, approved_design_images_archive, post_approved_design_review_status, post_approved_design_changes_note, printing_mtrs, status, remarks, created_at, is_complete, is_production_order, expected_handover_to_printing, received_at_printing, payment_method, delivery_method"
    )
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });

  if (ordersErr) throw new Error(ordersErr.message);
  const list = orders ?? [];

  const historyByOrderId = {};
  let activityCount = 0;
  if (list.length) {
    onProgress?.("Loading order history…");
    const ids = list.map((o) => o.id);
    const { data: logs, error: logErr } = await supabase
      .from("order_activity_log")
      .select("id, order_id, event_type, message, actor_label, created_at")
      .in("order_id", ids)
      .neq("event_type", "mockups_uploaded")
      .order("created_at", { ascending: true });
    if (logErr) throw new Error(logErr.message);
    for (const entry of logs ?? []) {
      if (!historyByOrderId[entry.order_id]) historyByOrderId[entry.order_id] = [];
      historyByOrderId[entry.order_id].push(entry);
      activityCount += 1;
    }
  }

  const zipLabel = monthLabel || `${periodStart}_to_${periodEnd}`;
  const zip = new JSZip();
  const root = zip.folder(`monthly-archive_${zipLabel}`);
  const usedFolderNames = new Set();

  const indexWorkbook = new ExcelJS.Workbook();
  const indexSheet = indexWorkbook.addWorksheet("Archive index");
  indexSheet.columns = [
    { header: "Order ID folder", key: "folder", width: 18 },
    { header: "Job #", key: "id", width: 10 },
    { header: "Customer", key: "customer", width: 20 },
    { header: "Delivery date", key: "due", width: 14 },
    { header: "Status", key: "status", width: 18 }
  ];

  for (let i = 0; i < list.length; i++) {
    const order = list[i];
    const folderName = orderArchiveFolderName(order, usedFolderNames);
    const orderFolder = root.folder(folderName);
    const history = historyByOrderId[order.id] ?? [];

    await writeOrderFolderArchive({
      ExcelJS,
      orderFolder,
      order,
      historyEntries: history,
      onProgress,
      index: i,
      total: list.length
    });

    indexSheet.addRow({
      folder: folderName,
      id: order.id,
      customer: order.customer_name,
      due: order.due_date,
      status: STAGE_LABEL[order.status] ?? order.status
    });
  }

  onProgress?.("Building archive index…");
  const indexBuffer = await indexWorkbook.xlsx.writeBuffer();
  root.file("archive-index.xlsx", indexBuffer);
  root.file(
    "README.txt",
    [
      "Printing Live Tracker — monthly archive",
      `Period: ${periodStart} to ${periodEnd} (jobs by created_at)`,
      "",
      "Each subfolder is named by Order ID and contains:",
      "  mockups/           — images uploaded when the job was created",
      "  approved-designs/  — post-approved design uploads",
      "  order-details.xlsx — Job details + Order history sheets",
      "",
      "archive-index.xlsx — list of all order folders in this archive",
      "",
      "Save this ZIP to your PC or NAS before purging from Supabase.",
      `Generated: ${new Date().toISOString()}`
    ].join("\n")
  );

  onProgress?.("Creating ZIP download…");
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `monthly-archive_${zipLabel}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  return {
    orderCount: list.length,
    activityCount,
    orderIds: list.map((o) => o.id),
    orders: list
  };
}

/** Remove archived jobs and their storage files from Supabase (admin only). */
export async function purgeArchivedOrdersFromCloud(supabase, orders) {
  const allPaths = new Set();
  for (const order of orders) {
    for (const p of collectStoragePathsForOrder(order)) allPaths.add(p);
  }
  const paths = [...allPaths];
  if (paths.length) {
    const chunk = 50;
    for (let i = 0; i < paths.length; i += chunk) {
      const slice = paths.slice(i, i + chunk);
      const { error } = await supabase.storage.from(BUCKET).remove(slice);
      if (error) throw new Error(`Storage delete: ${error.message}`);
    }
  }
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    const { error } = await supabase.from("orders").delete().in("id", ids);
    if (error) throw new Error(`Database delete: ${error.message}`);
  }
  return { deletedOrders: ids.length, deletedFiles: paths.length };
}
