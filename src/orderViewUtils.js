/** Status options shown in create form and manual status dropdowns. */
export const FORM_STAGES = [
  "new",
  "approval_pending",
  "in_production",
  "printing",
  "fusing",
  "ironing",
  "packing",
  "pending",
  "on_hold",
  "ready",
  "sent_to_dispatch"
];

/** @deprecated Use FORM_STAGES in forms; kept for pipeline summary counts. */
export const STAGES = FORM_STAGES;

/** Set only via Dispatch verification (hidden from forms). */
export const DISPATCH_WORKFLOW_STATUSES = ["dispatch_fail", "dispatched"];

export const STAGE_LABEL = {
  new: "New Orders",
  approval_pending: "Approval Pending",
  in_production: "In Production",
  printing: "Printing",
  fusing: "Fusing",
  ironing: "Ironing",
  packing: "Packing",
  pending: "Pending",
  on_hold: "On hold",
  ready: "Ready to Dispatch",
  sent_to_dispatch: "Sent to Dispatch",
  dispatch_fail: "Dispatch Fail",
  dispatched: "Dispatched"
};

export const STAGE_OPTION_ICON = {
  new: "🆕",
  approval_pending: "📋",
  in_production: "🧵",
  printing: "🖨️",
  fusing: "🟧",
  ironing: "♨️",
  packing: "📦",
  pending: "⏳",
  on_hold: "⚠",
  ready: "✅",
  sent_to_dispatch: "🚚",
  dispatch_fail: "⛔",
  dispatched: "📤"
};

export const ORDER_SIZE_COLUMNS = [
  { key: "XS", label: "XS" },
  { key: "S", label: "S" },
  { key: "M", label: "M" },
  { key: "L", label: "L" },
  { key: "XL", label: "XL" },
  { key: "2XL", label: "2XL" },
  { key: "3XL", label: "3XL" }
];

export function splitOrderIds(orderIdValue) {
  const raw = String(orderIdValue ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,\n;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  // keep order, dedupe
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export const EDITABLE_FIELD_OPTIONS = [
  { key: "status", label: "Status" },
  { key: "remarks", label: "Remarks" },
  { key: "due_date", label: "Delivery Date" },
  { key: "qty", label: "Qty" },
  { key: "coordinator_name", label: "Coordinator" },
  { key: "printing_mtrs", label: "Printing Mtrs" },
  { key: "payment_method", label: "Payment method" },
  { key: "approved_design_images", label: "Approved design images" },
  { key: "received_at_printing", label: "Received date/time to printing" }
];

export const POST_DESIGN_REVIEW = {
  PENDING: "pending",
  APPROVED: "approved",
  NEEDS_CHANGES: "needs_changes"
};

function normalizeDesignUrlEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry.trim() || null;
  if (typeof entry === "object" && typeof entry.url === "string") {
    return entry.url.trim() || null;
  }
  return null;
}

export function mergeDesignUrlLists(...sources) {
  const seen = new Set();
  const urls = [];
  for (const src of sources) {
    for (const url of parseDesignUrls(src)) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

export function serializeDesignUrls(urls) {
  if (!urls?.length) return null;
  return JSON.stringify(urls);
}

export function filesFromImageInput(fileList) {
  return Array.from(fileList ?? []).filter((f) => {
    if (!f || f.size <= 0) return false;
    const type = (f.type || "").toLowerCase();
    const name = f.name || "";
    if (type.startsWith("image/")) return true;
    if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?)$/i.test(name)) return true;
    // macOS / Chrome sometimes leave type empty for valid PNG/JPG from picker
    if (!type && name) return true;
    return false;
  });
}

export function mergeOrdersPreservingDesignImages(prevRows, serverRows, recentPatches) {
  const prevById = new Map((prevRows ?? []).map((o) => [String(o.id), o]));
  const now = Date.now();
  return (serverRows ?? []).map((row) => {
    const key = String(row.id);
    const patch = recentPatches?.[key];
    if (patch && now - patch.at < 20000) {
      const remoteCount = parseDesignUrls(row.approved_design_images).length;
      const localCount = parseDesignUrls(patch.approved_design_images).length;
      if (localCount > remoteCount) {
        return { ...row, ...patch.fields };
      }
    }
    const prevRow = prevById.get(key);
    if (prevRow) {
      const prevCount = parseDesignUrls(prevRow.approved_design_images).length;
      const remoteCount = parseDesignUrls(row.approved_design_images).length;
      if (prevCount > remoteCount) {
        return {
          ...row,
          approved_design_images: prevRow.approved_design_images,
          post_approved_design_review_status:
            prevRow.post_approved_design_review_status ?? row.post_approved_design_review_status,
          post_approved_design_changes_note:
            prevRow.post_approved_design_changes_note ?? row.post_approved_design_changes_note,
          post_approved_design_reviewed_by:
            prevRow.post_approved_design_reviewed_by ?? row.post_approved_design_reviewed_by,
          post_approved_design_reviewed_at:
            prevRow.post_approved_design_reviewed_at ?? row.post_approved_design_reviewed_at
        };
      }
    }
    return row;
  });
}

export function parseDesignUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeDesignUrlEntry).filter(Boolean);
  }
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeDesignUrlEntry).filter(Boolean);
    }
    const one = normalizeDesignUrlEntry(parsed);
    if (one) return [one];
  } catch (_e) {
    // fallback to plain text parsing
  }

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

export function userIsSalesReviewer(profile, isAdmin) {
  if (isAdmin) return true;
  const dept = (profile?.department ?? "").trim().toLowerCase();
  return dept === "sales" || dept.includes("sales");
}

export function effectivePostDesignReviewStatus(order) {
  const urls = parseDesignUrls(order?.approved_design_images);
  if (!urls.length) return null;
  return order?.post_approved_design_review_status || POST_DESIGN_REVIEW.PENDING;
}

export function formatDeliveryDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

export function formatReceivedAtDisplay(iso) {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Size rows with qty for dispatch verification UI. */
export function getDispatchSizeRows(sizeBreakdown) {
  if (!sizeBreakdown || typeof sizeBreakdown !== "object") return [];
  const standardKeys = new Set(ORDER_SIZE_COLUMNS.map(({ key }) => key));
  const rows = [];
  for (const { key, label } of ORDER_SIZE_COLUMNS) {
    const n = Number(sizeBreakdown[key]);
    if (Number.isFinite(n) && n > 0) rows.push({ key, label, qty: n });
  }
  for (const [key, val] of Object.entries(sizeBreakdown)) {
    if (standardKeys.has(key)) continue;
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) rows.push({ key, label: key, qty: n });
  }
  return rows;
}

export function formatSizeBreakdownSummary(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return "—";
  const standardKeys = new Set(ORDER_SIZE_COLUMNS.map(({ key }) => key));
  const parts = [];
  for (const { key, label } of ORDER_SIZE_COLUMNS) {
    const n = Number(breakdown[key]);
    if (Number.isFinite(n) && n > 0) parts.push(`${label}×${n}`);
  }
  for (const [key, val] of Object.entries(breakdown)) {
    if (standardKeys.has(key)) continue;
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) parts.push(`${key}×${n}`);
  }
  return parts.length ? parts.join(", ") : "—";
}

export function receivedAtToDatetimeLocalValue(iso) {
  if (iso == null || String(iso).trim() === "") return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
