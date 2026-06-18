import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MockupStudio from "./MockupStudio";
import CoordinatorReportPanel from "./CoordinatorReportPanel";
import ProductRevenuePanel from "./ProductRevenuePanel";
import OrderDetailPanel from "./OrderDetailPanel";
import MonthlyArchivePanel from "./MonthlyArchivePanel";
import LinkedOrdersTabPanel from "./LinkedOrdersTabPanel";
import TeamChatPanel from "./TeamChatPanel";
import ContactBookPanel from "./ContactBookPanel";
import SharedLinksPanel from "./SharedLinksPanel";
import PrintingDepartmentPanel from "./PrintingDepartmentPanel";
import BillingTabPanel from "./BillingTabPanel";
import DispatchTabPanel from "./DispatchTabPanel";
import GlobalSearchBox from "./GlobalSearchBox";
import { OC_SELECT_FIELDS } from "./outwardChallanUtils";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";
import {
  ADMIN_DASHBOARD_TAB,
  DASHBOARD_SIDEBAR,
  DASHBOARD_SIDEBAR_FOOTER,
  DASHBOARD_SIDEBAR_MAIN,
  DASHBOARD_SIDEBAR_MAIN_SECTIONS,
  DASHBOARD_SIDEBAR_SOON_TAB_IDS
} from "./dashboardSidebarConfig";
import { DashboardSidebarIcon } from "./dashboardSidebarIcons";
import SidebarTabPermissionFields from "./SidebarTabPermissionFields";
import ViewerUserEditModal, { IconUserDelete, IconUserEdit } from "./ViewerUserEditModal";
import { filterViewerProfiles, viewerIsActive } from "./viewerUserListUtils";
import AssignmentToastStack from "./AssignmentToastStack";
import NotificationBellButton from "./NotificationBellButton";
import NotificationsPanel from "./NotificationsPanel";
import { NOTIFICATIONS_DASHBOARD_TAB } from "./notificationsUtils";
import AdminDeployPanel from "./AdminDeployPanel";
import CreateJobSheetForm from "./CreateJobSheetForm";
import DistributorTabPanel from "./DistributorTabPanel";
import InventoryTabPanel from "./InventoryTabPanel";
import {
  computeNextJobSheetOrderId,
  emptyJobSheetForm,
  jobSheetSizesToBreakdown,
  parseJobSheetRate,
  parseJobSheetSizeQty,
  sumJobSheetSizes
} from "./jobSheetUtils";
import { getDeployEnvironment, shouldShowAdminDeployTools } from "./deployEnvironmentUtils";
import {
  buildProfileLookupList,
  createCoordinatorSelectOptions,
  profileDisplayName
} from "./coordinatorSelectUtils";
import { insertOrderAssignmentNotification } from "./orderAssignmentNotificationUtils";
import {
  DELIVERY_METHODS,
  PAYMENT_METHODS,
  deliveryMethodLabel,
  filterBillingOrders,
  dispatchRowHighlightClass,
  filterDispatchOrders,
  filterOrdersBySearch,
  isDispatchVerificationFailed,
  filterOrdersInDateRange,
  filterProductionTrackerOrders,
  parsePaymentProofUrls,
  paymentMethodLabel,
  paymentMethodRequiresProof,
  serializePaymentProofUrls,
  sortOrdersNewestFirst
} from "./orderTabUtils";
import { invokeAdminEdgeFunction } from "./edgeFunctionUtils";
import { supabase } from "./supabaseClient";
import {
  buildAdminOrderDraftFromOrder,
  buildAdminOrderFieldsPayload
} from "./orderAdminEditUtils";
import {
  downloadLocalFile,
  uploadOrderCustomerAssets
} from "./orderCustomerAssets";
import {
  allowedDashboardTabsFromFlags,
  defaultSidebarTabFlags,
  editableDashboardTabsFromFlags,
  filterSidebarItemsForViewer,
  firstAllowedDashboardTabId,
  hydrateSidebarEditTabFlagsFromPermission,
  hydrateSidebarTabFlagsFromPermission,
  viewerCanAccessDashboardTab,
  viewerCanEditDashboardTab
} from "./dashboardSidebarPermissions";
import {
  EDITABLE_FIELD_OPTIONS,
  ORDER_SIZE_COLUMNS,
  POST_DESIGN_REVIEW,
  STAGES,
  STAGE_LABEL,
  STAGE_OPTION_ICON,
  effectivePostDesignReviewStatus,
  filesFromImageInput,
  formatDeliveryDate,
  formatReceivedAtDisplay,
  formatSizeBreakdownSummary,
  splitOrderIds,
  mergeDesignUrlLists,
  mergeOrdersPreservingDesignImages,
  parseDesignUrls,
  receivedAtToDatetimeLocalValue,
  serializeDesignUrls,
  userIsSalesReviewer
} from "./orderViewUtils";

const STAGE_ICON = {
  new: "🆕",
  approval_pending: "📋",
  in_production: "🧵",
  printing: "🖨️",
  fusing: "🟧",
  ironing: "/icons/ironing.png",
  packing: "📦",
  pending: "/icons/pending.png",
  on_hold: null,
  ready: "✅",
  sent_to_dispatch: "🚚",
  dispatch_fail: "⛔",
  dispatched: "📤"
};

/**
 * New → pending: 12h for all jobs; 10min when delivery date is same day or next day as order date
 * (see DB `promote_stale_new_orders_to_pending` + cron).
 */
const SLA_NEW_TO_PENDING_MS = 12 * 60 * 60 * 1000;

function staticAssetUrl(relPath) {
  const base = import.meta.env.BASE_URL ?? "/";
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${relPath.replace(/^\//, "")}`;
}

const TONE_DEFAULT_STATUS = "sounds/tone-01.mp3";
const TONE_READY_STATUS = "sounds/Tone-02.mp3";
const TONE_READY_OVERDUE = "sounds/Tone-03.mp3";
const READY_DISPATCH_SLA_MS = 48 * 60 * 60 * 1000;
const READY_OVERDUE_TONE_INTERVAL_MS = 5 * 60 * 1000;

const toneAudioCache = new Map();
const tonePrimed = new Set();

/** Status changed while tab hidden — play once when user returns. */
let pendingStatusTone = false;
let pendingStatusToneReady = false;

/** When true (admin role), no status / overdue tones play. */
let muteStatusTones = false;

function resolveToneUrl(file) {
  try {
    return new URL(staticAssetUrl(file), window.location.href).href;
  } catch {
    return staticAssetUrl(file);
  }
}

function getToneAudio(file) {
  if (!toneAudioCache.has(file)) {
    const el = new Audio(resolveToneUrl(file));
    el.preload = "auto";
    toneAudioCache.set(file, el);
  }
  return toneAudioCache.get(file);
}

/** Call once after a user gesture so autoplay policy allows tones later. */
function primeStatusToneFromUserGesture() {
  for (const file of [TONE_DEFAULT_STATUS, TONE_READY_STATUS, TONE_READY_OVERDUE]) {
    if (tonePrimed.has(file)) continue;
    try {
      const el = getToneAudio(file);
      el.volume = 0.001;
      void el
        .play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.volume = 1;
          tonePrimed.add(file);
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

function playTone(file) {
  try {
    const tryPlay = (el) => {
      if (!el) return Promise.reject(new Error("no audio"));
      el.volume = 1;
      el.pause();
      el.currentTime = 0;
      return el.play();
    };

    const cached = getToneAudio(file);
    const p = tryPlay(cached);
    if (p) {
      void p.catch(() => {
        try {
          const fresh = new Audio(resolveToneUrl(file));
          fresh.preload = "auto";
          fresh.volume = 1;
          void fresh.play().catch(() => {});
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    try {
      const fresh = new Audio(resolveToneUrl(file));
      fresh.volume = 1;
      void fresh.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

/** Tone-02 only when status becomes Ready to Dispatch; Tone-01 for all other status changes. */
function playOrderStatusChangeTone(isReadyToDispatch) {
  if (muteStatusTones) return;
  playTone(isReadyToDispatch ? TONE_READY_STATUS : TONE_DEFAULT_STATUS);
}

function playReadyDispatchOverdueTone() {
  if (muteStatusTones) return;
  playTone(TONE_READY_OVERDUE);
}

function orderReadyOver48h(order) {
  if (order.is_complete || order.status !== "ready") return false;
  const readyAt = order.status_ready_at ? new Date(order.status_ready_at).getTime() : NaN;
  if (!Number.isFinite(readyAt)) return false;
  return Date.now() - readyAt >= READY_DISPATCH_SLA_MS;
}

function anyOrderReadyOver48h(orderList) {
  return orderList.some(orderReadyOver48h);
}

/** Rounded warning triangle with “!” — red, matches on-hold styling. */
function OnHoldWarningIcon({ className = "" }) {
  return (
    <svg
      className={`on-hold-warning-icon ${className}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden
    >
      <path
        fill="#dc2626"
        d="M12 2.25c-.55 0-1.05.32-1.28.82L2.28 17.82A1.5 1.5 0 003.5 20h17a1.5 1.5 0 001.22-2.18L13.28 3.07c-.23-.5-.73-.82-1.28-.82z"
      />
      <rect x="11" y="8" width="2" height="6" rx="1" fill="#fff8f0" />
      <circle cx="12" cy="17.25" r="1.2" fill="#fff8f0" />
    </svg>
  );
}

/** Local calendar date YYYY-MM-DD for the device (used as order date on create). */
function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptySizesForm() {
  return Object.fromEntries(ORDER_SIZE_COLUMNS.map(({ key }) => [key, ""]));
}

function parseSizeQtyInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function newExtraSizeRow() {
  return {
    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    label: "",
    qty: ""
  };
}

function sumSizeForm(sizes, extraSizes = []) {
  let total = ORDER_SIZE_COLUMNS.reduce((acc, { key }) => acc + parseSizeQtyInput(sizes?.[key]), 0);
  if (Array.isArray(extraSizes)) {
    for (const row of extraSizes) {
      total += parseSizeQtyInput(row?.qty);
    }
  }
  return total;
}

/** Build DB object: only positive integer counts (standard + custom size names). */
function sizesFormToBreakdown(sizes, extraSizes = []) {
  const out = {};
  for (const { key } of ORDER_SIZE_COLUMNS) {
    const n = parseSizeQtyInput(sizes?.[key]);
    if (n > 0) out[key] = n;
  }
  if (Array.isArray(extraSizes)) {
    for (const row of extraSizes) {
      const label = String(row?.label ?? "").trim().toUpperCase();
      if (!label) continue;
      const n = parseSizeQtyInput(row?.qty);
      if (n > 0) out[label] = (out[label] ?? 0) + n;
    }
  }
  return out;
}

/** Inverse of sizesFormToBreakdown: rebuild form rows from a saved order's size_breakdown. */
function sizeBreakdownToForm(breakdown) {
  const sizes = emptySizesForm();
  const extraSizes = [];
  if (!breakdown || typeof breakdown !== "object") return { sizes, extraSizes };
  const standardKeys = new Set(ORDER_SIZE_COLUMNS.map((c) => c.key));
  for (const [key, val] of Object.entries(breakdown)) {
    const n = parseSizeQtyInput(val);
    if (n <= 0) continue;
    if (standardKeys.has(key)) {
      sizes[key] = String(n);
    } else {
      extraSizes.push({
        id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        label: String(key),
        qty: String(n)
      });
    }
  }
  return { sizes, extraSizes };
}

function datetimeLocalToIsoOrNull(localStr) {
  const t = String(localStr ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const emptyOrder = {
  order_id: "",
  order_ids: [],
  order_kind: "printing",
  due_date: "",
  owner_name: "",
  customer_name: "",
  coordinator_name: "",
  sizes: emptySizesForm(),
  extraSizes: [],
  product_name: "",
  colors: [],
  printing_mtrs: "0.00",
  order_cost: "",
  printing_cost: "",
  remarks: "",
  is_production_order: false,
  expected_handover_to_printing: "",
  payment_method: "",
  delivery_method: ""
};

function parseMoneyInput(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function normalizeOrderIdToken(raw) {
  const onlyDigits = String(raw ?? "").replace(/\D/g, "");
  return onlyDigits.trim();
}

function parseOrderIdTokens(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const parts = s.split(/[\s,;]+/g).map(normalizeOrderIdToken).filter(Boolean);
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

function OrderIdBadges({ orderId }) {
  const ids = splitOrderIds(orderId);
  if (!ids.length) return "—";
  if (ids.length === 1) return ids[0];
  return (
    <span className="order-id-badges" aria-label="Order IDs">
      {ids.map((id) => (
        <span key={id} className="order-id-badge" title={id}>
          {id}
        </span>
      ))}
    </span>
  );
}

/** HSL (0–360, 0–100, 0–100) → #rrggbb for stable DB + CSV. */
function hslToHex(h, s, l) {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  let r;
  let g;
  let b;
  if (sat === 0) {
    r = g = b = light;
  } else {
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }
  const toHex = (x) =>
    Math.round(Math.min(255, Math.max(0, x * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
}

/** 8×8 swatches: top row greyscale, rows below = lighter → deeper per hue column. */
const ORDER_COLOR_PALETTE = (() => {
  const pal = [];
  for (let c = 0; c < 8; c += 1) {
    const L = Math.round((c / 7) * 100);
    pal.push(hslToHex(0, 0, L));
  }
  for (let r = 1; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const hue = (c * 360) / 8;
      const sat = 52 + (r % 4) * 10;
      const light = 84 - (r - 1) * 10;
      pal.push(hslToHex(hue, Math.min(100, sat), Math.max(12, Math.min(92, light))));
    }
  }
  return pal;
})();

function normalizeColorKey(c) {
  return String(c ?? "")
    .trim()
    .toLowerCase();
}

function isCssColorString(c) {
  const s = String(c ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || /^hsla?\(/i.test(s);
}

/** Background for swatch: hex/hsl as-is; otherwise try as CSS color keyword (e.g. orange, navy). */
function swatchBackgroundForColor(c) {
  const t = String(c ?? "").trim();
  if (!t) return "#cbd5e1";
  if (isCssColorString(t)) return t;
  return t;
}

function OrderColorsCell({ colors }) {
  if (!Array.isArray(colors) || !colors.length) return "-";
  return (
    <span className="order-colors-cell" role="list" aria-label="Colors">
      {colors.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="order-colors-cell__item"
          role="listitem"
          title={String(c)}
        >
          <span
            className="order-colors-cell__dot"
            style={{ backgroundColor: swatchBackgroundForColor(c) }}
            aria-hidden
          />
          <span className="order-colors-cell__sr-only">{String(c)}</span>
        </span>
      ))}
    </span>
  );
}

const ORDER_HISTORY_EVENT_LABELS = {
  order_created: "Job created",
  mockups_uploaded: "Mockups uploaded",
  status_changed: "Status update",
  marked_complete: "Completed",
  design_images_uploaded: "Design images uploaded",
  design_resubmitted: "Designs resubmitted",
  design_images_updated: "Design images updated",
  design_approved: "Design approved",
  design_changes_requested: "Changes requested",
  design_pending_review: "Awaiting review",
  design_changes_note_updated: "Changes note",
  remarks_updated: "Remarks",
  qty_updated: "Quantity",
  due_date_updated: "Delivery date",
  coordinator_updated: "Coordinator",
  printing_mtrs_updated: "Printing metres",
  received_at_printing_updated: "Received at printing"
};

const DASHBOARD_TAB_STORAGE_KEY = "printing-tracker-dashboard-tab";

function readStoredDashboardTab() {
  try {
    const stored = sessionStorage.getItem(DASHBOARD_TAB_STORAGE_KEY);
    if (stored && (stored === ADMIN_DASHBOARD_TAB.id || DASHBOARD_SIDEBAR.some((item) => item.id === stored))) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "home";
}

function resolveDashboardTabForUser(tabId, permissions, isAdmin) {
  if (tabId === ADMIN_DASHBOARD_TAB.id) return isAdmin ? tabId : "home";
  if (tabId === NOTIFICATIONS_DASHBOARD_TAB.id) return tabId;
  if (isAdmin || viewerCanAccessDashboardTab(permissions, tabId)) return tabId;
  const fallback = firstAllowedDashboardTabId(DASHBOARD_SIDEBAR, permissions, isAdmin);
  return fallback ?? "home";
}

const DEFAULT_NEW_USER_PERMISSIONS = {
  can_edit_status: true,
  can_edit_remarks: false,
  can_edit_due_date: false,
  can_edit_qty: false,
  can_edit_coordinator_name: false,
  can_edit_printing_mtrs: false,
  can_edit_approved_design_images: true,
  can_edit_received_at_printing: false,
  can_edit_payment_method: false,
  can_create_orders: false
};

function defaultNewUserPermissions() {
  const viewTabs = defaultSidebarTabFlags(DASHBOARD_SIDEBAR);
  return {
    ...DEFAULT_NEW_USER_PERMISSIONS,
    sidebar_tabs: viewTabs,
    sidebar_edit_tabs: { ...viewTabs }
  };
}

function hydrateDraftFromPermission(p) {
  const hasStored =
    p &&
    typeof p === "object" &&
    (Object.keys(p).some((k) => k.startsWith("can_edit_")) ||
      Object.prototype.hasOwnProperty.call(p, "can_create_orders") ||
      Object.prototype.hasOwnProperty.call(p, "allowed_dashboard_tabs") ||
      Object.prototype.hasOwnProperty.call(p, "editable_dashboard_tabs"));
  const orderDefaults = hasStored
    ? {
        can_edit_status: p.can_edit_status !== false,
        can_edit_remarks: Boolean(p.can_edit_remarks),
        can_edit_due_date: Boolean(p.can_edit_due_date),
        can_edit_qty: Boolean(p.can_edit_qty),
        can_edit_coordinator_name: Boolean(p.can_edit_coordinator_name),
        can_edit_printing_mtrs: Boolean(p.can_edit_printing_mtrs),
        can_edit_approved_design_images: p.can_edit_approved_design_images !== false,
        can_edit_received_at_printing: Boolean(p.can_edit_received_at_printing),
        can_edit_payment_method: Boolean(p.can_edit_payment_method),
        can_create_orders: Boolean(p.can_create_orders)
      }
    : { ...DEFAULT_NEW_USER_PERMISSIONS };
  const sidebar_tabs = hydrateSidebarTabFlagsFromPermission(p, DASHBOARD_SIDEBAR);
  return {
    ...orderDefaults,
    sidebar_tabs,
    sidebar_edit_tabs: hydrateSidebarEditTabFlagsFromPermission(p, DASHBOARD_SIDEBAR)
  };
}

function permissionRowFromDraft(draft) {
  const sidebarTabs = draft.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR);
  const sidebarEditTabs = draft.sidebar_edit_tabs ?? { ...sidebarTabs };
  return {
    can_edit_status: draft.can_edit_status !== false,
    can_edit_remarks: Boolean(draft.can_edit_remarks),
    can_edit_due_date: Boolean(draft.can_edit_due_date),
    can_edit_qty: Boolean(draft.can_edit_qty),
    can_edit_coordinator_name: Boolean(draft.can_edit_coordinator_name),
    can_edit_printing_mtrs: Boolean(draft.can_edit_printing_mtrs),
    can_edit_approved_design_images: draft.can_edit_approved_design_images !== false,
    can_edit_received_at_printing: Boolean(draft.can_edit_received_at_printing),
    can_edit_payment_method: Boolean(draft.can_edit_payment_method),
    can_create_orders: Boolean(draft.can_create_orders),
    allowed_dashboard_tabs: allowedDashboardTabsFromFlags(sidebarTabs, DASHBOARD_SIDEBAR),
    editable_dashboard_tabs: editableDashboardTabsFromFlags(
      sidebarEditTabs,
      sidebarTabs,
      DASHBOARD_SIDEBAR
    )
  };
}

/** Align with DB: status allowed unless `can_edit_status` is explicitly false. */
function viewerMayEditOrderField(permissions, field) {
  if (field === "status") {
    const keys = Object.keys(permissions).filter((k) => k.startsWith("can_edit_"));
    if (keys.length === 0) return true;
    return permissions.can_edit_status !== false;
  }
  if (field === "approved_design_images") {
    return permissions.can_edit_approved_design_images !== false;
  }
  return Boolean(permissions[`can_edit_${field}`]);
}

function viewerHasAnyOrderFieldEdit(permissions) {
  return EDITABLE_FIELD_OPTIONS.some((opt) => viewerMayEditOrderField(permissions, opt.key));
}

function userDisplayInitials(name, email) {
  const source = (name || email || "U").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function DashboardSidebarItem({ item, isActive, onSelect, showSoon }) {
  return (
    <button
      type="button"
      className={isActive ? "dashboard-sidebar-item is-active" : "dashboard-sidebar-item"}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onSelect(item.id)}
    >
      <span className="dashboard-sidebar-item-leading">
        <DashboardSidebarIcon tabId={item.id} />
        <span className="dashboard-sidebar-item-label">{item.label}</span>
      </span>
      {showSoon ? <span className="dashboard-sidebar-soon">Soon</span> : null}
    </button>
  );
}

function formatHomeLastUpdated(timestampMs) {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (elapsedSec < 45) return "Just now";
  const elapsedMin = Math.floor(elapsedSec / 60);
  if (elapsedMin < 60) return elapsedMin === 1 ? "1 min ago" : `${elapsedMin} min ago`;
  const elapsedHr = Math.floor(elapsedMin / 60);
  if (elapsedHr < 24) return elapsedHr === 1 ? "1 hr ago" : `${elapsedHr} hr ago`;
  return new Date(timestampMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function ThemeToggle({ theme, onToggle, className = "theme-toggle-btn" }) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

function App() {
  function renderStageIcon(stage, altLabel) {
    if (stage === "on_hold") {
      return (
        <span className="stage-icon stage-icon-on-hold" title={altLabel}>
          <OnHoldWarningIcon />
        </span>
      );
    }
    const icon = STAGE_ICON[stage];
    if (typeof icon === "string" && icon.startsWith("/")) {
      return <img className="stage-icon-img" src={icon} alt={`${altLabel} icon`} />;
    }
    return <span className="stage-icon">{icon}</span>;
  }

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const isAdminUser = (profile?.role ?? "").trim().toLowerCase() === "admin";

  const statusTonesEnabled = profile?.status_tones_enabled !== false;
  useEffect(() => {
    muteStatusTones = !statusTonesEnabled;
    if (!statusTonesEnabled) {
      pendingStatusTone = false;
      pendingStatusToneReady = false;
    }
  }, [statusTonesEnabled]);
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("printing-tracker-theme") === "dark" ? "dark" : "light";
  });
  const [homeRefreshedAt, setHomeRefreshedAt] = useState(() => Date.now());
  const [homeRefreshTick, setHomeRefreshTick] = useState(0);
  const [homeRefreshing, setHomeRefreshing] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [orderIdDraft, setOrderIdDraft] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  /** "printing" = full create-order form; "job_sheet" = production job sheet (placeholder until dedicated fields). */
  const [createFormMode, setCreateFormMode] = useState("printing");
  const [assignmentToasts, setAssignmentToasts] = useState([]);
  const [repeatOrderPickerOpen, setRepeatOrderPickerOpen] = useState(false);
  const [orderTemplates, setOrderTemplates] = useState([]);
  const [loadingOrderTemplates, setLoadingOrderTemplates] = useState(false);
  const [templateEditingId, setTemplateEditingId] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateColorPickerOpen, setTemplateColorPickerOpen] = useState(false);
  const templateColorPickerRef = useRef(null);
  const [designFiles, setDesignFiles] = useState([]);
  const [paymentScreenshotFiles, setPaymentScreenshotFiles] = useState([]);
  const [customerAssetFiles, setCustomerAssetFiles] = useState([]);
  const [uploadingPaymentProofOrderId, setUploadingPaymentProofOrderId] = useState(null);
  const [owners, setOwners] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newCoordinatorName, setNewCoordinatorName] = useState("");
  const [salesIncharges, setSalesIncharges] = useState([]);
  const [newSalesInchargeName, setNewSalesInchargeName] = useState("");
  const [jobSheetForm, setJobSheetForm] = useState(() => emptyJobSheetForm());
  const [savingJobSheet, setSavingJobSheet] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [masterListView, setMasterListView] = useState("list");
  const [showMockupStudio, setShowMockupStudio] = useState(false);
  const [masterTableMissing, setMasterTableMissing] = useState(false);
  const [salesInchargeTableMissing, setSalesInchargeTableMissing] = useState(false);
  const [teamProfiles, setTeamProfiles] = useState([]);
  const [viewerProfiles, setViewerProfiles] = useState([]);
  const [viewerPermissions, setViewerPermissions] = useState({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /** none = server order (created_at desc); asc/desc = coordinator name */
  const [orderSortCoordinator, setOrderSortCoordinator] = useState("none");
  const [ordersTab, setOrdersTab] = useState("active");
  const [ordersSearchQuery, setOrdersSearchQuery] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchOutwardChallans, setGlobalSearchOutwardChallans] = useState([]);
  const [globalSearchContacts, setGlobalSearchContacts] = useState([]);
  const [globalSearchExtrasLoading, setGlobalSearchExtrasLoading] = useState(false);
  const [pendingDispatchSubview, setPendingDispatchSubview] = useState(null);
  const [pendingOutwardOcId, setPendingOutwardOcId] = useState(null);
  const [pendingInwardEntryId, setPendingInwardEntryId] = useState(null);
  const [pendingPrintingSubview, setPendingPrintingSubview] = useState(null);
  const [dashboardTab, setDashboardTab] = useState(readStoredDashboardTab);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [statusUpdates, setStatusUpdates] = useState({});
  const [remarksUpdates, setRemarksUpdates] = useState({});
  const [qtyUpdates, setQtyUpdates] = useState({});
  const [dueDateUpdates, setDueDateUpdates] = useState({});
  const [printingMtrsUpdates, setPrintingMtrsUpdates] = useState({});
  const [coordinatorUpdates, setCoordinatorUpdates] = useState({});
  const [receivedAtPrintingUpdates, setReceivedAtPrintingUpdates] = useState({});
  const [adminOrderDrafts, setAdminOrderDrafts] = useState({});
  const [previewImages, setPreviewImages] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [viewerNameDrafts, setViewerNameDrafts] = useState({});
  const [viewerDepartmentDrafts, setViewerDepartmentDrafts] = useState({});
  const [viewerJobRoleDrafts, setViewerJobRoleDrafts] = useState({});
  const [viewerEmployeeIdDrafts, setViewerEmployeeIdDrafts] = useState({});
  const [viewerActiveDrafts, setViewerActiveDrafts] = useState({});
  const [viewerToneDrafts, setViewerToneDrafts] = useState({});
  const [viewerListSearch, setViewerListSearch] = useState("");
  const [viewerListStatusFilter, setViewerListStatusFilter] = useState("all");
  const [editingViewerId, setEditingViewerId] = useState(null);
  const [permissionDrafts, setPermissionDrafts] = useState({});
  const [createUserInnerTab, setCreateUserInnerTab] = useState("details");
  const [newUserForm, setNewUserForm] = useState(() => ({
    email: "",
    password: "",
    full_name: "",
    department: "",
    job_role: "",
    employee_id: "",
    role: "viewer",
    status_tones_enabled: true,
    permissions: defaultNewUserPermissions()
  }));
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState("");
  const [createUserSuccess, setCreateUserSuccess] = useState("");
  /** Map of viewer.id -> draft new password (string) or undefined when picker closed. */
  const [resetPasswordDrafts, setResetPasswordDrafts] = useState({});
  const [resettingPasswordFor, setResettingPasswordFor] = useState(null);
  const [removingUserId, setRemovingUserId] = useState(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef(null);
  const [uploadingPostDesignOrderId, setUploadingPostDesignOrderId] = useState(null);
  const [archivingPostDesignOrderId, setArchivingPostDesignOrderId] = useState(null);
  const [designReviewNoteOpen, setDesignReviewNoteOpen] = useState({});
  const [designReviewNoteDrafts, setDesignReviewNoteDrafts] = useState({});
  const [savingDesignReviewOrderId, setSavingDesignReviewOrderId] = useState(null);
  const [orderHistoryTarget, setOrderHistoryTarget] = useState(null);
  const [orderHistoryEntries, setOrderHistoryEntries] = useState([]);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistoryError, setOrderHistoryError] = useState("");
  const [viewOrderTarget, setViewOrderTarget] = useState(null);
  const [viewOrderFromTab, setViewOrderFromTab] = useState(null);
  /** Map order id -> last known status (for new→pending tone). */
  const prevOrderStatusesRef = useRef(null);
  /** Recent approved-design saves — avoids realtime refetch wiping thumbnails. */
  const recentImagePatchRef = useRef({});

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    try {
      window.localStorage.setItem("printing-tracker-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    try {
      sessionStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, dashboardTab);
    } catch {
      /* ignore */
    }
  }, [dashboardTab]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("mobile-nav-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("mobile-nav-open");
    };
  }, [mobileNavOpen]);

  const fetchOrders = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoadingOrders(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_id, order_date, due_date, owner_name, customer_name, coordinator_name, sales_incharge_name, qty, size_breakdown, product_name, colors, approved_design_url, approved_design_images, approved_design_images_archive, post_approved_design_review_status, post_approved_design_changes_note, post_approved_design_reviewed_by, post_approved_design_reviewed_at, printing_mtrs, status, status_ready_at, remarks, created_at, created_by, is_complete, is_production_order, expected_handover_to_printing, received_at_printing, payment_method, payment_screenshot_url, invoice_url, delivery_method, dispatch_sizes_verified, dispatch_sizes_qty_ok, dispatch_product_name_ok, dispatch_colors_ok, dispatch_issue_type, dispatch_verification_failed, dispatch_verified_at, dispatch_verified_by, order_cost, printing_cost, size_type, rate_per_piece, brand, fabric_type, branding, branding_type, gsm, atta"
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error.message);
        return false;
      }
      const rows = data ?? [];
      setOrders((prev) =>
        mergeOrdersPreservingDesignImages(prev, rows, recentImagePatchRef.current)
      );
      // Select uses statusUpdates[id] ?? order.status — stale keys hide remote changes until full reload.
      setStatusUpdates(Object.fromEntries(rows.map((o) => [o.id, o.status])));
      setReceivedAtPrintingUpdates(
        Object.fromEntries(rows.map((o) => [o.id, receivedAtToDatetimeLocalValue(o.received_at_printing)]))
      );
      return true;
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      return false;
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  }, []);

  const loadGlobalSearchExtras = useCallback(async () => {
    setGlobalSearchExtrasLoading(true);
    try {
      const [ocRes, contactRes] = await Promise.all([
        supabase
          .from("outward_challans")
          .select(OC_SELECT_FIELDS)
          .order("created_at", { ascending: false })
          .limit(400),
        supabase
          .from("contact_book_entries")
          .select(
            "id, name, email, department, designation, contact_number, alternate_contact_number"
          )
          .order("name", { ascending: true })
      ]);
      if (!ocRes.error) setGlobalSearchOutwardChallans(ocRes.data ?? []);
      if (!contactRes.error) setGlobalSearchContacts(contactRes.data ?? []);
    } finally {
      setGlobalSearchExtrasLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    loadGlobalSearchExtras();
  }, [session?.user?.id, loadGlobalSearchExtras]);

  useEffect(() => {
    if (!colorPickerOpen) return;
    function handlePointerDown(e) {
      if (!colorPickerRef.current?.contains(e.target)) {
        setColorPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [colorPickerOpen]);

  useEffect(() => {
    if (!templateColorPickerOpen) return;
    function handlePointerDown(e) {
      if (!templateColorPickerRef.current?.contains(e.target)) {
        setTemplateColorPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [templateColorPickerOpen]);

  useEffect(() => {
    if (!templateDraft) {
      setTemplateColorPickerOpen(false);
    }
  }, [templateDraft]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) setShowPassword(false);
  }, [session]);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }
    fetchProfile(session.user);
  }, [session?.user?.id]);

  useEffect(() => {
    if (shouldShowAdminDeployTools()) return;
    setMasterListView((current) => (current === "deploy" ? "list" : current));
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setOrders([]);
      setOwners([]);
      setCoordinators([]);
      return;
    }
    fetchOrders();
    fetchMasters();

    const channel = supabase
      .channel("orders-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => fetchOrders({ silent: true })
      )
      .subscribe();

    const pollMs = 25000;
    const pollId = setInterval(() => {
      fetchOrders({ silent: true });
    }, pollMs);

    return () => {
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, fetchOrders]);

  /** Prime Web Audio after login so status-change tones can play (browser autoplay rules). */
  useEffect(() => {
    if (!session?.user || profileLoading) return undefined;
    let done = false;
    const prime = () => {
      if (done) return;
      done = true;
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
      primeStatusToneFromUserGesture();
    };
    window.addEventListener("pointerdown", prime, { capture: true, passive: true });
    window.addEventListener("keydown", prime, { capture: true, passive: true });
    return () => {
      done = true;
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
    };
  }, [session?.user?.id, profileLoading, isAdminUser]);

  useEffect(() => {
    const myUserId = session?.user?.id ?? null;
    if (!myUserId) {
      prevOrderStatusesRef.current = null;
      return;
    }
    if (profileLoading) return;
    if (!orders.length) {
      prevOrderStatusesRef.current = null;
      return;
    }
    const prev = prevOrderStatusesRef.current;
    const nextMap = Object.fromEntries(orders.map((o) => [String(o.id), o.status]));
    if (prev && typeof prev === "object" && Object.keys(prev).length) {
      let changedToReady = false;
      let anyStatusChanged = false;
      let skippedNotCreator = 0;
      for (const o of orders) {
        const key = String(o.id);
        const was = prev[key];
        if (was === undefined || was === o.status) continue;
        if (String(o.created_by ?? "") !== String(myUserId)) {
          skippedNotCreator += 1;
          continue;
        }
        anyStatusChanged = true;
        if (o.status === "ready") changedToReady = true;
      }
      if (anyStatusChanged) {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          console.debug("[tone] status change → playing", { changedToReady, muteStatusTones });
          playOrderStatusChangeTone(changedToReady);
        } else {
          console.debug("[tone] status change deferred (tab hidden)");
          pendingStatusTone = true;
          pendingStatusToneReady = changedToReady;
        }
      } else if (skippedNotCreator > 0) {
        console.debug(
          `[tone] ${skippedNotCreator} status change(s) skipped — current user is not the creator`
        );
      }
    }
    prevOrderStatusesRef.current = nextMap;
  }, [session?.user?.id, orders, profileLoading]);

  /** Play deferred status tone when tab becomes visible (hidden-tab throttling). */
  useEffect(() => {
    if (!session?.user) return undefined;
    const flush = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      if (!pendingStatusTone) return;
      pendingStatusTone = false;
      playOrderStatusChangeTone(pendingStatusToneReady);
      pendingStatusToneReady = false;
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("focus", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("focus", flush);
    };
  }, [session?.user?.id, isAdminUser]);

  /** Tone-03 every 5 min while any order created by current user is Ready to Dispatch > 48h. */
  useEffect(() => {
    const myUserId = session?.user?.id ?? null;
    if (!myUserId || profileLoading) return undefined;

    const tick = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      const myOrders = orders.filter(
        (o) => String(o.created_by ?? "") === String(myUserId)
      );
      if (anyOrderReadyOver48h(myOrders)) playReadyDispatchOverdueTone();
    };

    const id = window.setInterval(tick, READY_OVERDUE_TONE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [session?.user?.id, orders, profileLoading]);

  useEffect(() => {
    if (!session?.user) return undefined;

    async function promoteStaleNewOrdersToPending() {
      const { data: count, error } = await supabase.rpc("promote_stale_new_orders_to_pending");
      if (error) {
        console.error("Auto status promote failed:", error.message);
        return;
      }
      const promoted = typeof count === "number" ? count : 0;
      if (promoted > 0) {
        await fetchOrders({ silent: true });
      }
    }

    const run = () => {
      promoteStaleNewOrdersToPending().catch((e) => console.error(e));
    };
    const t0 = setTimeout(run, 5000);
    const intervalId = setInterval(run, 30000);
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t0);
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session?.user?.id, fetchOrders]);

  useEffect(() => {
    if (!session?.user) {
      setTeamProfiles([]);
      return;
    }
    fetchTeamProfiles();
  }, [session?.user?.id]);

  useEffect(() => {
    if (dashboardTab === "chat" && session?.user) {
      fetchTeamProfiles();
    }
  }, [dashboardTab, session?.user?.id]);

  useEffect(() => {
    if (!session?.user || !profile?.role) return;
    fetchViewersAndPermissions();
  }, [session?.user?.id, profile?.role]);

  useEffect(() => {
    if (dashboardTab !== ADMIN_DASHBOARD_TAB.id) return;
    const next = {};
    viewerProfiles.forEach((v) => {
      next[v.id] = hydrateDraftFromPermission(viewerPermissions[v.id] ?? {});
    });
    setPermissionDrafts(next);
    // Intentionally omit viewerPermissions: refetches after partial saves must not wipe other rows' drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardTab, viewerProfiles]);

  async function fetchProfile(sessionUser) {
    setProfileLoading(true);
    setProfileError(null);

    const networkHint =
      "Cannot reach Supabase. Check your internet connection, VPN or firewall, and that VITE_SUPABASE_URL in .env is your project URL (https://….supabase.co). Open that URL in the browser or Supabase dashboard to confirm the project is running.";

    try {
      const email = sessionUser.email?.trim() || "";

      const { data: adminRow, error: adminErr } = await supabase
        .from("admin_emails")
        .select("email")
        .ilike("email", email || "__no_email__")
        .maybeSingle();

      if (adminErr) {
        console.error(adminErr.message);
      }

      let { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, department, status_tones_enabled")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (profErr) {
        const msg = profErr.message || "";
        setProfileError(
          /failed to fetch|network|socket|load failed/i.test(msg) ? networkHint : profErr.message
        );
        setProfile(null);
        return;
      }

      if (!prof) {
        const role = adminRow ? "admin" : "viewer";
        const { error: insErr } = await supabase.from("profiles").insert({
          id: sessionUser.id,
          email: email ? email.toLowerCase() : null,
          full_name: sessionUser.user_metadata?.full_name || email || "",
          role
        });
        if (insErr && insErr.code !== "23505") {
          const msg = insErr.message || "";
          setProfileError(
            /failed to fetch|network|socket|load failed/i.test(msg) ? networkHint : insErr.message
          );
          setProfile(null);
          return;
        }
        const again = await supabase
          .from("profiles")
          .select("id, full_name, email, role, department, status_tones_enabled")
          .eq("id", sessionUser.id)
          .maybeSingle();
        prof = again.data;
      }

      if (!prof) {
        setProfileError("Could not load or create your profile. Run the latest supabase/schema.sql in Supabase.");
        setProfile(null);
        return;
      }

      if (adminRow && prof.role !== "admin") {
        const { error: upErr } = await supabase.from("profiles").update({ role: "admin" }).eq("id", sessionUser.id);
        if (!upErr) {
          const { data: promoted } = await supabase
            .from("profiles")
            .select("id, full_name, email, role, department, status_tones_enabled")
            .eq("id", sessionUser.id)
            .maybeSingle();
          if (promoted) prof = promoted;
        }
      }

      setProfile(prof);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      setProfileError(/fetch|network|socket|failed to connect|load failed/i.test(msg) ? networkHint : msg);
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  async function fetchMasters() {
    setMasterTableMissing(false);
    setSalesInchargeTableMissing(false);

    const [
      { data: ownersData, error: ownersError },
      { data: coordinatorsData, error: coordinatorsError },
      { data: salesInchargesData, error: salesInchargesError }
    ] = await Promise.all([
      supabase.from("owners").select("id, name").order("name", { ascending: true }),
      supabase.from("coordinators").select("id, name").order("name", { ascending: true }),
      supabase.from("sales_incharges").select("id, name").order("name", { ascending: true })
    ]);

    const tableMissing = (msg) =>
      String(msg ?? "").includes("Could not find the table") ||
      String(msg ?? "").includes("schema cache");

    if (ownersError) {
      console.error(ownersError.message);
      if (tableMissing(ownersError.message)) {
        setMasterTableMissing(true);
      }
    } else {
      setOwners(ownersData ?? []);
    }

    if (coordinatorsError) {
      console.error(coordinatorsError.message);
      if (tableMissing(coordinatorsError.message)) {
        setMasterTableMissing(true);
      }
    } else {
      setCoordinators(coordinatorsData ?? []);
    }

    if (salesInchargesError) {
      console.error(salesInchargesError.message);
      if (tableMissing(salesInchargesError.message)) {
        setSalesInchargeTableMissing(true);
        setSalesIncharges([]);
      }
    } else {
      setSalesIncharges(salesInchargesData ?? []);
    }
  }

  async function fetchTeamProfiles() {
    const { data: rpcData, error: rpcError } = await supabase.rpc("list_team_chat_directory");
    if (!rpcError && rpcData?.length) {
      setTeamProfiles(rpcData);
      return;
    }
    if (rpcError) {
      console.warn("Team chat directory RPC:", rpcError.message);
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, department, role")
      .order("full_name", { ascending: true });
    if (error) {
      console.error("Team profiles:", error.message);
      return;
    }
    setTeamProfiles(data ?? []);
  }

  async function fetchViewersAndPermissions() {
    const role = (profile?.role ?? "").trim().toLowerCase();
    if (role === "admin") {
      const [{ data: viewersData, error: viewersError }, { data: permissionsData, error: permissionsError }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, department, job_role, employee_id, is_active, status_tones_enabled")
            .eq("role", "viewer")
            .order("full_name", { ascending: true }),
          supabase.from("profile_order_permissions").select("*")
        ]);

      if (viewersError) {
        console.error(viewersError.message);
        return null;
      }
      if (permissionsError) {
        console.error(permissionsError.message);
        return null;
      }

      const viewers = viewersData ?? [];
      const nextPermissions = {};
      (permissionsData ?? []).forEach((item) => {
        nextPermissions[item.user_id] = item;
      });
      setViewerProfiles(viewers);
      setViewerPermissions(nextPermissions);
      return { viewerProfiles: viewers, viewerPermissions: nextPermissions };
    }

    const { data: ownPermissions, error } = await supabase
      .from("profile_order_permissions")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) {
      console.error(error.message);
      return null;
    }
    const uid = session.user.id;
    const nextPerms = ownPermissions ? { [uid]: ownPermissions } : {};
    setViewerProfiles([]);
    setViewerPermissions(nextPerms);
    return { viewerProfiles: [], viewerPermissions: nextPerms };
  }

  useEffect(() => {
    if (!session?.user?.id || !profile?.role) return undefined;
    const uid = session.user.id;
    const channel = supabase
      .channel(`profile-order-permissions-self-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profile_order_permissions",
          filter: `user_id=eq.${uid}`
        },
        () => {
          void fetchViewersAndPermissions();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, profile?.role]);

  /** Refresh own profile when admin toggles tone (or other profile fields) live. */
  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const uid = session.user.id;
    const channel = supabase
      .channel(`profile-self-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${uid}`
        },
        (payload) => {
          const next = payload.new;
          if (next && typeof next === "object") {
            setProfile((prev) => (prev ? { ...prev, ...next } : prev));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || profileLoading) return;
    const role = (profile?.role ?? "").trim().toLowerCase();
    const isAdminRole = role === "admin";
    const perms = viewerPermissions[session.user.id] ?? {};
    const resolved = resolveDashboardTabForUser(dashboardTab, perms, isAdminRole);
    if (resolved !== dashboardTab) setDashboardTab(resolved);
  }, [session?.user?.id, profile?.role, profileLoading, viewerPermissions, dashboardTab]);

  async function handleSignIn(e) {
    e.preventDefault();
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    setAuthLoading(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  function onOrderFormChange(e) {
    const { name, value } = e.target;
    setOrderForm((prev) => ({ ...prev, [name]: value }));
    if (name === "payment_method" && !paymentMethodRequiresProof(value)) {
      setPaymentScreenshotFiles([]);
    }
  }

  function addOrderIdsFromRaw(raw) {
    const tokens = parseOrderIdTokens(raw);
    if (!tokens.length) return;
    setOrderForm((prev) => {
      const cur = Array.isArray(prev.order_ids) ? prev.order_ids : [];
      const seen = new Set(cur);
      const next = [...cur];
      for (const t of tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        next.push(t);
      }
      return { ...prev, order_ids: next, order_id: next.join(", ") };
    });
  }

  function removeOrderIdToken(token) {
    setOrderForm((prev) => {
      const cur = Array.isArray(prev.order_ids) ? prev.order_ids : [];
      const next = cur.filter((t) => t !== token);
      return { ...prev, order_ids: next, order_id: next.join(", ") };
    });
  }

  function clearAllOrderIds() {
    setOrderForm((prev) => ({ ...prev, order_ids: [], order_id: "" }));
    setOrderIdDraft("");
  }

  function closeCreateOrderForm() {
    setShowCreateForm(false);
    setCreateFormMode("printing");
    setOrderForm(emptyOrder);
    setJobSheetForm(emptyJobSheetForm());
    setSavingJobSheet(false);
    setOrderIdDraft("");
    setDesignFiles([]);
    setPaymentScreenshotFiles([]);
    setCustomerAssetFiles([]);
  }

  function onCustomerAssetsSelected(e) {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setCustomerAssetFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  }

  function removeCustomerAssetFile(index) {
    setCustomerAssetFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function togglePaletteColor(hex) {
    const key = hex.toLowerCase();
    setOrderForm((prev) => {
      const exists = prev.colors.some((c) => normalizeColorKey(c) === key);
      if (exists) {
        return { ...prev, colors: prev.colors.filter((c) => normalizeColorKey(c) !== key) };
      }
      return { ...prev, colors: [...prev.colors, hex] };
    });
  }

  function handleRemoveColor(color) {
    setOrderForm((prev) => ({
      ...prev,
      colors: prev.colors.filter((item) => item !== color)
    }));
  }

  async function handleCreateOrder(e) {
    e.preventDefault();
    if (!designFiles.length) {
      alert("At least one mockup image is required.");
      return;
    }
    if (!orderForm.colors.length) {
      alert("Please pick at least one color from the palette.");
      return;
    }
    if (!orderForm.owner_name) {
      alert("Please select Owner.");
      return;
    }
    if (!orderForm.coordinator_name) {
      alert("Please select Coordinator.");
      return;
    }
    if (!orderForm.due_date) {
      alert("Please set the delivery date.");
      return;
    }
    if (!orderForm.payment_method) {
      alert("Please select a payment method.");
      return;
    }
    if (!orderForm.delivery_method) {
      alert("Please select a delivery method.");
      return;
    }
    if (paymentMethodRequiresProof(orderForm.payment_method) && paymentScreenshotFiles.length === 0) {
      alert("Please upload at least one payment proof image for the selected payment method.");
      return;
    }
    if (orderForm.is_production_order) {
      const h = String(orderForm.expected_handover_to_printing ?? "").trim();
      if (!h) {
        alert("Please set expected product handover to printing (date) for production orders.");
        return;
      }
    }
    for (const row of orderForm.extraSizes ?? []) {
      const label = String(row?.label ?? "").trim().toUpperCase();
      const n = parseSizeQtyInput(row?.qty);
      if (n > 0 && !label) {
        alert("Enter a size name for each extra size that has a quantity.");
        return;
      }
    }
    const sizeBreakdown = sizesFormToBreakdown(orderForm.sizes, orderForm.extraSizes);
    const qtyTotal = sumSizeForm(orderForm.sizes, orderForm.extraSizes);
    const uploadedUrls = [];
    for (const file of designFiles) {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
      const uploadPath = `${session.user.id}/${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("approved-designs")
        .upload(uploadPath, file, { upsert: false });

      if (uploadError) {
        alert(uploadError.message);
        return;
      }
      const { data: publicUrlData } = supabase.storage
        .from("approved-designs")
        .getPublicUrl(uploadPath);
      uploadedUrls.push(publicUrlData.publicUrl);
    }

    let paymentScreenshotUrl = null;
    if (paymentMethodRequiresProof(orderForm.payment_method) && paymentScreenshotFiles.length > 0) {
      const proofUrls = [];
      for (const file of paymentScreenshotFiles) {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
        const paymentPath = `${session.user.id}/${safeName}`;
        const { error: paymentUploadError } = await supabase.storage
          .from("payment-screenshots")
          .upload(paymentPath, file, { upsert: false });
        if (paymentUploadError) {
          alert(paymentUploadError.message);
          return;
        }
        const { data: paymentUrlData } = supabase.storage
          .from("payment-screenshots")
          .getPublicUrl(paymentPath);
        proofUrls.push(paymentUrlData.publicUrl);
      }
      paymentScreenshotUrl = serializePaymentProofUrls(proofUrls);
    }

    const rawMtrs = String(orderForm.printing_mtrs ?? "").trim().replace(",", ".");
    const parsedMtrs = Number.parseFloat(rawMtrs);
    const printingMtrs = Number.isFinite(parsedMtrs) && parsedMtrs >= 0 ? parsedMtrs : 0;

    const orderIdJoined =
      Array.isArray(orderForm.order_ids) && orderForm.order_ids.length
        ? orderForm.order_ids.join(", ")
        : String(orderForm.order_id ?? "").trim();

    const payload = {
      order_date: todayLocalISODate(),
      order_id: orderIdJoined || null,
      order_kind: orderForm.order_kind || "printing",
      due_date: orderForm.due_date,
      owner_name: orderForm.owner_name,
      customer_name: orderForm.customer_name,
      coordinator_name: orderForm.coordinator_name,
      qty: qtyTotal,
      size_breakdown: sizeBreakdown,
      product_name: orderForm.product_name,
      colors: orderForm.colors,
      approved_design_url: JSON.stringify(uploadedUrls),
      approved_design_images: null,
      printing_mtrs: printingMtrs,
      order_cost: parseMoneyInput(orderForm.order_cost),
      printing_cost: parseMoneyInput(orderForm.printing_cost),
      status: "new",
      remarks: orderForm.remarks || null,
      created_by: session.user.id,
      is_production_order: Boolean(orderForm.is_production_order),
      expected_handover_to_printing: orderForm.is_production_order
        ? String(orderForm.expected_handover_to_printing).trim() || null
        : null,
      payment_method: orderForm.payment_method,
      payment_screenshot_url: paymentScreenshotUrl,
      delivery_method: orderForm.delivery_method
    };

    const { data: insertedOrder, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      alert(error.message);
      return;
    }

    if (customerAssetFiles.length > 0 && insertedOrder?.id) {
      try {
        await uploadOrderCustomerAssets(
          supabase,
          insertedOrder.id,
          customerAssetFiles,
          session.user.id
        );
      } catch (assetErr) {
        alert(
          `Job saved, but customer file upload failed: ${
            assetErr instanceof Error ? assetErr.message : String(assetErr)
          }`
        );
      }
    }

    if (insertedOrder?.id) {
      await insertOrderAssignmentNotification(supabase, {
        coordinatorName: payload.coordinator_name,
        orderId: insertedOrder.id,
        orderDisplayId: orderIdJoined,
        assignedByUserId: session.user.id,
        profileLookup: profileLookupForAssignments
      });
    }

    const tabWhereCreated = dashboardTab;
    setOrderForm(emptyOrder);
    setOrderIdDraft("");
    setDesignFiles([]);
    setPaymentScreenshotFiles([]);
    setCustomerAssetFiles([]);
    setShowCreateForm(false);
    setDashboardTab(tabWhereCreated);
    setOrdersTab("active");
    await fetchOrders();
    alert("Job card has been saved successfully.");
  }

  function blankTemplateDraft() {
    return {
      name: "",
      owner_name: "",
      customer_name: "",
      coordinator_name: "",
      product_name: "",
      colors: [],
      sizes: emptySizesForm(),
      extraSizes: [],
      printing_mtrs: "0.00",
      order_cost: "",
      printing_cost: "",
      remarks: "",
      is_production_order: false,
      expected_handover_to_printing: "",
      payment_method: "",
      delivery_method: "",
      existingImagePaths: [],
      newImageFiles: []
    };
  }

  function openCreateOrderForm() {
    const defaultName = profileDisplayName(profile);
    setCreateFormMode("printing");
    setOrderForm((prev) => ({
      ...emptyOrder,
      coordinator_name: defaultName || prev.coordinator_name
    }));
    setOrderIdDraft("");
    setDesignFiles([]);
    setPaymentScreenshotFiles([]);
    setCustomerAssetFiles([]);
    setShowCreateForm(true);
  }

  async function openCreateProductionJobSheet() {
    setCreateFormMode("job_sheet");
    setOrderForm(emptyOrder);
    setOrderIdDraft("");
    setDesignFiles([]);
    setPaymentScreenshotFiles([]);
    setCustomerAssetFiles([]);

    const today = todayLocalISODate();
    let nextOrderId = computeNextJobSheetOrderId([]);
    const { data: existingRows, error: idError } = await supabase
      .from("orders")
      .select("order_id")
      .eq("is_production_order", true);
    if (!idError && existingRows?.length) {
      nextOrderId = computeNextJobSheetOrderId(existingRows.map((r) => r.order_id));
    }

    setJobSheetForm({
      ...emptyJobSheetForm(),
      order_id: nextOrderId,
      order_date: today
    });
    setShowCreateForm(true);
  }

  async function handleCreateJobSheet(e) {
    e.preventDefault();
    if (!jobSheetForm.sales_incharge_name) {
      alert("Please select sales incharge.");
      return;
    }
    if (!jobSheetForm.customer_name.trim()) {
      alert("Please enter customer name.");
      return;
    }
    if (!jobSheetForm.size_type) {
      alert("Please select size type.");
      return;
    }
    if (!jobSheetForm.product_name.trim()) {
      alert("Please enter product name.");
      return;
    }
    if (!jobSheetForm.delivery_required_on) {
      alert("Please set delivery required on date.");
      return;
    }
    for (const row of jobSheetForm.extraSizes ?? []) {
      const label = String(row?.label ?? "").trim().toUpperCase();
      const n = parseJobSheetSizeQty(row?.qty);
      if (n > 0 && !label) {
        alert("Enter a size name for each additional size that has a quantity.");
        return;
      }
    }

    const sizeBreakdown = jobSheetSizesToBreakdown(jobSheetForm.sizes, jobSheetForm.extraSizes);
    const fromSizes = sumJobSheetSizes(jobSheetForm.sizes, jobSheetForm.extraSizes);
    const manualQty = parseJobSheetSizeQty(jobSheetForm.total_quantity);
    const qty = manualQty > 0 ? manualQty : fromSizes;
    if (qty <= 0) {
      alert("Please enter total quantity or quantities in at least one size.");
      return;
    }

    const colorText = String(jobSheetForm.color ?? "").trim();
    const payload = {
      order_date: jobSheetForm.order_date || todayLocalISODate(),
      order_id: jobSheetForm.order_id,
      is_production_order: true,
      status: "new",
      customer_name: jobSheetForm.customer_name.trim(),
      sales_incharge_name: jobSheetForm.sales_incharge_name,
      coordinator_name: jobSheetForm.sales_incharge_name,
      owner_name: "",
      size_type: jobSheetForm.size_type,
      rate_per_piece: parseJobSheetRate(jobSheetForm.rate_per_piece),
      qty,
      size_breakdown: sizeBreakdown,
      product_name: jobSheetForm.product_name.trim(),
      brand: String(jobSheetForm.brand ?? "").trim() || null,
      colors: colorText ? [colorText] : [],
      fabric_type: String(jobSheetForm.fabric_type ?? "").trim() || null,
      branding: jobSheetForm.branding === "yes",
      branding_type:
        jobSheetForm.branding === "yes"
          ? String(jobSheetForm.branding_type ?? "").trim() || null
          : null,
      gsm: String(jobSheetForm.gsm ?? "").trim() || null,
      atta: jobSheetForm.atta === "yes",
      remarks: String(jobSheetForm.comments ?? "").trim() || null,
      due_date: jobSheetForm.delivery_required_on,
      approved_design_url: "[]",
      printing_mtrs: 0,
      created_by: session.user.id
    };

    setSavingJobSheet(true);
    const { data: insertedOrder, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();
    setSavingJobSheet(false);

    if (error) {
      alert(error.message);
      return;
    }

    if (insertedOrder?.id) {
      await insertOrderAssignmentNotification(supabase, {
        coordinatorName: payload.coordinator_name,
        orderId: insertedOrder.id,
        orderDisplayId: payload.order_id,
        assignedByUserId: session.user.id,
        profileLookup: profileLookupForAssignments
      });
    }

    closeCreateOrderForm();
    setDashboardTab("production_tracker");
    setOrdersTab("active");
    await fetchOrders();
    alert("Job sheet saved successfully.");
  }

  function openRepeatOrderPicker() {
    setTemplateEditingId(null);
    setTemplateDraft(null);
    setRepeatOrderPickerOpen(true);
    void fetchOrderTemplates();
  }

  function closeRepeatOrderPicker() {
    setRepeatOrderPickerOpen(false);
    setTemplateEditingId(null);
    setTemplateDraft(null);
  }

  async function fetchOrderTemplates() {
    if (!session?.user?.id) {
      setOrderTemplates([]);
      return;
    }
    setLoadingOrderTemplates(true);
    try {
      const { data, error } = await supabase
        .from("order_templates")
        .select(
          "id, name, owner_name, customer_name, coordinator_name, product_name, colors, size_breakdown, printing_mtrs, order_cost, printing_cost, remarks, is_production_order, expected_handover_to_printing, payment_method, delivery_method, image_paths, updated_at"
        )
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      setOrderTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOrderTemplates(false);
    }
  }

  function startNewTemplate() {
    setTemplateEditingId("new");
    setTemplateDraft(blankTemplateDraft());
  }

  function startEditTemplate(template) {
    const { sizes, extraSizes } = sizeBreakdownToForm(template.size_breakdown);
    setTemplateEditingId(template.id);
    setTemplateDraft({
      name: template.name ?? "",
      owner_name: template.owner_name ?? "",
      customer_name: template.customer_name ?? "",
      coordinator_name: template.coordinator_name ?? "",
      product_name: template.product_name ?? "",
      colors: Array.isArray(template.colors) ? [...template.colors] : [],
      sizes,
      extraSizes,
      printing_mtrs:
        template.printing_mtrs != null && template.printing_mtrs !== ""
          ? String(template.printing_mtrs)
          : "0.00",
      order_cost:
        template.order_cost != null && template.order_cost !== ""
          ? String(template.order_cost)
          : "",
      printing_cost:
        template.printing_cost != null && template.printing_cost !== ""
          ? String(template.printing_cost)
          : "",
      remarks: template.remarks ?? "",
      is_production_order: Boolean(template.is_production_order),
      expected_handover_to_printing: template.expected_handover_to_printing ?? "",
      payment_method: template.payment_method ?? "",
      delivery_method: template.delivery_method ?? "",
      existingImagePaths: Array.isArray(template.image_paths)
        ? [...template.image_paths]
        : [],
      newImageFiles: []
    });
  }

  function cancelTemplateDraft() {
    setTemplateEditingId(null);
    setTemplateDraft(null);
  }

  function updateTemplateDraft(patch) {
    setTemplateDraft((prev) => ({ ...(prev ?? blankTemplateDraft()), ...patch }));
  }

  function updateTemplateDraftSize(key, value) {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      sizes: { ...(prev?.sizes ?? emptySizesForm()), [key]: value }
    }));
  }

  function addTemplateExtraSize() {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      extraSizes: [...(prev?.extraSizes ?? []), newExtraSizeRow()]
    }));
  }

  function updateTemplateExtraSize(id, patch) {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      extraSizes: (prev?.extraSizes ?? []).map((row) =>
        row.id === id ? { ...row, ...patch } : row
      )
    }));
  }

  function removeTemplateExtraSize(id) {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      extraSizes: (prev?.extraSizes ?? []).filter((row) => row.id !== id)
    }));
  }

  function toggleTemplatePaletteColor(hex) {
    const key = hex.toLowerCase();
    setTemplateDraft((prev) => {
      const cur = prev?.colors ?? [];
      const exists = cur.some((c) => normalizeColorKey(c) === key);
      return {
        ...(prev ?? blankTemplateDraft()),
        colors: exists ? cur.filter((c) => normalizeColorKey(c) !== key) : [...cur, hex]
      };
    });
  }

  function removeTemplateColor(color) {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      colors: (prev?.colors ?? []).filter((c) => c !== color)
    }));
  }

  function handleTemplateImageFiles(files) {
    const incoming = Array.from(files ?? []).filter((f) => f && f.type?.startsWith("image/"));
    if (!incoming.length) return;
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      newImageFiles: [...(prev?.newImageFiles ?? []), ...incoming]
    }));
  }

  function removeTemplateNewImage(index) {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      newImageFiles: (prev?.newImageFiles ?? []).filter((_, i) => i !== index)
    }));
  }

  function removeTemplateExistingImage(path) {
    setTemplateDraft((prev) => ({
      ...(prev ?? blankTemplateDraft()),
      existingImagePaths: (prev?.existingImagePaths ?? []).filter((p) => p !== path)
    }));
  }

  function templateImagePublicUrl(path) {
    if (!path) return null;
    const { data } = supabase.storage.from("order-template-images").getPublicUrl(path);
    return data?.publicUrl ?? null;
  }

  async function handleSaveTemplate(e) {
    e?.preventDefault?.();
    const draft = templateDraft;
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      alert("Give the template a name (e.g. customer + product).");
      return;
    }
    const uid = session?.user?.id;
    if (!uid) {
      alert("You must be signed in to save a template.");
      return;
    }
    const colors = Array.isArray(draft.colors) ? draft.colors.filter(Boolean) : [];
    const size_breakdown = sizesFormToBreakdown(draft.sizes, draft.extraSizes);
    const mtrsNum = Number.parseFloat(String(draft.printing_mtrs).replace(",", "."));
    const printing_mtrs = Number.isFinite(mtrsNum) ? mtrsNum : 0;
    const expectedDate = draft.is_production_order
      ? String(draft.expected_handover_to_printing ?? "").trim() || null
      : null;
    const payload = {
      name,
      owner_name: draft.owner_name.trim() || null,
      customer_name: draft.customer_name.trim() || null,
      coordinator_name: draft.coordinator_name.trim() || null,
      product_name: draft.product_name.trim() || null,
      colors,
      size_breakdown,
      printing_mtrs,
      order_cost: parseMoneyInput(draft.order_cost),
      printing_cost: parseMoneyInput(draft.printing_cost),
      remarks: draft.remarks.trim() || null,
      is_production_order: Boolean(draft.is_production_order),
      expected_handover_to_printing: expectedDate,
      payment_method: draft.payment_method || null,
      delivery_method: draft.delivery_method || null
    };

    setSavingTemplate(true);
    try {
      let templateRow;
      if (templateEditingId && templateEditingId !== "new") {
        const { data, error } = await supabase
          .from("order_templates")
          .update(payload)
          .eq("id", templateEditingId)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        templateRow = data;
      } else {
        const { data, error } = await supabase
          .from("order_templates")
          .insert({ ...payload, user_id: uid })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        templateRow = data;
      }

      const templateId = templateRow?.id;
      const existingPaths = draft.existingImagePaths ?? [];
      const originalTemplate = orderTemplates.find((t) => t.id === templateEditingId);
      const originalPaths = Array.isArray(originalTemplate?.image_paths)
        ? originalTemplate.image_paths
        : [];
      const removedPaths = originalPaths.filter((p) => !existingPaths.includes(p));
      if (removedPaths.length) {
        await supabase.storage.from("order-template-images").remove(removedPaths);
      }

      const uploadedPaths = [];
      for (const file of draft.newImageFiles ?? []) {
        if (!file) continue;
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
        const path = `${uid}/${templateId}/${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("order-template-images")
          .upload(path, file, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        uploadedPaths.push(path);
      }

      const finalImagePaths = [...existingPaths, ...uploadedPaths];
      if (
        finalImagePaths.length !== originalPaths.length ||
        finalImagePaths.some((p, i) => p !== originalPaths[i])
      ) {
        const { error: updErr } = await supabase
          .from("order_templates")
          .update({ image_paths: finalImagePaths })
          .eq("id", templateId);
        if (updErr) throw new Error(updErr.message);
      }

      await fetchOrderTemplates();
      setTemplateEditingId(null);
      setTemplateDraft(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(template) {
    if (!template?.id) return;
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    try {
      const paths = Array.isArray(template.image_paths) ? template.image_paths : [];
      if (paths.length) {
        await supabase.storage.from("order-template-images").remove(paths);
      }
      const { error } = await supabase
        .from("order_templates")
        .delete()
        .eq("id", template.id);
      if (error) throw new Error(error.message);
      await fetchOrderTemplates();
      if (templateEditingId === template.id) {
        setTemplateEditingId(null);
        setTemplateDraft(null);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUseTemplate(template) {
    if (!template) return;
    const { sizes, extraSizes } = sizeBreakdownToForm(template.size_breakdown);
    setOrderForm({
      ...emptyOrder,
      owner_name: template.owner_name ?? "",
      customer_name: template.customer_name ?? "",
      coordinator_name: template.coordinator_name ?? "",
      sizes,
      extraSizes,
      product_name: template.product_name ?? "",
      colors: Array.isArray(template.colors) ? template.colors : [],
      printing_mtrs:
        template.printing_mtrs != null && template.printing_mtrs !== ""
          ? String(template.printing_mtrs)
          : "0.00",
      order_cost:
        template.order_cost != null && template.order_cost !== ""
          ? String(template.order_cost)
          : "",
      printing_cost:
        template.printing_cost != null && template.printing_cost !== ""
          ? String(template.printing_cost)
          : "",
      remarks: template.remarks ?? "",
      is_production_order: Boolean(template.is_production_order),
      expected_handover_to_printing: template.expected_handover_to_printing ?? "",
      payment_method: template.payment_method ?? "",
      delivery_method: template.delivery_method ?? ""
    });
    setDesignFiles([]);
    setPaymentScreenshotFiles([]);

    const paths = Array.isArray(template.image_paths) ? template.image_paths : [];
    if (paths.length) {
      try {
        const fetched = await Promise.all(
          paths.map(async (path) => {
            const url = templateImagePublicUrl(path);
            if (!url) return null;
            const res = await fetch(url);
            if (!res.ok) return null;
            const blob = await res.blob();
            const baseName = path.split("/").pop() || `template-image-${Date.now()}`;
            return new File([blob], baseName, { type: blob.type || "image/png" });
          })
        );
        setCustomerAssetFiles(fetched.filter(Boolean));
      } catch {
        setCustomerAssetFiles([]);
      }
    } else {
      setCustomerAssetFiles([]);
    }

    setRepeatOrderPickerOpen(false);
    setTemplateEditingId(null);
    setTemplateDraft(null);
    setCreateFormMode("printing");
    setShowCreateForm(true);
  }

  async function handleAddOwner() {
    const name = newOwnerName.trim();
    if (!name) return;
    const { error } = await supabase.from("owners").insert({ name });
    if (error) {
      if (error.message?.includes("Could not find the table")) {
        setMasterTableMissing(true);
        alert("Owners/Coordinators tables are missing in Supabase. Please run the updated supabase/schema.sql first.");
      } else {
        alert(error.message);
      }
      return;
    }
    setNewOwnerName("");
    fetchMasters();
  }

  async function handleDeleteOwner(owner) {
    const ok = window.confirm(`Remove owner "${owner.name}"?`);
    if (!ok) return;
    const { error } = await supabase.from("owners").delete().eq("id", owner.id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchMasters();
  }

  async function handleAddCoordinator() {
    const name = newCoordinatorName.trim();
    if (!name) return;
    const { error } = await supabase.from("coordinators").insert({ name });
    if (error) {
      if (error.message?.includes("Could not find the table")) {
        setMasterTableMissing(true);
        alert("Owners/Coordinators tables are missing in Supabase. Please run the updated supabase/schema.sql first.");
      } else {
        alert(error.message);
      }
      return;
    }
    setNewCoordinatorName("");
    fetchMasters();
  }

  async function handleDeleteCoordinator(coordinator) {
    const ok = window.confirm(`Remove coordinator "${coordinator.name}"?`);
    if (!ok) return;
    const { error } = await supabase.from("coordinators").delete().eq("id", coordinator.id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchMasters();
  }

  async function handleAddSalesIncharge() {
    const name = newSalesInchargeName.trim();
    if (!name) return;
    const { error } = await supabase.from("sales_incharges").insert({ name });
    if (error) {
      if (error.message?.includes("Could not find the table")) {
        setMasterTableMissing(true);
        alert(
          "Sales incharges table is missing. Run supabase/migrations/20260613120000_add_job_sheet_fields.sql on your project."
        );
      } else {
        alert(error.message);
      }
      return;
    }
    setNewSalesInchargeName("");
    fetchMasters();
  }

  async function handleDeleteSalesIncharge(row) {
    const ok = window.confirm(`Remove sales incharge "${row.name}"?`);
    if (!ok) return;
    const { error } = await supabase.from("sales_incharges").delete().eq("id", row.id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchMasters();
  }

  function isInSelectedDateRange(orderDate) {
    if (!dateFrom && !dateTo) return true;
    if (!orderDate) return false;
    if (dateFrom && orderDate < dateFrom) return false;
    if (dateTo && orderDate > dateTo) return false;
    return true;
  }

  function toCsvValue(value) {
    const raw = value == null ? "" : String(value);
    const escaped = raw.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  function formatDateForCsv(value) {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB");
  }

  function updatePermissionDraft(viewerId, fieldKey, checked) {
    setPermissionDrafts((prev) => {
      const base = prev[viewerId] ?? hydrateDraftFromPermission(viewerPermissions[viewerId] ?? {});
      return {
        ...prev,
        [viewerId]: { ...base, [fieldKey]: checked }
      };
    });
  }

  function updateSidebarTabDraft(viewerId, tabId, checked) {
    setPermissionDrafts((prev) => {
      const base = prev[viewerId] ?? hydrateDraftFromPermission(viewerPermissions[viewerId] ?? {});
      const sidebar_tabs = {
        ...(base.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR)),
        [tabId]: checked
      };
      const sidebar_edit_tabs = {
        ...(base.sidebar_edit_tabs ?? base.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR)),
        [tabId]: checked ? base.sidebar_edit_tabs?.[tabId] !== false : false
      };
      if (checked && base.sidebar_edit_tabs?.[tabId] !== false) {
        sidebar_edit_tabs[tabId] = true;
      }
      return {
        ...prev,
        [viewerId]: { ...base, sidebar_tabs, sidebar_edit_tabs }
      };
    });
  }

  function updateSidebarEditTabDraft(viewerId, tabId, checked) {
    setPermissionDrafts((prev) => {
      const base = prev[viewerId] ?? hydrateDraftFromPermission(viewerPermissions[viewerId] ?? {});
      return {
        ...prev,
        [viewerId]: {
          ...base,
          sidebar_edit_tabs: {
            ...(base.sidebar_edit_tabs ?? base.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR)),
            [tabId]: checked
          }
        }
      };
    });
  }

  function updateNewUserSidebarTab(tabId, checked) {
    setNewUserForm((prev) => {
      const sidebar_tabs = {
        ...(prev.permissions.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR)),
        [tabId]: checked
      };
      const sidebar_edit_tabs = {
        ...(prev.permissions.sidebar_edit_tabs ?? prev.permissions.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR)),
        [tabId]: checked ? prev.permissions.sidebar_edit_tabs?.[tabId] !== false : false
      };
      if (checked) sidebar_edit_tabs[tabId] = true;
      return {
        ...prev,
        permissions: { ...prev.permissions, sidebar_tabs, sidebar_edit_tabs }
      };
    });
  }

  function updateNewUserSidebarEditTab(tabId, checked) {
    setNewUserForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        sidebar_edit_tabs: {
          ...(prev.permissions.sidebar_edit_tabs ?? prev.permissions.sidebar_tabs ?? defaultSidebarTabFlags(DASHBOARD_SIDEBAR)),
          [tabId]: checked
        }
      }
    }));
  }

  async function handleSaveViewerRow(viewerId) {
    const viewer = viewerProfiles.find((v) => v.id === viewerId);
    const rawName =
      viewerNameDrafts[viewerId] !== undefined ? viewerNameDrafts[viewerId] : (viewer?.full_name ?? "");
    const fullName = String(rawName).trim();
    const rawDept =
      viewerDepartmentDrafts[viewerId] !== undefined
        ? viewerDepartmentDrafts[viewerId]
        : (viewer?.department ?? "");
    const department = String(rawDept).trim();
    const rawJobRole =
      viewerJobRoleDrafts[viewerId] !== undefined
        ? viewerJobRoleDrafts[viewerId]
        : (viewer?.job_role ?? "");
    const job_role = String(rawJobRole).trim();
    const rawEmployeeId =
      viewerEmployeeIdDrafts[viewerId] !== undefined
        ? viewerEmployeeIdDrafts[viewerId]
        : (viewer?.employee_id ?? "");
    const employee_id = String(rawEmployeeId).trim();
    const draft = permissionDrafts[viewerId] ?? hydrateDraftFromPermission(viewerPermissions[viewerId] ?? {});
    const toneEnabled =
      viewerToneDrafts[viewerId] !== undefined
        ? Boolean(viewerToneDrafts[viewerId])
        : viewer?.status_tones_enabled !== false;
    const isActive =
      viewerActiveDrafts[viewerId] !== undefined
        ? Boolean(viewerActiveDrafts[viewerId])
        : viewerIsActive(viewer);

    const { error: nameErr } = await supabase
      .from("profiles")
      .update({
        full_name: fullName || null,
        department: department || null,
        job_role: job_role || null,
        employee_id: employee_id || null,
        is_active: isActive,
        status_tones_enabled: toneEnabled
      })
      .eq("id", viewerId);
    if (nameErr) {
      alert(nameErr.message);
      return;
    }

    const { error: permErr } = await supabase.from("profile_order_permissions").upsert(
      {
        user_id: viewerId,
        ...permissionRowFromDraft(draft),
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    if (permErr) {
      alert(permErr.message);
      return;
    }

    setViewerNameDrafts((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
    setViewerDepartmentDrafts((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
    setViewerJobRoleDrafts((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
    setViewerEmployeeIdDrafts((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
    setViewerActiveDrafts((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
    setViewerToneDrafts((prev) => {
      const next = { ...prev };
      delete next[viewerId];
      return next;
    });
    const refreshed = await fetchViewersAndPermissions();
    if (dashboardTab === ADMIN_DASHBOARD_TAB.id && refreshed?.viewerPermissions) {
      setPermissionDrafts((prev) => ({
        ...prev,
        [viewerId]: hydrateDraftFromPermission(refreshed.viewerPermissions[viewerId] ?? {})
      }));
    }
    if (editingViewerId === viewerId) {
      closeViewerEdit();
    }
  }

  function openViewerEdit(viewer) {
    if (!viewer?.id) return;
    const id = viewer.id;
    setEditingViewerId(id);
    setViewerNameDrafts((prev) => ({ ...prev, [id]: prev[id] ?? viewer.full_name ?? "" }));
    setViewerEmployeeIdDrafts((prev) => ({ ...prev, [id]: prev[id] ?? viewer.employee_id ?? "" }));
    setViewerDepartmentDrafts((prev) => ({ ...prev, [id]: prev[id] ?? viewer.department ?? "" }));
    setViewerJobRoleDrafts((prev) => ({ ...prev, [id]: prev[id] ?? viewer.job_role ?? "" }));
    setViewerToneDrafts((prev) => ({
      ...prev,
      [id]: prev[id] !== undefined ? Boolean(prev[id]) : viewer.status_tones_enabled !== false
    }));
    setViewerActiveDrafts((prev) => ({
      ...prev,
      [id]: prev[id] !== undefined ? Boolean(prev[id]) : viewerIsActive(viewer)
    }));
    setPermissionDrafts((prev) => ({
      ...prev,
      [id]: prev[id] ?? hydrateDraftFromPermission(viewerPermissions[id] ?? {})
    }));
  }

  function closeViewerEdit() {
    setEditingViewerId(null);
  }

  async function handleResetViewerPermissions(userId) {
    const ok = window.confirm(
      "Reset saved permissions for this user? Order field access, sidebar view/edit access will return to defaults until set again."
    );
    if (!ok) return;
    const { error } = await supabase.from("profile_order_permissions").delete().eq("user_id", userId);
    if (error) {
      alert(error.message);
      return;
    }
    const refreshed = await fetchViewersAndPermissions();
    if (dashboardTab === ADMIN_DASHBOARD_TAB.id && refreshed?.viewerPermissions) {
      setPermissionDrafts((prev) => ({
        ...prev,
        [userId]: hydrateDraftFromPermission(refreshed.viewerPermissions[userId] ?? {})
      }));
    }
  }

  function updateNewUserPermission(fieldKey, checked) {
    setNewUserForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [fieldKey]: checked }
    }));
  }

  function resetNewUserForm() {
    setCreateUserInnerTab("details");
    setNewUserForm({
      email: "",
      password: "",
      full_name: "",
      department: "",
      job_role: "",
      employee_id: "",
      role: "viewer",
      status_tones_enabled: true,
      permissions: defaultNewUserPermissions()
    });
  }

  async function handleCreateUser(e) {
    e?.preventDefault?.();
    setCreateUserError("");
    setCreateUserSuccess("");

    const email = newUserForm.email.trim().toLowerCase();
    const password = newUserForm.password;
    const fullName = newUserForm.full_name.trim();
    const department = newUserForm.department.trim();
    const job_role = newUserForm.job_role.trim();
    const employee_id = newUserForm.employee_id.trim();
    const role = newUserForm.role === "admin" ? "admin" : "viewer";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCreateUserError("Enter a valid email.");
      return;
    }
    if (!password || password.length < 6) {
      setCreateUserError("Password must be at least 6 characters.");
      return;
    }

    setCreatingUser(true);
    try {
      await invokeAdminEdgeFunction("admin-create-user", {
        email,
        password,
        full_name: fullName,
        department,
        job_role,
        employee_id,
        role,
        status_tones_enabled: newUserForm.status_tones_enabled !== false,
        permissions: role === "viewer" ? permissionRowFromDraft(newUserForm.permissions) : {}
      });
      setCreateUserSuccess(`User ${email} created as ${role}.`);
      resetNewUserForm();
      await fetchViewersAndPermissions();
    } catch (err) {
      setCreateUserError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingUser(false);
    }
  }

  function openResetPassword(userId) {
    setResetPasswordDrafts((prev) => ({ ...prev, [userId]: "" }));
  }

  function cancelResetPassword(userId) {
    setResetPasswordDrafts((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }

  async function handleResetPassword(userId) {
    const newPassword = String(resetPasswordDrafts[userId] ?? "");
    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    const ok = window.confirm("Reset password for this user? They will need to use the new password to sign in.");
    if (!ok) return;
    setResettingPasswordFor(userId);
    try {
      await invokeAdminEdgeFunction("admin-reset-password", {
        user_id: userId,
        password: newPassword
      });
      cancelResetPassword(userId);
      alert("Password updated.");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setResettingPasswordFor(null);
    }
  }

  async function handleRemoveUser(viewer) {
    if (!viewer?.id) return;
    if (viewer.id === session?.user?.id) {
      alert("You cannot remove your own account while signed in.");
      return;
    }
    const targetEmail = (viewer.email ?? "").trim();
    const promptMsg = targetEmail
      ? `Type the user's email to confirm removal:\n${targetEmail}\n\nThis will revoke their access and delete their profile and field permissions. Orders they created will stay but no longer be linked to a user.`
      : `Type "DELETE" to confirm removing this user. This will revoke their access and delete their profile and field permissions.`;
    const expected = targetEmail || "DELETE";
    const typed = window.prompt(promptMsg, "");
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== expected.toLowerCase()) {
      alert("Confirmation did not match — user was not removed.");
      return;
    }
    setRemovingUserId(viewer.id);
    try {
      await invokeAdminEdgeFunction("admin-delete-user", { user_id: viewer.id });
      await fetchViewersAndPermissions();
      if (editingViewerId === viewer.id) {
        closeViewerEdit();
      }
      alert(`User ${targetEmail || viewer.id} removed.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingUserId(null);
    }
  }

  function handleExportCsv() {
    if (!dateFrom || !dateTo) {
      alert("Please select both From and To dates for export.");
      return;
    }
    if (sortedFilteredOrders.length === 0) {
      alert("No data available for selected date range.");
      return;
    }

    const headers = [
      "Order Date",
      "Order ID",
      "Delivery Date",
      "Owner",
      "Customer Name",
      "Coordinator",
      "Qty",
      "Sizes (XS–3XL)",
      "Product Name",
      "Colors",
      "Approved design images",
      "Printing Mtrs",
      "Production order",
      "Expected Handover to Printing",
      "Payment method",
      "Delivery",
      "Received date & time to printing",
      "Status",
      "Remarks"
    ];

    const rows = sortedFilteredOrders.map((order) => [
      formatDateForCsv(order.order_date),
      order.order_id ?? "",
      formatDateForCsv(order.due_date),
      order.owner_name,
      order.customer_name,
      order.coordinator_name,
      order.qty,
      formatSizeBreakdownSummary(order.size_breakdown),
      order.product_name,
      Array.isArray(order.colors) ? order.colors.join(" | ") : "",
      parseDesignUrls(order.approved_design_images).join(" | "),
      order.printing_mtrs,
      order.is_production_order ? "Yes" : "No",
      order.is_production_order && order.expected_handover_to_printing
        ? formatDateForCsv(order.expected_handover_to_printing)
        : "",
      paymentMethodLabel(order.payment_method),
      deliveryMethodLabel(order.delivery_method),
      order.received_at_printing ? new Date(order.received_at_printing).toISOString() : "",
      STAGE_LABEL[order.status] ?? order.status,
      order.remarks ?? ""
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => toCsvValue(value)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `printing-orders-${dateFrom}-to-${dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleDeleteOrder(order) {
    const ok = window.confirm(
      `Permanently delete this job?\n${order.customer_name} · ${order.order_date} · Qty ${order.qty}`
    );
    if (!ok) return;
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    if (viewOrderTarget?.id === order.id) closeViewOrder();
    fetchOrders();
  }

  async function openOrderHistory(order) {
    setOrderHistoryTarget(order);
    setOrderHistoryEntries([]);
    setOrderHistoryError("");
    setOrderHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("order_activity_log")
        .select("id, event_type, message, meta, actor_label, created_at")
        .eq("order_id", order.id)
        .neq("event_type", "mockups_uploaded")
        .order("created_at", { ascending: false });
      if (error) {
        if (error.message?.includes("order_activity_log") || error.code === "42P01") {
          setOrderHistoryError(
            "Activity log table not found. Run migration supabase/migrations/20260520180000_add_order_activity_log.sql in Supabase SQL Editor."
          );
        } else {
          setOrderHistoryError(error.message);
        }
        return;
      }
      setOrderHistoryEntries(data ?? []);
    } finally {
      setOrderHistoryLoading(false);
    }
  }

  function closeOrderHistory() {
    setOrderHistoryTarget(null);
    setOrderHistoryEntries([]);
    setOrderHistoryError("");
  }

  function openViewOrder(order) {
    setViewOrderTarget(order);
    setViewOrderFromTab(dashboardTab);
  }

  async function handleNotificationAssignmentOpen(item) {
    if (!item?.order_id) return;
    let order = orders.find((o) => o.id === item.order_id);
    if (!order) {
      const { data } = await supabase.from("orders").select("*").eq("id", item.order_id).maybeSingle();
      order = data ?? null;
    }
    if (!order) return;
    selectDashboardTab("printing");
    window.setTimeout(() => openViewOrder(order), 60);
  }

  async function handleNotificationInwardOpen(item) {
    if (!item?.inward_entry_id) return;
    selectDashboardTab("dispatch");
    setPendingDispatchSubview("inward");
    setPendingInwardEntryId(item.inward_entry_id);
  }

  function handleNotificationPrintingInventoryOpen() {
    selectDashboardTab("printing_department");
    setPendingPrintingSubview("inventory");
  }

  function handleOpenDashboardNotification(item) {
    if (!item) return;
    if (item.kind === "inward") {
      void handleNotificationInwardOpen(item);
      return;
    }
    if (item.kind === "printing_inventory") {
      handleNotificationPrintingInventoryOpen();
      return;
    }
    void handleNotificationAssignmentOpen(item);
  }

  function closeViewOrder() {
    setViewOrderTarget(null);
    setViewOrderFromTab(null);
  }

  async function refreshOrderHistory() {
    if (!orderHistoryTarget) return;
    await openOrderHistory(orderHistoryTarget);
  }

  async function handleMarkComplete(order) {
    if (order.is_complete) return;
    const ok = window.confirm(
      `Mark this job as complete? It will move to the Complete orders tab.\n${order.customer_name} · ${order.order_date} · Qty ${order.qty}`
    );
    if (!ok) return;
    const { error } = await supabase
      .from("orders")
      .update({ is_complete: true })
      .eq("id", order.id);
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, is_complete: true } : o))
    );
    setOrdersTab("complete");
    if (viewOrderTarget?.id === order.id) closeViewOrder();
    fetchOrders();
  }

  function openPreview(urls, index) {
    setPreviewImages(urls);
    setPreviewIndex(index);
  }

  function closePreview() {
    setPreviewImages([]);
    setPreviewIndex(0);
  }

  function nextPreview() {
    setPreviewIndex((prev) => (prev + 1) % previewImages.length);
  }

  function prevPreview() {
    setPreviewIndex((prev) => (prev - 1 + previewImages.length) % previewImages.length);
  }

  const activePipelineOrders = useMemo(
    () => orders.filter((o) => !o.is_complete),
    [orders]
  );

  const summary = useMemo(
    () =>
      STAGES.map((key) => ({
        key,
        label: STAGE_LABEL[key],
        count: activePipelineOrders.filter((o) => o.status === key).length
      })),
    [activePipelineOrders]
  );

  const homeLastUpdatedLabel = useMemo(() => {
    void homeRefreshTick;
    return formatHomeLastUpdated(homeRefreshedAt);
  }, [homeRefreshedAt, homeRefreshTick]);

  useEffect(() => {
    if (dashboardTab !== "home") return undefined;
    const id = window.setInterval(() => setHomeRefreshTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, [dashboardTab]);

  useEffect(() => {
    if (session?.user && !loadingOrders) {
      setHomeRefreshedAt(Date.now());
    }
  }, [session?.user?.id, loadingOrders]);

  async function refreshHomeStatus() {
    if (homeRefreshing) return;
    setHomeRefreshing(true);
    try {
      const ok = await fetchOrders({ silent: true });
      if (ok) {
        setHomeRefreshedAt(Date.now());
        setHomeRefreshTick((t) => t + 1);
      }
    } finally {
      setHomeRefreshing(false);
    }
  }

  const ordersInDateRange = useMemo(
    () => orders.filter((order) => isInSelectedDateRange(order.order_date)),
    [orders, dateFrom, dateTo]
  );

  const filteredOrders = useMemo(() => {
    return ordersInDateRange.filter((o) =>
      ordersTab === "complete" ? o.is_complete : !o.is_complete
    );
  }, [ordersInDateRange, ordersTab]);

  const coordinatorFilterOptions = useMemo(() => {
    const names = new Set();
    for (const c of coordinators) {
      const n = (c.name ?? "").trim();
      if (n) names.add(n);
    }
    for (const o of filteredOrders) {
      const n = String(coordinatorUpdates[o.id] ?? o.coordinator_name ?? "").trim();
      if (n) names.add(n);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [coordinators, filteredOrders, coordinatorUpdates]);

  const createFormCoordinatorOptions = useMemo(
    () =>
      createCoordinatorSelectOptions({
        coordinators,
        viewerProfiles,
        isAdmin: isAdminUser,
        currentUserName: profileDisplayName(profile)
      }),
    [coordinators, viewerProfiles, isAdminUser, profile?.full_name, profile?.email]
  );

  const profileLookupForAssignments = useMemo(
    () => buildProfileLookupList(teamProfiles, viewerProfiles, profile ? [profile] : []),
    [teamProfiles, viewerProfiles, profile]
  );

  const pushAssignmentToast = useCallback((row) => {
    const id = row?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAssignmentToasts((prev) => [
      ...prev,
      {
        id,
        kind: "assignment",
        orderId: row?.order_id,
        orderDisplayId: row?.order_display_id ?? "",
        coordinatorName: row?.coordinator_name ?? ""
      }
    ]);
  }, []);

  const pushInwardToast = useCallback((row) => {
    const id = row?.id != null ? `inward-${row.id}` : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAssignmentToasts((prev) => [
      ...prev,
      {
        id,
        kind: "inward",
        inwardEntryId: row?.inward_entry_id,
        productMaterial: row?.product_material ?? "",
        department: row?.department ?? "",
        grnNo: row?.grn_no ?? ""
      }
    ]);
  }, []);

  const pushPrintingInventoryToast = useCallback((row) => {
    const id = row?.id != null ? `printing-inv-${row.id}` : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAssignmentToasts((prev) => [
      ...prev,
      {
        id,
        kind: "printing_inventory",
        materialKey: row?.material_key ?? "",
        materialLabel: row?.material_label ?? "",
        currentStock: row?.current_stock,
        thresholdQty: row?.threshold_qty
      }
    ]);
  }, []);

  const dismissAssignmentToast = useCallback((id) => {
    setAssignmentToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  function handleAssignmentToastActivate(toast) {
    if (!toast) return;
    dismissAssignmentToast(toast.id);
    if (toast.kind === "inward") {
      void handleNotificationInwardOpen({ inward_entry_id: toast.inwardEntryId });
      return;
    }
    if (toast.kind === "printing_inventory") {
      handleNotificationPrintingInventoryOpen();
      return;
    }
    void handleNotificationAssignmentOpen({ order_id: toast.orderId });
  }

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return undefined;
    const channel = supabase
      .channel(`order-assignment-notifications-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_assignment_notifications",
          filter: `recipient_user_id=eq.${uid}`
        },
        (payload) => {
          const row = payload.new;
          if (row && typeof row === "object") {
            pushAssignmentToast(row);
            if (!muteStatusTones) {
              playTone(TONE_DEFAULT_STATUS);
            }
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, pushAssignmentToast]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return undefined;
    const channel = supabase
      .channel(`inward-entry-notifications-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "inward_entry_notifications",
          filter: `recipient_user_id=eq.${uid}`
        },
        (payload) => {
          const row = payload.new;
          if (!row || typeof row !== "object") return;
          pushInwardToast(row);
          if (!muteStatusTones) {
            playTone(TONE_DEFAULT_STATUS);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, pushInwardToast]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return undefined;
    const channel = supabase
      .channel(`printing-dept-inventory-notifications-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "printing_dept_inventory_notifications",
          filter: `recipient_user_id=eq.${uid}`
        },
        (payload) => {
          const row = payload.new;
          if (!row || typeof row !== "object") return;
          pushPrintingInventoryToast(row);
          if (!muteStatusTones) {
            playTone(TONE_DEFAULT_STATUS);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, pushPrintingInventoryToast]);

  useEffect(() => {
    if (!showCreateForm || profileLoading) return;
    const defaultName = profileDisplayName(profile);
    if (!defaultName) return;
    setOrderForm((prev) => {
      if (String(prev.coordinator_name ?? "").trim()) return prev;
      return { ...prev, coordinator_name: defaultName };
    });
  }, [showCreateForm, profileLoading, profile?.full_name, profile?.email]);

  const sortedFilteredOrders = useMemo(() => {
    const base = filterOrdersBySearch(filteredOrders, ordersSearchQuery);
    const coordName = (o) =>
      String(coordinatorUpdates[o.id] ?? o.coordinator_name ?? "").trim();
    if (orderSortCoordinator === "none") return base;
    if (orderSortCoordinator.startsWith("coord:")) {
      const target = orderSortCoordinator.slice(6);
      return base.filter((o) => coordName(o) === target);
    }
    return base;
  }, [filteredOrders, ordersSearchQuery, orderSortCoordinator, coordinatorUpdates]);

  const ordersSearchTrimmed = ordersSearchQuery.trim();

  const printingPaginationKey = `${ordersTab}|${dateFrom}|${dateTo}|${orderSortCoordinator}|${ordersSearchTrimmed}`;
  const {
    visible: printingVisibleOrders,
    total: printingTotalOrders,
    page: printingPage,
    setPage: setPrintingPage,
    pageSize: printingPageSize,
    setPageSize: setPrintingPageSize,
    totalPages: printingTotalPages
  } = usePagination(sortedFilteredOrders, "printing", printingPaginationKey);

  const ordersInDateRangeAll = useMemo(
    () => filterOrdersInDateRange(orders, dateFrom, dateTo),
    [orders, dateFrom, dateTo]
  );

  const productionTrackerOrders = useMemo(
    () => sortOrdersNewestFirst(filterProductionTrackerOrders(ordersInDateRangeAll)),
    [ordersInDateRangeAll]
  );

  const billingOrders = useMemo(
    () => sortOrdersNewestFirst(filterBillingOrders(ordersInDateRangeAll)),
    [ordersInDateRangeAll]
  );

  const dispatchOrders = useMemo(
    () => sortOrdersNewestFirst(filterDispatchOrders(ordersInDateRangeAll)),
    [ordersInDateRangeAll]
  );

  const ordersProcessedSummary = useMemo(() => {
    const count = sortedFilteredOrders.length;
    const totalQty = sortedFilteredOrders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
    const summaryLabel = ordersTab === "complete" ? "Jobs processed" : "Pending";
    const filterBits = [];
    if (ordersTab === "complete") filterBits.push("Complete orders");
    else filterBits.push("Pending");
    if (dateFrom && dateTo) filterBits.push(`${dateFrom} → ${dateTo}`);
    else if (dateFrom) filterBits.push(`From ${dateFrom}`);
    else if (dateTo) filterBits.push(`To ${dateTo}`);
    if (orderSortCoordinator.startsWith("coord:")) {
      filterBits.push(orderSortCoordinator.slice(6));
    }
    if (ordersSearchTrimmed) filterBits.push(`Search: “${ordersSearchTrimmed}”`);
    const hasFilters =
      ordersTab === "complete" ||
      Boolean(dateFrom || dateTo) ||
      orderSortCoordinator.startsWith("coord:") ||
      Boolean(ordersSearchTrimmed);
    return { count, totalQty, filterBits, hasFilters, summaryLabel };
  }, [sortedFilteredOrders, ordersTab, dateFrom, dateTo, orderSortCoordinator, ordersSearchTrimmed]);

  const activeViewOrder = useMemo(() => {
    if (!viewOrderTarget) return null;
    return (
      orders.find((o) => String(o.id) === String(viewOrderTarget.id)) ?? viewOrderTarget
    );
  }, [orders, viewOrderTarget]);

  function patchOrderInClient(orderId, patch, opts) {
    const idKey = String(orderId);
    if (opts?.rememberImagePatch && patch.approved_design_images) {
      recentImagePatchRef.current[idKey] = {
        at: Date.now(),
        approved_design_images: patch.approved_design_images,
        fields: patch
      };
    }
    setOrders((prev) =>
      prev.map((o) => (String(o.id) === idKey ? { ...o, ...patch } : o))
    );
    setViewOrderTarget((prev) =>
      prev && String(prev.id) === idKey ? { ...prev, ...patch } : prev
    );
  }

  useEffect(() => {
    if (!session?.user || profileLoading || profileError) return;
    const role = (profile?.role ?? "").trim().toLowerCase();
    if (ordersTab === "coordinator_report" || ordersTab === "product_revenue") {
      setOrdersTab("active");
    }
  }, [session?.user?.id, profile?.role, profileLoading, profileError, ordersTab]);

  const canAccessDashboardTabForSearch = useCallback(
    (tabId) => {
      if (!session?.user) return false;
      if (isAdminUser) return true;
      const perms = viewerPermissions[session.user.id] ?? {};
      return viewerCanAccessDashboardTab(perms, tabId);
    },
    [session?.user?.id, isAdminUser, viewerPermissions]
  );

  const patchAdminOrderDraft = useCallback((orderId, patch) => {
    setAdminOrderDrafts((prev) => {
      const orderRow = orders.find((o) => o.id === orderId);
      const base = prev[orderId] ?? buildAdminOrderDraftFromOrder(orderRow ?? {});
      const next = { ...base, ...patch };
      if (patch.sizes) {
        next.sizes = { ...base.sizes, ...patch.sizes };
      }
      return { ...prev, [orderId]: next };
    });
  }, [orders]);

  const filteredViewerProfiles = useMemo(
    () => filterViewerProfiles(viewerProfiles, viewerListSearch, viewerListStatusFilter),
    [viewerProfiles, viewerListSearch, viewerListStatusFilter]
  );

  const viewerListPaginationKey = `${viewerListSearch}|${viewerListStatusFilter}`;

  const {
    visible: visibleViewerProfiles,
    total: totalFilteredViewers,
    page: viewerListPage,
    setPage: setViewerListPage,
    pageSize: viewerListPageSize,
    setPageSize: setViewerListPageSize,
    totalPages: viewerListTotalPages
  } = usePagination(filteredViewerProfiles, "admin-viewer-users", viewerListPaginationKey);

  const editingViewer =
    editingViewerId != null ? viewerProfiles.find((v) => v.id === editingViewerId) ?? null : null;

  if (!session) {
    return (
      <div className="auth-page">
        <ThemeToggle
          theme={theme}
          onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="theme-toggle-btn theme-toggle-btn--floating"
        />
        <div className="panel auth-card">
          <div className="auth-brand">
            <img
              src="/brand-logo.png"
              alt=""
              className="auth-brand-logo"
              width={72}
              height={72}
            />
            <h1>Scott Dashboard</h1>
          </div>
          <form onSubmit={handleSignIn}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div className="auth-password-field">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                    />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            <button disabled={authLoading}>{authLoading ? "Signing in..." : "Sign in"}</button>
          </form>
        </div>
      </div>
    );
  }

  const normalizedRole = (profile?.role ?? "").trim().toLowerCase();
  const isAdmin = isAdminUser;
  const showAdminDeployTools = shouldShowAdminDeployTools();
  const isSalesReviewer = userIsSalesReviewer(profile, isAdmin);
  const isViewer = normalizedRole === "viewer";
  const currentUserPermissions = viewerPermissions[session?.user?.id] ?? {};
  const viewerCanCreateOrders =
    isViewer &&
    Boolean(currentUserPermissions.can_create_orders) &&
    viewerCanEditDashboardTab(currentUserPermissions, "printing");
  const viewerCanEditCurrentTab =
    isAdmin || viewerCanEditDashboardTab(currentUserPermissions, dashboardTab);
  const viewOrderTabCanEdit =
    isAdmin ||
    (viewOrderFromTab
      ? viewerCanEditDashboardTab(currentUserPermissions, viewOrderFromTab)
      : viewerCanEditCurrentTab);
  const viewerMayUpdateOrders =
    isAdmin || (isViewer && viewerHasAnyOrderFieldEdit(currentUserPermissions) && viewOrderTabCanEdit);
  const visibleSidebarMain = filterSidebarItemsForViewer(
    DASHBOARD_SIDEBAR_MAIN,
    currentUserPermissions,
    isAdmin
  );
  const visibleSidebarFooterWithChat = filterSidebarItemsForViewer(
    DASHBOARD_SIDEBAR_FOOTER,
    currentUserPermissions,
    isAdmin
  );
  const visibleSidebarMainById = new Map(visibleSidebarMain.map((item) => [item.id, item]));
  const visibleSidebarMainBySection = DASHBOARD_SIDEBAR_MAIN_SECTIONS.map((section) => ({
    label: section.label,
    items: section.ids.map((id) => visibleSidebarMainById.get(id)).filter(Boolean)
  })).filter((section) => section.items.length > 0);
  const currentDashboardTabLabel =
    dashboardTab === ADMIN_DASHBOARD_TAB.id
      ? ADMIN_DASHBOARD_TAB.label
      : dashboardTab === NOTIFICATIONS_DASHBOARD_TAB.id
        ? NOTIFICATIONS_DASHBOARD_TAB.label
        : DASHBOARD_SIDEBAR.find((item) => item.id === dashboardTab)?.label ?? "Menu";

  function openAdminPanel(view = "list") {
    setMasterListView(view);
    selectDashboardTab(ADMIN_DASHBOARD_TAB.id);
  }

  function selectDashboardTab(tabId) {
    setDashboardTab(tabId);
    setMobileNavOpen(false);
  }

  function clearGlobalSearchNavigation() {
    setPendingDispatchSubview(null);
    setPendingOutwardOcId(null);
    setPendingInwardEntryId(null);
  }

  function handleGlobalSearchSelect(item) {
    if (!item?.tabId) return;
    selectDashboardTab(item.tabId);
    if (item.dispatchSubview) {
      setPendingDispatchSubview(item.dispatchSubview);
    }
    if (item.kind === "outward_challan" && item.outwardChallan?.id != null) {
      setPendingOutwardOcId(item.outwardChallan.id);
      setPendingDispatchSubview("outward");
    }
    if (item.kind === "order" && item.order) {
      window.setTimeout(() => openViewOrder(item.order), 60);
    }
    setGlobalSearchQuery("");
  }

  const canCurrentUserEdit = (field) => {
    if (!viewOrderTabCanEdit && isViewer) return false;
    if (isAdmin) return true;
    if (!isViewer) return false;
    return viewerMayEditOrderField(currentUserPermissions, field);
  };

  const canUseOrderControls = !profileLoading && !profileError && (isAdmin || isViewer);

  async function persistOrderStatus(order, newStatus) {
    if (!canCurrentUserEdit("status") || !newStatus) return;
    if (newStatus === order.status) return;

    const orderId = order.id;
    const previousStatus = order.status;

    setStatusUpdates((prev) => ({ ...prev, [orderId]: newStatus }));
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );

    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", orderId);
    if (error) {
      setStatusUpdates((prev) => ({ ...prev, [orderId]: previousStatus }));
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: previousStatus } : o))
      );
      alert(error.message);
      return;
    }
    fetchOrders();
  }

  async function handleViewerUpdate(orderId) {
    const nextStatus = statusUpdates[orderId];
    const nextRemarks = remarksUpdates[orderId];
    const nextQty = qtyUpdates[orderId];
    const nextDueDate = dueDateUpdates[orderId];
    const nextPrintingMtrs = printingMtrsUpdates[orderId];
    const nextCoordinator = coordinatorUpdates[orderId];
    const nextReceivedAtLocal = receivedAtPrintingUpdates[orderId];
    const payload = {};

    if (canCurrentUserEdit("status") && nextStatus) payload.status = nextStatus;
    if (canCurrentUserEdit("remarks") && typeof nextRemarks === "string") {
      payload.remarks = nextRemarks.trim() || null;
    }
    if (canCurrentUserEdit("qty") && nextQty != null && nextQty !== "") {
      const n = Number(nextQty);
      if (!Number.isNaN(n) && n >= 0) payload.qty = n;
    }
    if (canCurrentUserEdit("due_date") && typeof nextDueDate === "string" && nextDueDate) {
      payload.due_date = nextDueDate;
    }
    if (canCurrentUserEdit("coordinator_name") && typeof nextCoordinator === "string" && nextCoordinator.trim()) {
      payload.coordinator_name = nextCoordinator.trim();
    }
    if (canCurrentUserEdit("printing_mtrs") && nextPrintingMtrs != null && nextPrintingMtrs !== "") {
      const n = Number(nextPrintingMtrs);
      if (!Number.isNaN(n) && n >= 0) payload.printing_mtrs = n;
    }
    if (canCurrentUserEdit("received_at_printing")) {
      const orderRow = orders.find((o) => o.id === orderId);
      const localVal =
        nextReceivedAtLocal !== undefined
          ? nextReceivedAtLocal
          : receivedAtToDatetimeLocalValue(orderRow?.received_at_printing ?? null);
      payload.received_at_printing = datetimeLocalToIsoOrNull(localVal);
    }

    if (isAdmin) {
      const orderRow = orders.find((o) => o.id === orderId);
      const draft = adminOrderDrafts[orderId] ?? buildAdminOrderDraftFromOrder(orderRow ?? {});
      Object.assign(payload, buildAdminOrderFieldsPayload(draft));
    }

    if (!Object.keys(payload).length) return;
    const { error } = await supabase.from("orders").update(payload).eq("id", orderId);
    if (error) {
      alert(error.message);
      return;
    }

    // Instant UI reflection without waiting for realtime subscription.
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              status: payload.status ?? order.status,
              remarks: Object.prototype.hasOwnProperty.call(payload, "remarks")
                ? payload.remarks
                : order.remarks,
              qty: payload.qty ?? order.qty,
              due_date: payload.due_date ?? order.due_date,
              coordinator_name: payload.coordinator_name ?? order.coordinator_name,
              printing_mtrs: Object.prototype.hasOwnProperty.call(payload, "printing_mtrs")
                ? payload.printing_mtrs
                : order.printing_mtrs,
              received_at_printing: Object.prototype.hasOwnProperty.call(payload, "received_at_printing")
                ? payload.received_at_printing
                : order.received_at_printing,
              order_date: payload.order_date ?? order.order_date,
              order_id: payload.order_id ?? order.order_id,
              owner_name: payload.owner_name ?? order.owner_name,
              customer_name: payload.customer_name ?? order.customer_name,
              product_name: payload.product_name ?? order.product_name,
              colors: payload.colors ?? order.colors,
              size_breakdown: payload.size_breakdown ?? order.size_breakdown,
              delivery_method: payload.delivery_method ?? order.delivery_method,
              order_cost: Object.prototype.hasOwnProperty.call(payload, "order_cost")
                ? payload.order_cost
                : order.order_cost,
              printing_cost: Object.prototype.hasOwnProperty.call(payload, "printing_cost")
                ? payload.printing_cost
                : order.printing_cost,
              is_production_order: Object.prototype.hasOwnProperty.call(payload, "is_production_order")
                ? payload.is_production_order
                : order.is_production_order,
              expected_handover_to_printing: Object.prototype.hasOwnProperty.call(
                payload,
                "expected_handover_to_printing"
              )
                ? payload.expected_handover_to_printing
                : order.expected_handover_to_printing
            }
          : order
      )
    );

    // Keep local selectors in sync after save.
    setStatusUpdates((prev) => ({ ...prev, [orderId]: payload.status ?? prev[orderId] }));
    if (Object.prototype.hasOwnProperty.call(payload, "remarks")) {
      setRemarksUpdates((prev) => ({ ...prev, [orderId]: payload.remarks ?? "" }));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "qty")) {
      setQtyUpdates((prev) => ({ ...prev, [orderId]: String(payload.qty) }));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "due_date")) {
      setDueDateUpdates((prev) => ({ ...prev, [orderId]: payload.due_date }));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "coordinator_name")) {
      setCoordinatorUpdates((prev) => ({ ...prev, [orderId]: payload.coordinator_name }));
      const orderRow = orders.find((o) => o.id === orderId);
      void insertOrderAssignmentNotification(supabase, {
        coordinatorName: payload.coordinator_name,
        orderId,
        orderDisplayId: orderRow?.order_id,
        assignedByUserId: session.user.id,
        profileLookup: profileLookupForAssignments
      });
    }
    if (Object.prototype.hasOwnProperty.call(payload, "printing_mtrs")) {
      setPrintingMtrsUpdates((prev) => ({ ...prev, [orderId]: String(payload.printing_mtrs) }));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "received_at_printing")) {
      setReceivedAtPrintingUpdates((prev) => ({
        ...prev,
        [orderId]: receivedAtToDatetimeLocalValue(payload.received_at_printing)
      }));
    }
    if (isAdmin) {
      setAdminOrderDrafts((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }

    // Fallback sync in case realtime event is delayed/disabled.
    fetchOrders();
  }

  async function updatePostDesignReview(order, { status, note }) {
    if (!session?.user) return;
    const payload = {
      post_approved_design_review_status: status,
      post_approved_design_changes_note:
        status === POST_DESIGN_REVIEW.NEEDS_CHANGES ? (note ?? "").trim() || null : null,
      post_approved_design_reviewed_by: session.user.id,
      post_approved_design_reviewed_at: new Date().toISOString()
    };
    const { error } = await supabase.from("orders").update(payload).eq("id", order.id);
    if (error) {
      alert(error.message);
      return false;
    }
    patchOrderInClient(order.id, payload);
    if (status !== POST_DESIGN_REVIEW.NEEDS_CHANGES) {
      setDesignReviewNoteOpen((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      setDesignReviewNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
    }
    fetchOrders({ silent: true });
    return true;
  }

  async function handleApprovePostDesign(order) {
    if (!isSalesReviewer) {
      alert("Only sales users can approve designs.");
      return;
    }
    setSavingDesignReviewOrderId(order.id);
    try {
      await updatePostDesignReview(order, { status: POST_DESIGN_REVIEW.APPROVED, note: null });
    } finally {
      setSavingDesignReviewOrderId(null);
    }
  }

  function openPostDesignChangesInput(order) {
    if (!isSalesReviewer) {
      alert("Only sales users can request design changes.");
      return;
    }
    setDesignReviewNoteOpen((prev) => ({ ...prev, [order.id]: true }));
    setDesignReviewNoteDrafts((prev) => ({
      ...prev,
      [order.id]: prev[order.id] ?? order.post_approved_design_changes_note ?? ""
    }));
  }

  async function handleSubmitPostDesignChanges(order) {
    if (!isSalesReviewer) {
      alert("Only sales users can request design changes.");
      return;
    }
    const note = String(designReviewNoteDrafts[order.id] ?? "").trim();
    if (!note) {
      alert("Describe the changes needed before submitting.");
      return;
    }
    setSavingDesignReviewOrderId(order.id);
    try {
      const ok = await updatePostDesignReview(order, {
        status: POST_DESIGN_REVIEW.NEEDS_CHANGES,
        note
      });
      if (ok) {
        setDesignReviewNoteOpen((prev) => {
          const next = { ...prev };
          delete next[order.id];
          return next;
        });
      }
    } finally {
      setSavingDesignReviewOrderId(null);
    }
  }

  async function handleUpdatePaymentMethod(order, newMethod) {
    if (!session?.user || !canCurrentUserEdit("payment_method")) return;
    const method = String(newMethod ?? "").trim();
    if (!method || method === order.payment_method) return;

    const orderId = order.id;
    const { error } = await supabase.from("orders").update({ payment_method: method }).eq("id", orderId);
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, payment_method: method } : o))
    );
    await fetchOrders({ silent: true });
  }

  async function handleAppendPaymentProof(order, fileList) {
    const files = filesFromImageInput(fileList);
    if (!files.length) {
      alert("Please choose an image file (PNG, JPG, WEBP, etc.).");
      return;
    }
    if (!session?.user || !canCurrentUserEdit("payment_method")) {
      alert("You do not have permission to update payment proof.");
      return;
    }
    const orderId = order.id;
    const idKey = String(orderId);
    const freshOrder = orders.find((o) => String(o.id) === idKey) ?? order;
    setUploadingPaymentProofOrderId(orderId);
    try {
      const existing = parsePaymentProofUrls(freshOrder.payment_screenshot_url);
      const nextUrls = [...existing];
      for (const file of files) {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
        const paymentPath = `${orderId}/${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("payment-screenshots")
          .upload(paymentPath, file, { upsert: true });
        if (uploadError) {
          alert(uploadError.message);
          return;
        }
        const { data: urlData } = supabase.storage.from("payment-screenshots").getPublicUrl(paymentPath);
        if (urlData?.publicUrl) nextUrls.push(urlData.publicUrl);
      }
      const serialized = serializePaymentProofUrls(nextUrls);
      const { error: saveError } = await supabase
        .from("orders")
        .update({ payment_screenshot_url: serialized })
        .eq("id", orderId);
      if (saveError) {
        alert(saveError.message);
        await fetchOrders({ silent: true });
        return;
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, payment_screenshot_url: serialized } : o))
      );
    } finally {
      setUploadingPaymentProofOrderId(null);
    }
  }

  async function handleArchiveApprovedDesignImages(order, removeUrls) {
    if (!session?.user) return;
    if (!canCurrentUserEdit("approved_design_images")) {
      alert("You do not have permission to update approved design images.");
      return;
    }
    if (effectivePostDesignReviewStatus(order) !== POST_DESIGN_REVIEW.NEEDS_CHANGES) {
      alert("Images can only be replaced while the job is in Need changes review.");
      return;
    }
    const orderId = order.id;
    const idKey = String(orderId);
    const freshOrder = orders.find((o) => String(o.id) === idKey) ?? order;
    const current = parseDesignUrls(freshOrder.approved_design_images);
    if (!current.length) return;

    const toRemove =
      removeUrls === "all"
        ? current
        : current.filter((url) => removeUrls.includes(url));
    if (!toRemove.length) return;

    const remaining = current.filter((url) => !toRemove.includes(url));
    const archived = mergeDesignUrlLists(freshOrder.approved_design_images_archive, toRemove);
    const payload = {
      approved_design_images: serializeDesignUrls(remaining),
      approved_design_images_archive: serializeDesignUrls(archived)
    };

    setArchivingPostDesignOrderId(orderId);
    try {
      patchOrderInClient(orderId, payload, {
        rememberImagePatch: Boolean(payload.approved_design_images)
      });
      const { error } = await supabase.from("orders").update(payload).eq("id", orderId);
      if (error) {
        alert(error.message);
        await fetchOrders({ silent: true });
        return;
      }
      if (!payload.approved_design_images) {
        delete recentImagePatchRef.current[idKey];
      }
    } finally {
      setArchivingPostDesignOrderId(null);
    }
  }

  async function handleAppendPostApprovedDesignImages(order, fileList) {
    const files = filesFromImageInput(fileList);
    if (!files.length) {
      alert("Please choose an image file (PNG, JPG, WEBP, etc.).");
      return;
    }
    if (!session?.user) return;
    if (!canCurrentUserEdit("approved_design_images")) {
      alert("You do not have permission to add approved design images.");
      return;
    }
    const orderId = order.id;
    const idKey = String(orderId);
    const freshOrder = orders.find((o) => String(o.id) === idKey) ?? order;
    setUploadingPostDesignOrderId(orderId);
    try {
      const existing = parseDesignUrls(freshOrder.approved_design_images);
      const nextUrls = [...existing];
      for (const file of files) {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
        const paths = [
          `post-approved/${orderId}/${safeName}`,
          `${session.user.id}/post-approved-${orderId}-${safeName}`
        ];
        let publicUrl = null;
        let lastUploadError = null;
        for (const uploadPath of paths) {
          const { error: uploadError } = await supabase.storage
            .from("approved-designs")
            .upload(uploadPath, file, { upsert: true });
          if (uploadError) {
            lastUploadError = uploadError;
            continue;
          }
          const { data: publicUrlData } = supabase.storage
            .from("approved-designs")
            .getPublicUrl(uploadPath);
          publicUrl = publicUrlData?.publicUrl ?? null;
          if (publicUrl) break;
        }
        if (!publicUrl) {
          alert(
            lastUploadError?.message ??
              "Could not upload image. Check storage permissions for the approved-designs bucket."
          );
          return;
        }
        nextUrls.push(publicUrl);
      }
      const serialized = JSON.stringify(nextUrls);
      const reviewWasApproved =
        effectivePostDesignReviewStatus(freshOrder) === POST_DESIGN_REVIEW.APPROVED;
      const clientPatch = {
        approved_design_images: serialized,
        ...(reviewWasApproved
          ? {}
          : {
              post_approved_design_review_status: POST_DESIGN_REVIEW.PENDING,
              post_approved_design_changes_note: null,
              post_approved_design_reviewed_by: null,
              post_approved_design_reviewed_at: null
            })
      };
      patchOrderInClient(orderId, clientPatch, { rememberImagePatch: true });

      const savePayload = reviewWasApproved
        ? { approved_design_images: serialized }
        : {
            approved_design_images: serialized,
            post_approved_design_review_status: POST_DESIGN_REVIEW.PENDING,
            post_approved_design_changes_note: null,
            post_approved_design_reviewed_by: null,
            post_approved_design_reviewed_at: null
          };

      const { error: saveError } = await supabase.from("orders").update(savePayload).eq("id", orderId);

      if (saveError) {
        delete recentImagePatchRef.current[idKey];
        alert(
          saveError.message.includes("approved_design_images")
            ? `${saveError.message}\n\nRun the latest Supabase migrations (approved design + fix upload SQL) if this persists.`
            : saveError.message
        );
        await fetchOrders({ silent: true });
        return;
      }

      setDesignReviewNoteOpen((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      setDesignReviewNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    } finally {
      setUploadingPostDesignOrderId(null);
    }
  }

  const headerUserName = profileLoading
    ? "Loading…"
    : profileError
      ? "—"
      : profile?.full_name?.trim() || profile?.email?.trim() || "User";
  const headerUserInitials = profileLoading
    ? "…"
    : userDisplayInitials(profile?.full_name, profile?.email);

  return (
    <div className="page app-layout">
      <div className="dashboard-shell">
        {mobileNavOpen ? (
          <button
            type="button"
            className="mobile-nav-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}
        <aside
          className={mobileNavOpen ? "dashboard-sidebar is-mobile-open" : "dashboard-sidebar"}
          role="navigation"
          aria-label="Dashboard menu"
        >
          <div className="dashboard-sidebar-brand">
            <img
              src="/brand-logo.png"
              alt=""
              className="dashboard-sidebar-logo"
              width={32}
              height={32}
            />
            <div className="dashboard-sidebar-brand-copy">
              <span className="dashboard-sidebar-brand-text">Scott Dashboard</span>
              <span className="dashboard-sidebar-brand-sub">Operations workspace</span>
            </div>
          </div>
          <div className="mobile-nav-drawer-head">
            <h2 className="mobile-nav-drawer-title">Menu</h2>
            <button
              type="button"
              className="mobile-nav-close"
              aria-label="Close menu"
              onClick={() => setMobileNavOpen(false)}
            >
              ×
            </button>
          </div>
          <nav className="dashboard-sidebar-nav">
            <div className="dashboard-sidebar-main">
              {visibleSidebarMainBySection.map((section) => (
                <div key={section.label} className="dashboard-sidebar-section">
                  <span className="dashboard-sidebar-section-label">{section.label}</span>
                  {section.items.map((item) => (
                    <DashboardSidebarItem
                      key={item.id}
                      item={item}
                      isActive={dashboardTab === item.id}
                      onSelect={selectDashboardTab}
                      showSoon={DASHBOARD_SIDEBAR_SOON_TAB_IDS.has(item.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="dashboard-sidebar-footer">
              <span className="dashboard-sidebar-section-label">Tools</span>
              <div className="dashboard-sidebar-footer-nav">
                {visibleSidebarFooterWithChat.map((item) => (
                  <DashboardSidebarItem
                    key={item.id}
                    item={item}
                    isActive={dashboardTab === item.id}
                    onSelect={selectDashboardTab}
                    showSoon={DASHBOARD_SIDEBAR_SOON_TAB_IDS.has(item.id)}
                  />
                ))}
                {isAdmin ? (
                  <DashboardSidebarItem
                    item={ADMIN_DASHBOARD_TAB}
                    isActive={dashboardTab === ADMIN_DASHBOARD_TAB.id}
                    onSelect={selectDashboardTab}
                  />
                ) : null}
              </div>
              <div className="dashboard-sidebar-user">
                <div className="dashboard-sidebar-user-avatar" aria-hidden="true">
                  {headerUserInitials}
                </div>
                <div className="dashboard-sidebar-user-meta">
                  <span className="dashboard-sidebar-user-name">{headerUserName}</span>
                  {!profileLoading && !profileError && profile?.department?.trim() ? (
                    <span className="dashboard-sidebar-user-dept" title="Department">
                      {profile.department.trim()}
                    </span>
                  ) : null}
                </div>
                <div className="dashboard-sidebar-user-actions">
                  <NotificationBellButton
                    userId={session?.user?.id}
                    active={dashboardTab === NOTIFICATIONS_DASHBOARD_TAB.id}
                    onOpen={() => selectDashboardTab(NOTIFICATIONS_DASHBOARD_TAB.id)}
                  />
                  <ThemeToggle
                    theme={theme}
                    onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                    className="theme-toggle-btn theme-toggle-btn--sidebar"
                  />
                </div>
              </div>
            </div>
          </nav>
        </aside>

        <div className="dashboard-workspace">
          <header className="dashboard-topbar">
            <div className="dashboard-topbar-context">
              <span className="dashboard-topbar-eyebrow">Dashboard</span>
              <h1 className="dashboard-topbar-title">{currentDashboardTabLabel}</h1>
            </div>
            <div className="dashboard-topbar-actions">
              <div className="dashboard-topbar-row dashboard-topbar-row--primary">
                <GlobalSearchBox
                  query={globalSearchQuery}
                  onQueryChange={setGlobalSearchQuery}
                  orders={orders}
                  outwardChallans={globalSearchOutwardChallans}
                  contacts={globalSearchContacts}
                  canAccessTab={canAccessDashboardTabForSearch}
                  onSelect={handleGlobalSearchSelect}
                  loadingExtras={globalSearchExtrasLoading}
                />
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      className="topbar-users-btn dashboard-topbar-btn dashboard-topbar-btn--primary"
                      onClick={() => openAdminPanel("list")}
                    >
                      Edit Users
                    </button>
                    <button
                      type="button"
                      className="topbar-archive-btn dashboard-topbar-btn"
                      onClick={() => setShowArchiveModal(true)}
                    >
                      Archive
                    </button>
                  </>
                ) : null}
                <button type="button" className="logout-btn dashboard-topbar-btn" onClick={handleSignOut}>
                  Logout
                </button>
              </div>
            </div>
          </header>

          {profileError && (
            <div className="panel profile-error-banner dashboard-banner">
              <strong>{profileError.startsWith("Cannot reach Supabase") ? "Connection:" : "Account setup:"}</strong>{" "}
              {profileError}{" "}
              {!profileError.startsWith("Cannot reach Supabase") && (
                <>
                  If you are an admin, add your email to <code>admin_emails</code> and run the latest{" "}
                  <code>supabase/schema.sql</code> in Supabase (RLS + profile rules).
                </>
              )}
            </div>
          )}

          {import.meta.env.DEV && getDeployEnvironment().isProduction ? (
            <div className="panel dashboard-env-danger-banner dashboard-banner" role="alert">
              <strong>Live database connected.</strong> This dev server is using production Supabase — changes here
              affect the hosted live app. Stop and use <code>npm run dev</code> (needs{" "}
              <code>.env.development</code>) or <code>npm run dev:staging</code> (needs <code>.env.staging</code>).
            </div>
          ) : null}

          <div className="dashboard-main">
          {isAdmin && masterTableMissing && (
            <p className="panel master-warning master-warning-banner">
              Supabase tables for <strong>owners</strong> or <strong>coordinators</strong> are missing. Run{" "}
              <code>supabase/migrations/20260613140000_repair_master_directory_tables.sql</code> in the SQL
              Editor (or <code>supabase db push</code>).
            </p>
          )}
          {isAdmin && salesInchargeTableMissing && !masterTableMissing && (
            <p className="panel master-warning master-warning-banner">
              <strong>Sales incharges</strong> table is missing (job sheet dropdown). Run{" "}
              <code>supabase/migrations/20260613140000_repair_master_directory_tables.sql</code> in the SQL
              Editor, then refresh.
            </p>
          )}

          {dashboardTab === "home" && (
            <section className="home-status-panel" aria-labelledby="home-status-title">
              <header className="home-status-head">
                <div className="home-status-head-text">
                  <h2 id="home-status-title" className="home-status-title">
                    Order counts by status
                  </h2>
                </div>
                <div className="home-status-refresh">
                  <button
                    type="button"
                    className={
                      homeRefreshing
                        ? "home-status-refresh-btn is-refreshing"
                        : "home-status-refresh-btn"
                    }
                    onClick={() => void refreshHomeStatus()}
                    disabled={homeRefreshing}
                    aria-label="Refresh order counts"
                    aria-busy={homeRefreshing}
                    title="Refresh order counts"
                  >
                    <svg
                      className="home-status-refresh-icon"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  <span className="home-status-updated" aria-live="polite">
                    {homeRefreshing ? "Refreshing…" : `Last updated: ${homeLastUpdatedLabel}`}
                  </span>
                </div>
              </header>

              <div className="home-status-grid">
                {summary.map((item) => (
                  <article
                    className={`home-stat-card home-stat-card--${item.key}`}
                    key={item.key}
                    aria-label={`${item.label}: ${item.count} ${item.count === 1 ? "order" : "orders"}`}
                  >
                    <div className="home-stat-card__icon-wrap">
                      {item.key === "new" ? (
                        <span className="home-stat-card__new-badge">NEW</span>
                      ) : (
                        renderStageIcon(item.key, item.label)
                      )}
                    </div>
                    <h3 className="home-stat-card__title">{item.label}</h3>
                    <p className="home-stat-card__count">{item.count}</p>
                    <p className="home-stat-card__label">{item.count === 1 ? "order" : "orders"}</p>
                  </article>
                ))}
              </div>

              {isAdmin ? (
                <section
                  className="home-printing-report-card"
                  aria-labelledby="home-printing-report-title"
                >
                  <header className="home-printing-report-head">
                    <h2 id="home-printing-report-title" className="home-printing-report-title">
                      Report of printing orders
                    </h2>
                  </header>
                  <CoordinatorReportPanel orders={orders} coordinators={coordinators} />
                </section>
              ) : null}

              {isAdmin ? (
                <section
                  className="home-printing-report-card"
                  aria-labelledby="home-product-revenue-title"
                >
                  <header className="home-printing-report-head">
                    <h2 id="home-product-revenue-title" className="home-printing-report-title">
                      Product revenue
                    </h2>
                  </header>
                  <ProductRevenuePanel orders={orders} />
                </section>
              ) : null}

            </section>
          )}

          {dashboardTab === "printing_department" && (
            <section className="panel table-panel dashboard-card dashboard-card--flat">
              <PrintingDepartmentPanel
                orders={orders}
                loadingOrders={loadingOrders}
                onViewOrder={openViewOrder}
                renderStageIcon={renderStageIcon}
                sessionUserId={session?.user?.id}
                canEdit={viewerCanEditCurrentTab}
                isAdmin={isAdmin}
                teamProfiles={teamProfiles}
                initialSubview={pendingPrintingSubview}
                onNavigateConsumed={() => setPendingPrintingSubview(null)}
              />
            </section>
          )}

          {dashboardTab === "printing" && (
      <section className="panel table-panel dashboard-card">
        <>
        <div className="table-filters">
          <div className="orders-tabs" role="tablist" aria-label="Order list view">
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === "active"}
              className={ordersTab === "active" ? "orders-tab is-active" : "orders-tab"}
              onClick={() => setOrdersTab("active")}
            >
              All orders
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === "complete"}
              className={ordersTab === "complete" ? "orders-tab is-active" : "orders-tab"}
              onClick={() => setOrdersTab("complete")}
            >
              Complete orders
            </button>
          </div>
          <>
              <label>
                From
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <button
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                Clear
              </button>
              <label>
                Coordinator
                <select
                  value={orderSortCoordinator}
                  onChange={(e) => setOrderSortCoordinator(e.target.value)}
                  aria-label="Filter orders by coordinator name"
                >
                  <option value="none">All coordinators</option>
                  {coordinatorFilterOptions.map((name) => (
                    <option key={name} value={`coord:${name}`}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="orders-search-field">
                Search
                <input
                  type="search"
                  className="orders-search-input"
                  placeholder="Order #, customer, coordinator…"
                  value={ordersSearchQuery}
                  onChange={(e) => setOrdersSearchQuery(e.target.value)}
                />
              </label>
              {ordersSearchTrimmed ? (
                <button type="button" onClick={() => setOrdersSearchQuery("")}>
                  Clear search
                </button>
              ) : null}
              <OrdersPerPageControl
                idPrefix="printing-orders-per-page"
                pageSize={printingPageSize}
                onPageSizeChange={setPrintingPageSize}
              />
          </>
          {session && (
            <div className="create-order-row create-order-row--in-card create-order-row--right">
              <button type="button" className="btn-mockup" onClick={() => setShowMockupStudio(true)}>
                Create Mockup
              </button>
              {(isAdmin || viewerCanCreateOrders) && (
                <>
                  <button
                    type="button"
                    className="btn-repeat-order"
                    onClick={openRepeatOrderPicker}
                    title="Create a new order pre-filled from an existing one"
                  >
                    Repeat Order
                  </button>
                  {!showCreateForm && (
                    <button type="button" onClick={openCreateOrderForm}>
                      Create New Order
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" onClick={handleExportCsv}>
                      Export
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {loadingOrders ? (
          <p>Loading orders...</p>
        ) : (
          <>
          <div className="orders-processed-summary" role="status" aria-live="polite">
            <div className="orders-processed-summary-main">
              <span className="orders-processed-label">{ordersProcessedSummary.summaryLabel}</span>
              <span className="orders-processed-count">{ordersProcessedSummary.count}</span>
            </div>
            <div className="orders-processed-summary-meta">
              <span className="orders-processed-qty">
                Total qty: <strong>{ordersProcessedSummary.totalQty}</strong>
              </span>
              {ordersProcessedSummary.hasFilters ? (
                <span className="orders-processed-filters">
                  {ordersProcessedSummary.filterBits.join(" · ")}
                </span>
              ) : null}
            </div>
          </div>
          <div className="table-wrap table-wrap--compact">
            <table className="orders-table-compact">
              <thead>
                <tr>
                  <th />
                  <th>Order number</th>
                  <th>Customer</th>
                  <th>Product name</th>
                  <th>Status</th>
                  <th>Coordinator</th>
                  <th>Delivery Date</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {printingVisibleOrders.map((order) => (
                  <tr key={order.id} className={dispatchRowHighlightClass(order) || undefined}>
                    <td>
                      <button
                        type="button"
                        className="btn-view-order"
                        onClick={() => openViewOrder(order)}
                      >
                        View order
                      </button>
                    </td>
                    <td className="orders-compact-id">
                      <OrderIdBadges orderId={order.order_id} />
                      {isDispatchVerificationFailed(order) ? (
                        <span className="dispatch-failed-badge">FAIL</span>
                      ) : null}
                    </td>
                    <td className="orders-compact-customer">
                      {order.customer_name?.trim() ? order.customer_name : "—"}
                    </td>
                    <td className="orders-compact-product">
                      {order.product_name?.trim() ? order.product_name : "—"}
                    </td>
                    <td>
                      <span
                        className={`status-pill status-pill--compact status-${order.status ?? "new"}`}
                      >
                        {renderStageIcon(order.status, STAGE_LABEL[order.status])}{" "}
                        {STAGE_LABEL[order.status] ?? order.status ?? "—"}
                      </span>
                    </td>
                    <td>{order.coordinator_name || "—"}</td>
                    <td>{formatDeliveryDate(order.due_date)}</td>
                    <td>{order.qty}</td>
                  </tr>
                ))}
                {printingTotalOrders === 0 && (
                  <tr>
                    <td colSpan={8}>
                      {ordersSearchTrimmed
                        ? "No orders match your search."
                        : ordersTab === "complete"
                          ? "No completed orders in the selected date range."
                          : "No orders found for selected date range."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <OrdersPagination
            page={printingPage}
            totalPages={printingTotalPages}
            onPageChange={setPrintingPage}
            total={printingTotalOrders}
            pageSize={printingPageSize}
          />
          </>
        )}
        </>
      </section>
          )}

          {dashboardTab === "regular" && (
            <section className="panel table-panel dashboard-card">
              <div className="dashboard-placeholder">
                <h3>Ready Stock Order</h3>
                <p>Coming soon — feature will be wired up later.</p>
              </div>
            </section>
          )}

          {dashboardTab === "shared_links" && (
            <SharedLinksPanel isAdmin={isAdmin} canEdit={viewerCanEditCurrentTab} />
          )}

          {dashboardTab === "contact_book" && (
            <ContactBookPanel
              isAdmin={isAdmin}
              canEdit={viewerCanEditCurrentTab}
              sessionUserId={session?.user?.id}
            />
          )}

          {dashboardTab === "asset_management" && (
            <section className="panel table-panel dashboard-card">
              <div className="dashboard-placeholder">
                <h3>Asset Management</h3>
                <p>Coming soon — feature will be wired up later.</p>
              </div>
            </section>
          )}

          {dashboardTab === "audit" && (
            <section className="panel table-panel dashboard-card">
              <div className="dashboard-placeholder">
                <h3>Audit</h3>
                <p>Coming soon — feature will be wired up later.</p>
              </div>
            </section>
          )}

          {dashboardTab === "distributor" && (
            <DistributorTabPanel
              canEdit={viewerCanEditCurrentTab}
              isAdmin={isAdmin}
              sessionUserId={session?.user?.id}
            />
          )}

          {dashboardTab === NOTIFICATIONS_DASHBOARD_TAB.id && session?.user && (
            <NotificationsPanel
              userId={session.user.id}
              onOpenNotification={handleOpenDashboardNotification}
            />
          )}

          {dashboardTab === "chat" && session?.user && (
            <TeamChatPanel
              sessionUserId={session.user.id}
              currentUserProfile={profile}
              teamProfiles={teamProfiles}
              orders={orders}
              onOpenOrder={openViewOrder}
            />
          )}

          {dashboardTab === "production_tracker" && (
            <section className="panel table-panel dashboard-card dashboard-card--flat">
          <LinkedOrdersTabPanel
            tabTitle="Production Tracker"
            paginationKey="production-tracker"
            summaryLabel="Production jobs"
            orders={productionTrackerOrders}
            loadingOrders={loadingOrders}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onClearDates={() => {
              setDateFrom("");
              setDateTo("");
            }}
            extraColumn={{
              header: "Handover to printing",
              render: (order) =>
                order.expected_handover_to_printing
                  ? formatDeliveryDate(order.expected_handover_to_printing)
                  : "—"
            }}
            emptyMessage="No production orders."
            onViewOrder={openViewOrder}
            renderStageIcon={renderStageIcon}
            canCreateJobSheet={isAdmin || viewerCanCreateOrders}
            onCreateJobSheet={openCreateProductionJobSheet}
          />
            </section>
          )}

          {dashboardTab === "billing" && (
            <section className="panel table-panel dashboard-card dashboard-card--flat">
              <BillingTabPanel
                orders={billingOrders}
                loadingOrders={loadingOrders}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onClearDates={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                onViewOrder={openViewOrder}
                onInvoiceUpdated={() => fetchOrders({ silent: true })}
                renderStageIcon={renderStageIcon}
                canEdit={viewerCanEditCurrentTab}
              />
            </section>
          )}

          {dashboardTab === "dispatch" && (
            <section className="panel table-panel dashboard-card dashboard-card--flat">
              <DispatchTabPanel
                orders={dispatchOrders}
                loadingOrders={loadingOrders}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onClearDates={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                onViewOrder={openViewOrder}
                onVerificationUpdated={() => fetchOrders({ silent: true })}
                renderStageIcon={renderStageIcon}
                canEdit={viewerCanEditCurrentTab}
                isAdmin={isAdmin}
                sessionUserId={session?.user?.id}
                teamProfiles={teamProfiles}
                initialDispatchSubview={pendingDispatchSubview}
                pendingOutwardOcId={pendingOutwardOcId}
                pendingInwardEntryId={pendingInwardEntryId}
                onNavigateConsumed={clearGlobalSearchNavigation}
              />
            </section>
          )}
          {dashboardTab === "inventory" && (
            <InventoryTabPanel session={session} />
          )}
          {dashboardTab === "admin" && isAdmin && (
            <section className="panel table-panel dashboard-card dashboard-card--flat">
              <div className="master-list-panel master-list-modal-wide">
                <div className="master-list-head">
                  <h3>Owners, coordinators & viewer users</h3>
                </div>

                  <div className="master-view-tabs" role="tablist" aria-label="Master view">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={masterListView === "create"}
                      className={masterListView === "create" ? "master-view-tab is-active" : "master-view-tab"}
                      onClick={() => {
                        setMasterListView("create");
                        setCreateUserError("");
                        setCreateUserSuccess("");
                      }}
                    >
                      Create user
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={masterListView === "list"}
                      className={masterListView === "list" ? "master-view-tab is-active" : "master-view-tab"}
                      onClick={() => setMasterListView("list")}
                    >
                      List users and permissions
                    </button>
                    {showAdminDeployTools && (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={masterListView === "deploy"}
                        className={masterListView === "deploy" ? "master-view-tab is-active" : "master-view-tab"}
                        onClick={() => setMasterListView("deploy")}
                      >
                        Test &amp; deploy
                      </button>
                    )}
                  </div>

                  {showAdminDeployTools && masterListView === "deploy" && (
                    <section className="admin-user-mgmt-card admin-deploy-card">
                      <div className="user-mgmt-header">
                        <h4 className="admin-user-mgmt-title">Test &amp; deploy</h4>
                      </div>
                      <AdminDeployPanel />
                    </section>
                  )}

                  {masterListView === "create" && (
                  <div className="create-user-section">
                    <div className="create-user-section-head">
                      <div>
                        <h4>Create new user</h4>
                      </div>
                    </div>
                    <form className="create-user-form" onSubmit={handleCreateUser}>
                      <div
                        className="create-user-inner-tabs"
                        role="tablist"
                        aria-label="Create user sections"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={createUserInnerTab === "details"}
                          className={
                            createUserInnerTab === "details"
                              ? "create-user-inner-tab is-active"
                              : "create-user-inner-tab"
                          }
                          onClick={() => setCreateUserInnerTab("details")}
                        >
                          User details
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={createUserInnerTab === "permissions"}
                          className={
                            createUserInnerTab === "permissions"
                              ? "create-user-inner-tab is-active"
                              : "create-user-inner-tab"
                          }
                          onClick={() => setCreateUserInnerTab("permissions")}
                        >
                          Permissions &amp; field access
                        </button>
                      </div>

                      {createUserInnerTab === "details" ? (
                        <div className="create-user-tab-panel" role="tabpanel">
                          <div className="create-user-grid">
                            <label>
                              Email
                              <input
                                type="email"
                                autoComplete="off"
                                placeholder="user@example.com"
                                value={newUserForm.email}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, email: e.target.value }))
                                }
                                required
                              />
                            </label>
                            <label>
                              Password
                              <input
                                type="text"
                                autoComplete="new-password"
                                placeholder="Min 6 characters"
                                value={newUserForm.password}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, password: e.target.value }))
                                }
                                required
                              />
                            </label>
                            <label>
                              Full name
                              <input
                                type="text"
                                placeholder="Display name"
                                value={newUserForm.full_name}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, full_name: e.target.value }))
                                }
                              />
                            </label>
                            <label>
                              Employee ID
                              <input
                                type="text"
                                placeholder="e.g. EMP001"
                                value={newUserForm.employee_id}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, employee_id: e.target.value }))
                                }
                              />
                            </label>
                            <label>
                              Department
                              <input
                                type="text"
                                placeholder="e.g. Stores"
                                value={newUserForm.department}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, department: e.target.value }))
                                }
                              />
                            </label>
                            <label>
                              Job role
                              <input
                                type="text"
                                placeholder="e.g. Store Keeper"
                                value={newUserForm.job_role}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, job_role: e.target.value }))
                                }
                              />
                            </label>
                            <label>
                              System role
                              <select
                                value={newUserForm.role}
                                onChange={(e) =>
                                  setNewUserForm((prev) => ({ ...prev, role: e.target.value }))
                                }
                              >
                                <option value="viewer">Viewer</option>
                                <option value="admin">Admin</option>
                              </select>
                            </label>
                          </div>
                          <label
                            className="viewer-tone-toggle viewer-tone-toggle--inline"
                            title="Play status-change tones on this user's dashboard"
                          >
                            <input
                              type="checkbox"
                              role="switch"
                              checked={newUserForm.status_tones_enabled !== false}
                              onChange={(e) =>
                                setNewUserForm((prev) => ({
                                  ...prev,
                                  status_tones_enabled: e.target.checked
                                }))
                              }
                            />
                            <span className="viewer-tone-toggle-track" aria-hidden="true">
                              <span className="viewer-tone-toggle-thumb" />
                            </span>
                            <span className="viewer-tone-toggle-label">
                              Status tone {newUserForm.status_tones_enabled !== false ? "ON" : "OFF"}
                            </span>
                          </label>
                        </div>
                      ) : (
                        <div className="create-user-tab-panel" role="tabpanel">
                          {newUserForm.role === "viewer" ? (
                            <div className="create-user-perms">
                              <p className="create-user-perms-title">Order field access</p>
                              <div className="viewer-permission-fields user-access-checkboxes">
                                {EDITABLE_FIELD_OPTIONS.map((option) => {
                                  const fieldKey = `can_edit_${option.key}`;
                                  return (
                                    <label key={fieldKey}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(newUserForm.permissions[fieldKey])}
                                        onChange={(e) =>
                                          updateNewUserPermission(fieldKey, e.target.checked)
                                        }
                                      />
                                      {option.label}
                                    </label>
                                  );
                                })}
                                <label className="viewer-perm-create-order">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(newUserForm.permissions.can_create_orders)}
                                    onChange={(e) =>
                                      updateNewUserPermission("can_create_orders", e.target.checked)
                                    }
                                  />
                                  Create new order
                                </label>
                              </div>
                              <p className="create-user-perms-title">Dashboard tabs</p>
                              <SidebarTabPermissionFields
                                idPrefix="new-user"
                                tabFlags={newUserForm.permissions.sidebar_tabs}
                                editFlags={newUserForm.permissions.sidebar_edit_tabs}
                                onViewChange={updateNewUserSidebarTab}
                                onEditChange={updateNewUserSidebarEditTab}
                              />
                            </div>
                          ) : null}
                        </div>
                      )}

                      {createUserError ? <p className="create-user-error">{createUserError}</p> : null}
                      {createUserSuccess ? (
                        <p className="create-user-success">{createUserSuccess}</p>
                      ) : null}
                      <div className="create-user-actions">
                        <button type="submit" className="btn-save-green" disabled={creatingUser}>
                          {creatingUser ? "Creating…" : "Create user"}
                        </button>
                        <button
                          type="button"
                          className="btn-admin-secondary"
                          onClick={() => {
                            resetNewUserForm();
                            setCreateUserError("");
                            setCreateUserSuccess("");
                          }}
                          disabled={creatingUser}
                        >
                          Clear
                        </button>
                      </div>
                    </form>
                  </div>
                  )}

                  {masterListView === "list" && (
                  <>
                  <section className="admin-user-mgmt-card viewer-users-section viewer-users-section-top">
                    <div className="user-mgmt-header">
                      <div>
                        <h4 className="admin-user-mgmt-title">User management</h4>
                      </div>
                      <button
                        type="button"
                        className="btn-admin-add btn-admin-add--header"
                        onClick={() => setMasterListView("create")}
                      >
                        + Create user
                      </button>
                    </div>

                    <div className="user-mgmt-toolbar">
                      <label className="user-mgmt-search">
                        <span className="user-mgmt-search-icon" aria-hidden>
                          ⌕
                        </span>
                        <input
                          type="search"
                          placeholder="Search by name, email or ID…"
                          value={viewerListSearch}
                          onChange={(e) => setViewerListSearch(e.target.value)}
                        />
                      </label>
                      <label className="user-mgmt-status-filter">
                        <span className="sr-only">Filter by status</span>
                        <select
                          value={viewerListStatusFilter}
                          onChange={(e) => setViewerListStatusFilter(e.target.value)}
                        >
                          <option value="all">All Status</option>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>
                    </div>

                    {viewerProfiles.length ? (
                      <>
                        <div className="users-access-table-wrap users-access-table-wrap--compact">
                          <table className="users-access-table users-access-table--compact">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>User name</th>
                                <th>Employee ID</th>
                                <th>Department</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleViewerProfiles.map((viewer, index) => {
                                const rowNum = (viewerListPage - 1) * viewerListPageSize + index + 1;
                                const active = viewerIsActive(viewer);
                                return (
                                  <tr key={viewer.id}>
                                    <td className="admin-master-index">{rowNum}</td>
                                    <td className="user-mgmt-name-cell">
                                      {viewer.full_name?.trim() || "—"}
                                    </td>
                                    <td>{viewer.employee_id?.trim() || "—"}</td>
                                    <td>{viewer.department?.trim() || "—"}</td>
                                    <td>{viewer.job_role?.trim() || "—"}</td>
                                    <td>
                                      <span
                                        className={
                                          active
                                            ? "user-status-pill user-status-pill--active"
                                            : "user-status-pill user-status-pill--inactive"
                                        }
                                      >
                                        {active ? "Active" : "Inactive"}
                                      </span>
                                    </td>
                                    <td>
                                      <div className="user-mgmt-icon-actions">
                                        <button
                                          type="button"
                                          className="user-mgmt-icon-btn user-mgmt-icon-btn--edit"
                                          title="Edit user & permissions"
                                          aria-label={`Edit ${viewer.full_name || viewer.email}`}
                                          onClick={() => openViewerEdit(viewer)}
                                        >
                                          <IconUserEdit />
                                        </button>
                                        <button
                                          type="button"
                                          className="user-mgmt-icon-btn user-mgmt-icon-btn--delete"
                                          title="Remove user"
                                          aria-label={`Remove ${viewer.full_name || viewer.email}`}
                                          disabled={removingUserId === viewer.id}
                                          onClick={() => handleRemoveUser(viewer)}
                                        >
                                          <IconUserDelete />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {visibleViewerProfiles.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="user-mgmt-empty-row">
                                    No users match this search or filter.
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                        <div className="user-mgmt-footer">
                          <OrdersPagination
                            page={viewerListPage}
                            totalPages={viewerListTotalPages}
                            onPageChange={setViewerListPage}
                            total={totalFilteredViewers}
                            pageSize={viewerListPageSize}
                          />
                          <OrdersPerPageControl
                            idPrefix="admin-viewers-per-page"
                            pageSize={viewerListPageSize}
                            onPageSizeChange={setViewerListPageSize}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="master-empty">No viewer accounts yet.</p>
                    )}
                  </section>

                  {editingViewer ? (
                    <ViewerUserEditModal
                      open={Boolean(editingViewer)}
                      viewer={editingViewer}
                      nameValue={
                        viewerNameDrafts[editingViewer.id] !== undefined
                          ? viewerNameDrafts[editingViewer.id]
                          : editingViewer.full_name ?? ""
                      }
                      employeeIdValue={
                        viewerEmployeeIdDrafts[editingViewer.id] !== undefined
                          ? viewerEmployeeIdDrafts[editingViewer.id]
                          : editingViewer.employee_id ?? ""
                      }
                      departmentValue={
                        viewerDepartmentDrafts[editingViewer.id] !== undefined
                          ? viewerDepartmentDrafts[editingViewer.id]
                          : editingViewer.department ?? ""
                      }
                      jobRoleValue={
                        viewerJobRoleDrafts[editingViewer.id] !== undefined
                          ? viewerJobRoleDrafts[editingViewer.id]
                          : editingViewer.job_role ?? ""
                      }
                      toneEnabled={
                        viewerToneDrafts[editingViewer.id] !== undefined
                          ? Boolean(viewerToneDrafts[editingViewer.id])
                          : editingViewer.status_tones_enabled !== false
                      }
                      isActive={
                        viewerActiveDrafts[editingViewer.id] !== undefined
                          ? Boolean(viewerActiveDrafts[editingViewer.id])
                          : viewerIsActive(editingViewer)
                      }
                      permissionDraft={
                        permissionDrafts[editingViewer.id] ??
                        hydrateDraftFromPermission(viewerPermissions[editingViewer.id] ?? {})
                      }
                      onNameChange={(v) =>
                        setViewerNameDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onEmployeeIdChange={(v) =>
                        setViewerEmployeeIdDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onDepartmentChange={(v) =>
                        setViewerDepartmentDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onJobRoleChange={(v) =>
                        setViewerJobRoleDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onToneChange={(v) =>
                        setViewerToneDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onActiveChange={(v) =>
                        setViewerActiveDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onPermissionChange={(fieldKey, checked) =>
                        updatePermissionDraft(editingViewer.id, fieldKey, checked)
                      }
                      onSidebarViewChange={(tabId, checked) =>
                        updateSidebarTabDraft(editingViewer.id, tabId, checked)
                      }
                      onSidebarEditChange={(tabId, checked) =>
                        updateSidebarEditTabDraft(editingViewer.id, tabId, checked)
                      }
                      resetPasswordDraft={resetPasswordDrafts[editingViewer.id]}
                      onOpenResetPassword={() => openResetPassword(editingViewer.id)}
                      onResetPasswordDraftChange={(v) =>
                        setResetPasswordDrafts((prev) => ({ ...prev, [editingViewer.id]: v }))
                      }
                      onCancelResetPassword={() => cancelResetPassword(editingViewer.id)}
                      onResetPassword={() => handleResetPassword(editingViewer.id)}
                      resettingPassword={resettingPasswordFor === editingViewer.id}
                      onSave={() => handleSaveViewerRow(editingViewer.id)}
                      onResetPermissions={() => handleResetViewerPermissions(editingViewer.id)}
                      onRemove={() => handleRemoveUser(editingViewer)}
                      removing={removingUserId === editingViewer.id}
                      onClose={closeViewerEdit}
                    />
                  ) : null}

                  <section className="admin-user-mgmt-card admin-master-directory-card">
                    <div className="user-mgmt-header">
                      <div>
                        <h4 className="admin-user-mgmt-title">Owners, coordinators &amp; sales incharges</h4>
                      </div>
                    </div>
                    <div className="admin-master-toolbar">
                      <div className="admin-master-add-inline">
                        <input
                          type="text"
                          className="admin-master-input"
                          placeholder="Owner name"
                          value={newOwnerName}
                          onChange={(e) => setNewOwnerName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddOwner();
                            }
                          }}
                        />
                        <button type="button" className="btn-admin-add" onClick={handleAddOwner}>
                          Add owner
                        </button>
                      </div>
                      <div className="admin-master-add-inline">
                        <input
                          type="text"
                          className="admin-master-input"
                          placeholder="Coordinator name"
                          value={newCoordinatorName}
                          onChange={(e) => setNewCoordinatorName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddCoordinator();
                            }
                          }}
                        />
                        <button type="button" className="btn-admin-add" onClick={handleAddCoordinator}>
                          Add coordinator
                        </button>
                      </div>
                      <div className="admin-master-add-inline">
                        <input
                          type="text"
                          className="admin-master-input"
                          placeholder="Sales incharge name"
                          value={newSalesInchargeName}
                          onChange={(e) => setNewSalesInchargeName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddSalesIncharge();
                            }
                          }}
                        />
                        <button type="button" className="btn-admin-add" onClick={handleAddSalesIncharge}>
                          Add sales incharge
                        </button>
                      </div>
                    </div>
                    {owners.length || coordinators.length || salesIncharges.length ? (
                      <div className="users-access-table-wrap users-access-table-wrap--compact users-access-table-wrap--master-scroll">
                        <table className="users-access-table users-access-table--compact">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Name</th>
                              <th>Type</th>
                              <th className="user-mgmt-action-col">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {owners.map((owner, index) => (
                              <tr key={`owner-${owner.id}`}>
                                <td className="admin-master-index">{index + 1}</td>
                                <td className="user-mgmt-name-cell">
                                  <span className="admin-master-name">{owner.name}</span>
                                </td>
                                <td>
                                  <span className="admin-master-type-pill admin-master-type-pill--owner">
                                    Owner
                                  </span>
                                </td>
                                <td>
                                  <div className="user-mgmt-icon-actions">
                                    <button
                                      type="button"
                                      className="user-mgmt-icon-btn user-mgmt-icon-btn--delete"
                                      title="Remove owner"
                                      aria-label={`Remove owner ${owner.name}`}
                                      onClick={() => handleDeleteOwner(owner)}
                                    >
                                      <IconUserDelete />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {coordinators.map((coordinator, index) => (
                              <tr key={`coord-${coordinator.id}`}>
                                <td className="admin-master-index">{owners.length + index + 1}</td>
                                <td className="user-mgmt-name-cell">
                                  <span className="admin-master-name">{coordinator.name}</span>
                                </td>
                                <td>
                                  <span className="admin-master-type-pill admin-master-type-pill--coordinator">
                                    Coordinator
                                  </span>
                                </td>
                                <td>
                                  <div className="user-mgmt-icon-actions">
                                    <button
                                      type="button"
                                      className="user-mgmt-icon-btn user-mgmt-icon-btn--delete"
                                      title="Remove coordinator"
                                      aria-label={`Remove coordinator ${coordinator.name}`}
                                      onClick={() => handleDeleteCoordinator(coordinator)}
                                    >
                                      <IconUserDelete />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {salesIncharges.map((row, index) => (
                              <tr key={`sales-${row.id}`}>
                                <td className="admin-master-index">
                                  {owners.length + coordinators.length + index + 1}
                                </td>
                                <td className="user-mgmt-name-cell">
                                  <span className="admin-master-name">{row.name}</span>
                                </td>
                                <td>
                                  <span className="admin-master-type-pill admin-master-type-pill--sales">
                                    Sales incharge
                                  </span>
                                </td>
                                <td>
                                  <div className="user-mgmt-icon-actions">
                                    <button
                                      type="button"
                                      className="user-mgmt-icon-btn user-mgmt-icon-btn--delete"
                                      title="Remove sales incharge"
                                      aria-label={`Remove sales incharge ${row.name}`}
                                      onClick={() => handleDeleteSalesIncharge(row)}
                                    >
                                      <IconUserDelete />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="master-empty">No owners, coordinators, or sales incharges yet.</p>
                    )}
                  </section>
                  </>
                  )}
              </div>
            </section>
          )}
          </div>
        </div>
      </div>

      <div className="mobile-nav-bar">
        <span className="mobile-nav-current">{currentDashboardTabLabel}</span>
        <button
          type="button"
          className="mobile-nav-menu-btn"
          aria-label="Open menu"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <span className="mobile-nav-menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>
      {repeatOrderPickerOpen && (isAdmin || viewerCanCreateOrders) && (
        <div
          className="image-modal-backdrop repeat-order-modal-backdrop"
          onClick={closeRepeatOrderPicker}
        >
          <div
            className="repeat-order-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="repeat-order-modal-title"
          >
            <div className="repeat-order-modal-head">
              <h2 id="repeat-order-modal-title">Repeat order templates</h2>
              <button
                type="button"
                className="order-detail-close"
                aria-label="Close repeat order"
                onClick={closeRepeatOrderPicker}
              >
                ×
              </button>
            </div>
            <div className="repeat-order-templates">
              <div className="repeat-order-templates-head">
                <h3>Saved templates</h3>
                {templateDraft ? null : (
                  <button
                    type="button"
                    className="btn-repeat-order repeat-order-add-btn"
                    onClick={startNewTemplate}
                  >
                    + New template
                  </button>
                )}
              </div>
              {loadingOrderTemplates ? (
                <p className="repeat-order-empty">Loading templates…</p>
              ) : orderTemplates.length === 0 ? (
                <p className="repeat-order-empty">No templates yet.</p>
              ) : (
                <ul className="repeat-order-template-grid">
                  {orderTemplates.map((tpl) => {
                    const qty =
                      tpl.size_breakdown && typeof tpl.size_breakdown === "object"
                        ? Object.values(tpl.size_breakdown).reduce(
                            (sum, v) => sum + (Number.parseInt(v, 10) || 0),
                            0
                          )
                        : 0;
                    const coverPath = Array.isArray(tpl.image_paths) ? tpl.image_paths[0] : null;
                    const coverUrl = coverPath ? templateImagePublicUrl(coverPath) : null;
                    const imageCount = Array.isArray(tpl.image_paths) ? tpl.image_paths.length : 0;
                    return (
                      <li key={tpl.id} className="repeat-order-template-card">
                        <div className="repeat-order-template-card-head">
                          <div className="repeat-order-template-name">{tpl.name}</div>
                          {imageCount > 1 ? (
                            <span className="repeat-order-template-image-count">
                              +{imageCount - 1} more
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={`repeat-order-template-card-image ${
                            coverUrl ? "has-image" : "is-empty"
                          }`}
                        >
                          {coverUrl ? (
                            <img src={coverUrl} alt={`Reference for ${tpl.name}`} loading="lazy" />
                          ) : (
                            <span className="repeat-order-template-image-placeholder">
                              Reference image
                            </span>
                          )}
                        </div>
                        <div className="repeat-order-template-meta">
                          {tpl.customer_name ? <span>{tpl.customer_name}</span> : null}
                          {tpl.product_name ? <span>{tpl.product_name}</span> : null}
                          {qty > 0 ? <span>Qty {qty}</span> : null}
                        </div>
                        <div className="repeat-order-template-actions">
                          <button
                            type="button"
                            className="btn-repeat-order"
                            onClick={() => handleUseTemplate(tpl)}
                          >
                            Use
                          </button>
                          <button
                            type="button"
                            className="repeat-order-template-btn"
                            onClick={() => startEditTemplate(tpl)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="repeat-order-template-btn repeat-order-template-btn--danger"
                            onClick={() => handleDeleteTemplate(tpl)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {templateDraft ? (
              <form className="repeat-order-template-form" onSubmit={handleSaveTemplate}>
                <h3>
                  {templateEditingId === "new" ? "New template" : "Edit template"}
                </h3>
                <div className="repeat-order-form-grid">
                  <label>
                    Template name
                    <input
                      type="text"
                      required
                      placeholder="e.g. Acme weekly cotton tee"
                      value={templateDraft.name}
                      onChange={(e) => updateTemplateDraft({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    Customer
                    <input
                      type="text"
                      value={templateDraft.customer_name}
                      onChange={(e) => updateTemplateDraft({ customer_name: e.target.value })}
                    />
                  </label>
                  <label>
                    Owner
                    <select
                      value={templateDraft.owner_name}
                      onChange={(e) => updateTemplateDraft({ owner_name: e.target.value })}
                    >
                      <option value="">—</option>
                      {owners.map((o) => (
                        <option key={o.id ?? o.name} value={o.name}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Coordinator
                    <select
                      value={templateDraft.coordinator_name}
                      onChange={(e) => updateTemplateDraft({ coordinator_name: e.target.value })}
                    >
                      <option value="">—</option>
                      {createFormCoordinatorOptions.map((opt) => (
                        <option key={opt.id} value={opt.name}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="repeat-order-form-wide">
                    Product name
                    <input
                      type="text"
                      value={templateDraft.product_name}
                      onChange={(e) => updateTemplateDraft({ product_name: e.target.value })}
                    />
                  </label>
                  <div
                    className="repeat-order-form-wide repeat-order-colors-field colors-field"
                    ref={templateColorPickerRef}
                  >
                    <span className="repeat-order-colors-label">Colors</span>
                    <button
                      type="button"
                      className={`color-field-trigger ${templateColorPickerOpen ? "is-open" : ""}`}
                      aria-label="Colors"
                      aria-expanded={templateColorPickerOpen}
                      aria-haspopup="dialog"
                      aria-controls="template-color-picker-popover"
                      onClick={() => setTemplateColorPickerOpen((o) => !o)}
                    >
                      <span className="color-field-trigger__value">
                        {(templateDraft.colors ?? []).length === 0 ? (
                          <span className="color-field-placeholder">Click to choose colors…</span>
                        ) : (
                          templateDraft.colors.map((c, i) => (
                            <span
                              key={`${c}-${i}`}
                              className="color-field-trigger__dot"
                              style={
                                isCssColorString(c)
                                  ? { backgroundColor: c, backgroundImage: "none" }
                                  : undefined
                              }
                              title={c}
                              aria-hidden
                            />
                          ))
                        )}
                      </span>
                      <span className="color-field-trigger__chevron" aria-hidden>
                        {templateColorPickerOpen ? "▲" : "▼"}
                      </span>
                    </button>
                    {templateColorPickerOpen ? (
                      <div
                        id="template-color-picker-popover"
                        className="color-picker-popover"
                        role="dialog"
                        aria-label="Choose colors"
                      >
                        <div className="color-palette" role="group" aria-label="Color swatches">
                          {ORDER_COLOR_PALETTE.map((hex, idx) => {
                            const selected = (templateDraft.colors ?? []).some(
                              (c) => normalizeColorKey(c) === hex
                            );
                            return (
                              <button
                                key={`tpl-swatch-${idx}`}
                                type="button"
                                className={`color-palette-swatch ${selected ? "is-selected" : ""}`}
                                style={{ backgroundColor: hex, backgroundImage: "none" }}
                                aria-label={selected ? `${hex}, selected` : hex}
                                aria-pressed={selected}
                                onClick={() => toggleTemplatePaletteColor(hex)}
                              >
                                {selected ? (
                                  <span className="color-palette-check" aria-hidden>
                                    ✓
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                        {(templateDraft.colors ?? []).length > 0 ? (
                          <div
                            className="color-chips color-chips--in-panel"
                            aria-label="Selected colors"
                          >
                            {templateDraft.colors.map((color, i) => (
                              <span
                                key={`${color}-${i}`}
                                className="color-chip color-chip--picked"
                              >
                                {isCssColorString(color) ? (
                                  <span
                                    className="color-chip-swatch"
                                    style={{ backgroundColor: color, backgroundImage: "none" }}
                                    aria-hidden
                                  />
                                ) : null}
                                <span className="color-chip-code">{color}</span>
                                <button
                                  type="button"
                                  className="color-chip-remove"
                                  onClick={() => removeTemplateColor(color)}
                                  aria-label={`Remove ${color}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="color-picker-popover__footer">
                          <button
                            type="button"
                            className="color-picker-done-btn"
                            onClick={() => setTemplateColorPickerOpen(false)}
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <label>
                    Printing mtrs
                    <input
                      type="text"
                      inputMode="decimal"
                      value={templateDraft.printing_mtrs}
                      onChange={(e) => updateTemplateDraft({ printing_mtrs: e.target.value })}
                    />
                  </label>
                  <label>
                    Order cost
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={templateDraft.order_cost}
                      onChange={(e) => updateTemplateDraft({ order_cost: e.target.value })}
                    />
                  </label>
                  <label>
                    Printing cost
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={templateDraft.printing_cost}
                      onChange={(e) => updateTemplateDraft({ printing_cost: e.target.value })}
                    />
                  </label>
                  <label>
                    Payment method
                    <select
                      value={templateDraft.payment_method}
                      onChange={(e) => updateTemplateDraft({ payment_method: e.target.value })}
                    >
                      <option value="">—</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Delivery method
                    <select
                      value={templateDraft.delivery_method}
                      onChange={(e) => updateTemplateDraft({ delivery_method: e.target.value })}
                    >
                      <option value="">—</option>
                      {DELIVERY_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="repeat-order-form-check">
                    <input
                      type="checkbox"
                      checked={Boolean(templateDraft.is_production_order)}
                      onChange={(e) =>
                        updateTemplateDraft({ is_production_order: e.target.checked })
                      }
                    />
                    Production order
                  </label>
                  {templateDraft.is_production_order ? (
                    <label>
                      Expected handover to printing
                      <input
                        type="date"
                        value={templateDraft.expected_handover_to_printing ?? ""}
                        onChange={(e) =>
                          updateTemplateDraft({ expected_handover_to_printing: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                </div>

                <fieldset className="repeat-order-sizes">
                  <legend>Default size breakdown (qty per size)</legend>
                  <div className="repeat-order-sizes-grid">
                    {ORDER_SIZE_COLUMNS.map(({ key, label }) => (
                      <label key={key}>
                        {label}
                        <input
                          type="text"
                          inputMode="numeric"
                          value={templateDraft.sizes?.[key] ?? ""}
                          onChange={(e) => updateTemplateDraftSize(key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  {(templateDraft.extraSizes ?? []).map((row) => (
                    <div className="repeat-order-extra-size" key={row.id}>
                      <input
                        type="text"
                        placeholder="Custom size (e.g. 4XL)"
                        value={row.label}
                        onChange={(e) =>
                          updateTemplateExtraSize(row.id, { label: e.target.value })
                        }
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Qty"
                        value={row.qty}
                        onChange={(e) => updateTemplateExtraSize(row.id, { qty: e.target.value })}
                      />
                      <button
                        type="button"
                        className="repeat-order-template-btn repeat-order-template-btn--danger"
                        onClick={() => removeTemplateExtraSize(row.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="repeat-order-template-btn"
                    onClick={addTemplateExtraSize}
                  >
                    + Add custom size
                  </button>
                </fieldset>

                <label className="repeat-order-form-wide repeat-order-form-textarea">
                  Remarks
                  <textarea
                    rows={2}
                    value={templateDraft.remarks}
                    onChange={(e) => updateTemplateDraft({ remarks: e.target.value })}
                  />
                </label>

                <fieldset className="repeat-order-images">
                  <legend>Reference images</legend>
                  <div className="repeat-order-image-grid">
                    {(templateDraft.existingImagePaths ?? []).map((path) => {
                      const url = templateImagePublicUrl(path);
                      return (
                        <div key={path} className="repeat-order-image-thumb">
                          {url ? <img src={url} alt="Saved reference" /> : null}
                          <button
                            type="button"
                            className="repeat-order-image-remove"
                            aria-label="Remove saved image"
                            onClick={() => removeTemplateExistingImage(path)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    {(templateDraft.newImageFiles ?? []).map((file, idx) => {
                      const url = URL.createObjectURL(file);
                      return (
                        <div
                          key={`${file.name}-${idx}`}
                          className="repeat-order-image-thumb repeat-order-image-thumb--pending"
                        >
                          <img
                            src={url}
                            alt="New reference"
                            onLoad={() => URL.revokeObjectURL(url)}
                          />
                          <span className="repeat-order-image-pending-badge">Pending upload</span>
                          <button
                            type="button"
                            className="repeat-order-image-remove"
                            aria-label="Remove pending image"
                            onClick={() => removeTemplateNewImage(idx)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      handleTemplateImageFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </fieldset>

                <div className="repeat-order-form-actions">
                  <button type="button" onClick={cancelTemplateDraft} disabled={savingTemplate}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-repeat-order"
                    disabled={savingTemplate}
                  >
                    {savingTemplate
                      ? "Saving…"
                      : templateEditingId === "new"
                        ? "Save template"
                        : "Update template"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      )}
      {showCreateForm &&
        (dashboardTab === "printing" || dashboardTab === "production_tracker") &&
        (isAdmin || viewerCanCreateOrders) && (
        <div
          className="image-modal-backdrop create-order-modal-backdrop"
          onClick={closeCreateOrderForm}
        >
          <div
            className="create-order-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-order-modal-title"
          >
            <div className="create-order-modal-head">
              <h2 id="create-order-modal-title">
                {createFormMode === "job_sheet"
                  ? "Create Job sheet"
                  : isAdmin
                    ? "Create New Order (Master Admin)"
                    : "Create New Order"}
              </h2>
              <button
                type="button"
                className="order-detail-close create-order-modal-close"
                aria-label="Close create order"
                onClick={closeCreateOrderForm}
              >
                ×
              </button>
            </div>
            <div className="create-order-modal-body">
              {createFormMode === "job_sheet" ? (
                <CreateJobSheetForm
                  form={jobSheetForm}
                  onChange={setJobSheetForm}
                  salesIncharges={salesIncharges}
                  saving={savingJobSheet}
                  onSubmit={handleCreateJobSheet}
                  onCancel={closeCreateOrderForm}
                />
              ) : (
              <form className="order-form order-form--modal" onSubmit={handleCreateOrder}>
            <div className="order-form-cell">
              <label htmlFor="create-order-date">Order date</label>
              <input
                id="create-order-date"
                type="text"
                readOnly
                className="order-form-readonly-input"
                value={todayLocalISODate()}
              />
            </div>
            <div className="order-form-cell order-form-orderid-multi">
              <label htmlFor="create-order-external-id">Order IDs</label>
              <div className="order-id-multi">
                <div className="order-id-multi-field" role="group" aria-label="Order IDs">
                  {Array.isArray(orderForm.order_ids) && orderForm.order_ids.length ? (
                    <div className="order-id-multi-chips" aria-label="Selected order ids">
                      {orderForm.order_ids.map((id) => (
                        <span key={id} className="order-id-chip">
                          <span className="order-id-chip-value">{id}</span>
                          <button
                            type="button"
                            className="order-id-chip-remove"
                            aria-label={`Remove ${id}`}
                            onClick={() => removeOrderIdToken(id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <input
                    id="create-order-external-id"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={
                      Array.isArray(orderForm.order_ids) && orderForm.order_ids.length
                        ? "Add another…"
                        : "Type order id and press Enter (e.g. 01323)"
                    }
                    value={orderIdDraft}
                    onChange={(e) => setOrderIdDraft(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addOrderIdsFromRaw(orderIdDraft);
                        setOrderIdDraft("");
                      }
                      if (e.key === "," || e.key === ";") {
                        e.preventDefault();
                        addOrderIdsFromRaw(orderIdDraft);
                        setOrderIdDraft("");
                      }
                      if (e.key === "Backspace" && !orderIdDraft) {
                        const cur = orderForm.order_ids ?? [];
                        const last = cur[cur.length - 1];
                        if (last) removeOrderIdToken(last);
                      }
                    }}
                    onBlur={() => {
                      if (orderIdDraft.trim()) {
                        addOrderIdsFromRaw(orderIdDraft);
                        setOrderIdDraft("");
                      }
                    }}
                    onPaste={(e) => {
                      const text = e.clipboardData?.getData("text") ?? "";
                      const digitsOnly = String(text).replace(/\D/g, "");
                      const tokens = parseOrderIdTokens(text);
                      if (tokens.length > 1) {
                        e.preventDefault();
                        addOrderIdsFromRaw(text);
                        setOrderIdDraft("");
                        return;
                      }
                      // single token paste: just keep digits in the input
                      if (digitsOnly !== text) {
                        e.preventDefault();
                        setOrderIdDraft(digitsOnly);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="order-id-multi-add"
                    onClick={() => {
                      addOrderIdsFromRaw(orderIdDraft);
                      setOrderIdDraft("");
                    }}
                    aria-label="Add order id"
                    title="Add"
                  >
                    +
                  </button>
                  {Array.isArray(orderForm.order_ids) && orderForm.order_ids.length ? (
                    <button
                      type="button"
                      className="order-id-multi-clear"
                      onClick={clearAllOrderIds}
                      title="Clear all"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="order-form-cell">
              <label htmlFor="create-order-due-date">Delivery Date</label>
              <input
                id="create-order-due-date"
                name="due_date"
                type="date"
                value={orderForm.due_date}
                onChange={onOrderFormChange}
                required
              />
            </div>
            <div className="order-form-cell order-form-span-3 order-form-production-block">
              <div className="order-form-production-row">
                <div className="order-form-production-left">
                  <span className="order-form-label" id="create-order-kind-legend">
                    Order type
                  </span>
                  <div className="order-form-radio-row" role="group" aria-labelledby="create-order-kind-legend">
                    <label className="order-form-radio-label">
                      <input
                        type="radio"
                        name="order_kind"
                        checked={(orderForm.order_kind ?? "printing") === "printing"}
                        onChange={() => setOrderForm((prev) => ({ ...prev, order_kind: "printing" }))}
                      />
                      Printing order
                    </label>
                    <label className="order-form-radio-label">
                      <input
                        type="radio"
                        name="order_kind"
                        checked={(orderForm.order_kind ?? "printing") === "regular_stock"}
                        onChange={() => setOrderForm((prev) => ({ ...prev, order_kind: "regular_stock" }))}
                      />
                      Regular stock
                    </label>
                  </div>
                  <span className="order-form-label" id="create-production-legend">
                    Production order
                  </span>
                  <div className="order-form-radio-row" role="group" aria-labelledby="create-production-legend">
                    <label className="order-form-radio-label">
                      <input
                        type="radio"
                        name="is_production_order"
                        checked={!orderForm.is_production_order}
                        onChange={() =>
                          setOrderForm((prev) => ({
                            ...prev,
                            is_production_order: false,
                            expected_handover_to_printing: ""
                          }))
                        }
                      />
                      No
                    </label>
                    <label className="order-form-radio-label">
                      <input
                        type="radio"
                        name="is_production_order"
                        checked={orderForm.is_production_order}
                        onChange={() => setOrderForm((prev) => ({ ...prev, is_production_order: true }))}
                      />
                      Yes
                    </label>
                  </div>
                </div>
                {orderForm.is_production_order ? (
                  <div className="order-form-handover-field">
                    <label htmlFor="create-order-handover">Expected product handover to printing</label>
                    <input
                      id="create-order-handover"
                      type="date"
                      value={orderForm.expected_handover_to_printing}
                      onChange={(e) =>
                        setOrderForm((prev) => ({
                          ...prev,
                          expected_handover_to_printing: e.target.value
                        }))
                      }
                      required
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="order-form-cell order-form-cell--full">
              <label htmlFor="create-payment-method">Payment method</label>
              <select
                id="create-payment-method"
                name="payment_method"
                value={orderForm.payment_method}
                onChange={onOrderFormChange}
                required
              >
                <option value="">Select payment method</option>
                {PAYMENT_METHODS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {paymentMethodRequiresProof(orderForm.payment_method) ? (
                <div className="order-form-payment-screenshot">
                  <label htmlFor="create-payment-screenshot">
                    Payment proof <span className="order-form-required">(required)</span>
                  </label>
                  <input
                    id="create-payment-screenshot"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => setPaymentScreenshotFiles(Array.from(e.target.files ?? []))}
                    required
                  />
                  {paymentScreenshotFiles.length > 0 ? (
                    <p className="order-form-file-name">
                      Selected: {paymentScreenshotFiles.map((f) => f.name).join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="order-form-cell">
              <label htmlFor="create-delivery-method">Delivery</label>
              <select
                id="create-delivery-method"
                name="delivery_method"
                value={orderForm.delivery_method}
                onChange={onOrderFormChange}
                required
              >
                <option value="">Select delivery</option>
                {DELIVERY_METHODS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <select name="owner_name" value={orderForm.owner_name} onChange={onOrderFormChange} required>
              <option value="">Select Owner</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.name}>
                  {owner.name}
                </option>
              ))}
            </select>
            <input
              name="customer_name"
              placeholder="Customer Name"
              value={orderForm.customer_name}
              onChange={onOrderFormChange}
              required
            />
            <select name="coordinator_name" value={orderForm.coordinator_name} onChange={onOrderFormChange} required>
              <option value="">Select Coordinator</option>
              {createFormCoordinatorOptions.map((opt) => (
                <option key={opt.id} value={opt.name}>
                  {opt.name}
                </option>
              ))}
            </select>
            <div className="order-form-cell order-form-span-3 order-form-product-colors">
              <div className="order-form-product-block">
                <input
                  id="create-product-name"
                  name="product_name"
                  placeholder="Product name"
                  aria-label="Product name"
                  value={orderForm.product_name}
                  onChange={onOrderFormChange}
                  required
                  className="order-form-control-tall"
                />
              </div>
              <div className="order-form-colors-block colors-field" ref={colorPickerRef}>
                <button
                  type="button"
                  id="color-picker-trigger"
                  className={`color-field-trigger ${colorPickerOpen ? "is-open" : ""}`}
                  aria-label="Colors"
                  aria-expanded={colorPickerOpen}
                  aria-haspopup="dialog"
                  aria-controls="color-picker-popover"
                  onClick={() => setColorPickerOpen((o) => !o)}
                >
                  <span className="color-field-trigger__value">
                    {orderForm.colors.length === 0 ? (
                      <span className="color-field-placeholder">Click to choose colors…</span>
                    ) : (
                      orderForm.colors.map((c, i) => (
                        <span
                          key={`${c}-${i}`}
                          className="color-field-trigger__dot"
                          style={
                            isCssColorString(c)
                              ? { backgroundColor: c, backgroundImage: "none" }
                              : undefined
                          }
                          title={c}
                          aria-hidden
                        />
                      ))
                    )}
                  </span>
                  <span className="color-field-trigger__chevron" aria-hidden>
                    {colorPickerOpen ? "▲" : "▼"}
                  </span>
                </button>
                {colorPickerOpen ? (
                  <div id="color-picker-popover" className="color-picker-popover" role="dialog" aria-label="Choose colors">
                    <div className="color-palette" role="group" aria-label="Color swatches">
                      {ORDER_COLOR_PALETTE.map((hex, swatchIdx) => {
                        const selected = orderForm.colors.some((c) => normalizeColorKey(c) === hex);
                        return (
                          <button
                            key={`swatch-${swatchIdx}`}
                            type="button"
                            className={`color-palette-swatch ${selected ? "is-selected" : ""}`}
                            style={{ backgroundColor: hex, backgroundImage: "none" }}
                            aria-label={selected ? `${hex}, selected` : hex}
                            aria-pressed={selected}
                            onClick={() => togglePaletteColor(hex)}
                          >
                            {selected ? (
                              <span className="color-palette-check" aria-hidden>
                                ✓
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    {orderForm.colors.length > 0 ? (
                      <div className="color-chips color-chips--in-panel" aria-label="Selected colors">
                        {orderForm.colors.map((color, i) => (
                          <span key={`${color}-${i}`} className="color-chip color-chip--picked">
                            {isCssColorString(color) ? (
                              <span
                                className="color-chip-swatch"
                                style={{ backgroundColor: color, backgroundImage: "none" }}
                                aria-hidden
                              />
                            ) : null}
                            <span className="color-chip-code">{color}</span>
                            <button
                              type="button"
                              className="color-chip-remove"
                              onClick={() => handleRemoveColor(color)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="color-picker-popover__footer">
                      <button type="button" className="color-picker-done-btn" onClick={() => setColorPickerOpen(false)}>
                        Done
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <input
              name="printing_mtrs"
              type="number"
              min="0"
              step="0.01"
              placeholder="Printing Mtrs"
              value={orderForm.printing_mtrs}
              onChange={onOrderFormChange}
            />
            <div className="order-form-cell">
              <label htmlFor="create-order-order-cost">Order cost</label>
              <input
                id="create-order-order-cost"
                name="order_cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={orderForm.order_cost}
                onChange={onOrderFormChange}
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="create-order-printing-cost">Printing cost</label>
              <input
                id="create-order-printing-cost"
                name="printing_cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={orderForm.printing_cost}
                onChange={onOrderFormChange}
              />
            </div>
            <div className="order-form-cell order-form-span-2 order-sizes-remarks-pair">
              <div className="order-size-compact" aria-labelledby="order-size-heading">
                <span id="order-size-heading" className="order-size-compact-heading">
                  Quantities by size
                </span>
                <div className="order-size-grid" role="group" aria-label="Pieces per size">
                  {ORDER_SIZE_COLUMNS.map(({ key, label }) => (
                    <div key={key} className="order-size-grid-cell">
                      <span className="order-size-grid-label">{label}</span>
                      <input
                        className="order-size-grid-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={5}
                        placeholder="0"
                        aria-label={`Quantity ${label}`}
                        value={orderForm.sizes[key] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "");
                          setOrderForm((prev) => ({
                            ...prev,
                            sizes: { ...prev.sizes, [key]: v }
                          }));
                        }}
                      />
                    </div>
                  ))}
                </div>
                {orderForm.extraSizes.length > 0 ? (
                  <div className="order-size-extra-list" role="group" aria-label="Extra sizes">
                    {orderForm.extraSizes.map((row) => (
                      <div key={row.id} className="order-size-extra-row">
                        <input
                          className="order-size-extra-label"
                          type="text"
                          placeholder="Size name (e.g. 4XL, 28)"
                          aria-label="Extra size name"
                          autoCapitalize="characters"
                          spellCheck={false}
                          value={row.label}
                          onChange={(e) => {
                            const label = e.target.value.toUpperCase();
                            setOrderForm((prev) => ({
                              ...prev,
                              extraSizes: prev.extraSizes.map((r) =>
                                r.id === row.id ? { ...r, label } : r
                              )
                            }));
                          }}
                        />
                        <input
                          className="order-size-grid-input order-size-extra-qty"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={5}
                          placeholder="0"
                          aria-label={`Quantity ${row.label || "extra size"}`}
                          value={row.qty}
                          onChange={(e) => {
                            const qty = e.target.value.replace(/\D/g, "");
                            setOrderForm((prev) => ({
                              ...prev,
                              extraSizes: prev.extraSizes.map((r) =>
                                r.id === row.id ? { ...r, qty } : r
                              )
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="order-size-extra-remove"
                          aria-label="Remove extra size"
                          onClick={() =>
                            setOrderForm((prev) => ({
                              ...prev,
                              extraSizes: prev.extraSizes.filter((r) => r.id !== row.id)
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="btn-add-extra-sizes"
                  onClick={() =>
                    setOrderForm((prev) => ({
                      ...prev,
                      extraSizes: [...prev.extraSizes, newExtraSizeRow()]
                    }))
                  }
                >
                  Add extra sizes
                </button>
                <p className="order-size-total">
                  Total: <strong>{sumSizeForm(orderForm.sizes, orderForm.extraSizes)}</strong>
                </p>
              </div>
              <div className="order-remarks-in-pair">
                <label htmlFor="create-order-remarks">Remarks (optional)</label>
                <textarea
                  id="create-order-remarks"
                  name="remarks"
                  placeholder="Notes for production, shipping, etc."
                  value={orderForm.remarks}
                  onChange={onOrderFormChange}
                />
              </div>
            </div>
            <div className="order-form-cell order-form-cell--full order-form-customer-assets">
              <label htmlFor="create-customer-assets">Asset</label>
              <input
                id="create-customer-assets"
                type="file"
                multiple
                className="order-form-asset-input"
                onChange={onCustomerAssetsSelected}
              />
              {customerAssetFiles.length > 0 ? (
                <ul className="order-form-asset-list">
                  {customerAssetFiles.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`} className="order-form-asset-item">
                      <span className="order-form-asset-name" title={file.name}>
                        {file.name}
                      </span>
                      <span className="order-form-asset-meta">
                        {file.type || "file"}
                        {file.size ? ` · ${Math.round(file.size / 1024)} KB` : ""}
                      </span>
                      <div className="order-form-asset-actions">
                        <button type="button" onClick={() => downloadLocalFile(file)}>
                          Download
                        </button>
                        <button
                          type="button"
                          className="order-form-asset-remove"
                          onClick={() => removeCustomerAssetFile(index)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="order-form-cell order-form-cell--full">
              <label htmlFor="create-order-mockups">Mockups</label>
              <input
                id="create-order-mockups"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setDesignFiles(Array.from(e.target.files ?? []))}
                required
              />
            </div>
            <div className="order-form-actions order-form-span-3">
              <button type="submit">Save Job</button>
              <button
                type="button"
                className="danger-btn order-form-cancel-btn"
                onClick={closeCreateOrderForm}
              >
                Cancel
              </button>
            </div>
          </form>
              )}
            </div>
          </div>
        </div>
      )}

      <MockupStudio open={showMockupStudio} onClose={() => setShowMockupStudio(false)} />
      {activeViewOrder && (
        <div className="image-modal-backdrop" onClick={closeViewOrder}>
          <div className="order-detail-modal" onClick={(e) => e.stopPropagation()}>
            <OrderDetailPanel
              order={activeViewOrder}
              onClose={closeViewOrder}
              profileLoading={profileLoading}
              profileError={profileError}
              isAdmin={isAdmin}
              isSalesReviewer={isSalesReviewer}
              canUseOrderControls={canUseOrderControls}
              viewerMayUpdateOrders={viewerMayUpdateOrders}
              canCurrentUserEdit={canCurrentUserEdit}
              coordinators={coordinators}
              viewerProfiles={viewerProfiles}
              owners={owners}
              adminOrderDrafts={adminOrderDrafts}
              patchAdminOrderDraft={patchAdminOrderDraft}
              statusUpdates={statusUpdates}
              remarksUpdates={remarksUpdates}
              qtyUpdates={qtyUpdates}
              dueDateUpdates={dueDateUpdates}
              printingMtrsUpdates={printingMtrsUpdates}
              coordinatorUpdates={coordinatorUpdates}
              receivedAtPrintingUpdates={receivedAtPrintingUpdates}
              setCoordinatorUpdates={setCoordinatorUpdates}
              setQtyUpdates={setQtyUpdates}
              setDueDateUpdates={setDueDateUpdates}
              setRemarksUpdates={setRemarksUpdates}
              setPrintingMtrsUpdates={setPrintingMtrsUpdates}
              setReceivedAtPrintingUpdates={setReceivedAtPrintingUpdates}
              designReviewNoteOpen={designReviewNoteOpen}
              designReviewNoteDrafts={designReviewNoteDrafts}
              setDesignReviewNoteDrafts={setDesignReviewNoteDrafts}
              setDesignReviewNoteOpen={setDesignReviewNoteOpen}
              savingDesignReviewOrderId={savingDesignReviewOrderId}
              uploadingPostDesignOrderId={uploadingPostDesignOrderId}
              archivingPostDesignOrderId={archivingPostDesignOrderId}
              persistOrderStatus={persistOrderStatus}
              handleViewerUpdate={handleViewerUpdate}
              handleAppendPostApprovedDesignImages={handleAppendPostApprovedDesignImages}
              handleAppendPaymentProof={handleAppendPaymentProof}
              handleUpdatePaymentMethod={handleUpdatePaymentMethod}
              uploadingPaymentProofOrderId={uploadingPaymentProofOrderId}
              handleArchiveApprovedDesignImages={handleArchiveApprovedDesignImages}
              handleApprovePostDesign={handleApprovePostDesign}
              openPostDesignChangesInput={openPostDesignChangesInput}
              handleSubmitPostDesignChanges={handleSubmitPostDesignChanges}
              openOrderHistory={openOrderHistory}
              handleMarkComplete={handleMarkComplete}
              handleDeleteOrder={handleDeleteOrder}
              openPreview={openPreview}
              renderStageIcon={renderStageIcon}
              OrderColorsCell={OrderColorsCell}
            />
          </div>
        </div>
      )}
      {orderHistoryTarget && (
        <div className="image-modal-backdrop" onClick={closeOrderHistory}>
          <div className="order-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="order-history-head">
              <div>
                <h3>Order history</h3>
                <p className="order-history-sub">
                  {orderHistoryTarget.customer_name}
                  {orderHistoryTarget.order_id?.trim()
                    ? ` · ${orderHistoryTarget.order_id}`
                    : ""}{" "}
                  · Job #{orderHistoryTarget.id}
                </p>
              </div>
              <div className="order-history-head-actions">
                <button type="button" onClick={refreshOrderHistory} disabled={orderHistoryLoading}>
                  Refresh
                </button>
                <button type="button" onClick={closeOrderHistory}>
                  x
                </button>
              </div>
            </div>
            {orderHistoryError ? (
              <p className="order-history-error">{orderHistoryError}</p>
            ) : orderHistoryLoading ? (
              <p className="order-history-loading">Loading activity…</p>
            ) : orderHistoryEntries.length === 0 ? (
              <p className="order-history-empty">No activity yet.</p>
            ) : (
              <ul className="order-history-timeline">
                {orderHistoryEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`order-history-item order-history-item--${entry.event_type}`}
                  >
                    <div className="order-history-item-head">
                      <span className="order-history-event">
                        {ORDER_HISTORY_EVENT_LABELS[entry.event_type] ?? entry.event_type}
                      </span>
                      <time className="order-history-time" dateTime={entry.created_at}>
                        {formatReceivedAtDisplay(entry.created_at)}
                      </time>
                    </div>
                    <p className="order-history-message">{entry.message}</p>
                    <p className="order-history-actor">By {entry.actor_label || "System"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {showArchiveModal && (
        <div className="image-modal-backdrop" onClick={() => setShowArchiveModal(false)}>
          <div className="archive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="archive-modal-head">
              <h3>Monthly cloud archive</h3>
              <button type="button" onClick={() => setShowArchiveModal(false)}>
                x
              </button>
            </div>
            <MonthlyArchivePanel
              inModal
              orders={orders}
              onPurged={() => {
                fetchOrders();
                setShowArchiveModal(false);
              }}
            />
          </div>
        </div>
      )}
      {previewImages.length > 0 && (
        <div
          className="image-modal-backdrop image-modal-backdrop--preview"
          onClick={closePreview}
        >
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={closePreview}>
              x
            </button>
            {previewImages.length > 1 && (
              <button className="image-modal-nav prev" onClick={prevPreview}>
                {"<"}
              </button>
            )}
            <img src={previewImages[previewIndex]} alt="Mockup preview" />
            {previewImages.length > 1 && (
              <button className="image-modal-nav next" onClick={nextPreview}>
                {">"}
              </button>
            )}
          </div>
        </div>
      )}
      <AssignmentToastStack
        toasts={assignmentToasts}
        onDismiss={dismissAssignmentToast}
        onActivate={handleAssignmentToastActivate}
      />
    </div>
  );
}

export default App;
