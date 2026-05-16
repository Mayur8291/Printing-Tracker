import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MockupStudio from "./MockupStudio";
import CoordinatorReportPanel from "./CoordinatorReportPanel";
import { supabase } from "./supabaseClient";

const STAGES = [
  "new",
  "approval_pending",
  "printing",
  "fusing",
  "ironing",
  "packing",
  "pending",
  "on_hold",
  "ready"
];
const STAGE_LABEL = {
  new: "New Orders",
  approval_pending: "Approval Pending",
  printing: "Printing",
  fusing: "Fusing",
  ironing: "Ironing",
  packing: "Packing",
  pending: "Pending",
  on_hold: "On hold",
  ready: "Ready to Dispatch"
};
const STAGE_ICON = {
  new: "🆕",
  approval_pending: "📋",
  printing: "🖨️",
  fusing: "🟧",
  ironing: "/icons/ironing.png",
  packing: "📦",
  pending: "/icons/pending.png",
  on_hold: null,
  ready: "✅"
};
const STAGE_OPTION_ICON = {
  new: "🆕",
  approval_pending: "📋",
  printing: "🖨️",
  fusing: "🟧",
  ironing: "♨️",
  packing: "📦",
  pending: "⏳",
  on_hold: "⚠",
  ready: "✅"
};

/** New jobs stay “new” until 12h after `created_at`, then move to “pending” (see DB trigger + client promotion). */
const SLA_NEW_TO_PENDING_MS = 12 * 60 * 60 * 1000;

function parseDesignUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    if (typeof parsed === "string" && parsed) return [parsed];
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

function isImageUploadFile(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (!type || type === "application/octet-stream") {
    return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|tiff?)$/i.test(file.name || "");
  }
  return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|tiff?)$/i.test(file.name || "");
}

function staticAssetUrl(relPath) {
  const base = import.meta.env.BASE ?? "/";
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${relPath.replace(/^\//, "")}`;
}

function resolveStatusToneUrl() {
  try {
    return new URL(staticAssetUrl("sounds/tone-01.mp3"), window.location.href).href;
  } catch {
    return staticAssetUrl("sounds/tone-01.mp3");
  }
}

let cachedStatusToneAudio;
let statusTonePrimed = false;
/** Status changed while tab hidden — play once when user returns. */
let pendingStatusTone = false;

/** Call once after a user gesture so autoplay policy allows status tones later. */
function primeStatusToneFromUserGesture() {
  if (statusTonePrimed) return;
  try {
    if (!cachedStatusToneAudio) {
      cachedStatusToneAudio = new Audio(resolveStatusToneUrl());
      cachedStatusToneAudio.preload = "auto";
    }
    cachedStatusToneAudio.volume = 0.001;
    void cachedStatusToneAudio
      .play()
      .then(() => {
        cachedStatusToneAudio.pause();
        cachedStatusToneAudio.currentTime = 0;
        cachedStatusToneAudio.volume = 1;
        statusTonePrimed = true;
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

function playOrderStatusChangeTone() {
  try {
    const url = resolveStatusToneUrl();
    const tryPlay = (el) => {
      if (!el) return Promise.reject(new Error("no audio"));
      el.volume = 1;
      el.pause();
      el.currentTime = 0;
      return el.play();
    };

    if (!cachedStatusToneAudio) {
      cachedStatusToneAudio = new Audio(url);
      cachedStatusToneAudio.preload = "auto";
    }

    const p = tryPlay(cachedStatusToneAudio);
    if (p) {
      void p.catch(() => {
        try {
          const fresh = new Audio(url);
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
      const fresh = new Audio(resolveStatusToneUrl());
      fresh.volume = 1;
      void fresh.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }
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

/** iOS-style blue location dot with optional expanding pulse ring (idle / no live jobs). */
function LiveMapMarker({ pulse = false, size = "md" }) {
  return (
    <span
      className={`live-map-marker live-map-marker--${size} ${pulse ? "live-map-marker--pulse" : ""}`}
      aria-hidden
    >
      <span className="live-map-marker__halo" />
      <span className="live-map-marker__dot" />
    </span>
  );
}

/** Live indicator asset — replace with your animated GIF at this path when ready. */
const LIVE_ACTIVE_ICON_SRC = "/icons/live-active.png";

function LiveActiveIcon({ size = "md", className = "" }) {
  return (
    <img
      src={LIVE_ACTIVE_ICON_SRC}
      alt=""
      draggable={false}
      className={`live-active-icon live-active-icon--${size} ${className}`.trim()}
    />
  );
}

function LiveStatusIcon({ active, size = "md" }) {
  if (active) {
    return <LiveActiveIcon size={size} />;
  }
  return <LiveMapMarker pulse={false} size={size} />;
}

/** Keys stored in orders.size_breakdown (jsonb). */
const ORDER_SIZE_COLUMNS = [
  { key: "XS", label: "XS" },
  { key: "S", label: "S" },
  { key: "M", label: "M" },
  { key: "L", label: "L" },
  { key: "XL", label: "XL" },
  { key: "2XL", label: "2XL" },
  { key: "3XL", label: "3XL" }
];

function emptySizesForm() {
  return Object.fromEntries(ORDER_SIZE_COLUMNS.map(({ key }) => [key, ""]));
}

function parseSizeQtyInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function sumSizeForm(sizes) {
  return ORDER_SIZE_COLUMNS.reduce((acc, { key }) => acc + parseSizeQtyInput(sizes?.[key]), 0);
}

/** Build DB object: only positive integer counts. */
function sizesFormToBreakdown(sizes) {
  const out = {};
  for (const { key } of ORDER_SIZE_COLUMNS) {
    const n = parseSizeQtyInput(sizes?.[key]);
    if (n > 0) out[key] = n;
  }
  return out;
}

/** Human-readable for table / CSV / live card. */
function formatSizeBreakdownSummary(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return "—";
  const parts = [];
  for (const { key, label } of ORDER_SIZE_COLUMNS) {
    const n = Number(breakdown[key]);
    if (Number.isFinite(n) && n > 0) parts.push(`${label}×${n}`);
  }
  return parts.length ? parts.join(", ") : "—";
}

/** DB timestamptz → value for `<input type="datetime-local" />` (local). */
function receivedAtToDatetimeLocalValue(iso) {
  if (iso == null || String(iso).trim() === "") return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIsoOrNull(localStr) {
  const t = String(localStr ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatReceivedAtDisplay(iso) {
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

const emptyOrder = {
  order_id: "",
  due_date: "",
  owner_name: "",
  customer_name: "",
  coordinator_name: "",
  sizes: emptySizesForm(),
  product_name: "",
  colors: [],
  printing_mtrs: "0.00",
  remarks: "",
  is_production_order: false,
  expected_handover_to_printing: ""
};

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

const EDITABLE_FIELD_OPTIONS = [
  { key: "status", label: "Status" },
  { key: "remarks", label: "Remarks" },
  { key: "due_date", label: "Due Date" },
  { key: "qty", label: "Qty" },
  { key: "coordinator_name", label: "Coordinator" },
  { key: "printing_mtrs", label: "Printing Mtrs" },
  { key: "approved_design_images", label: "Approved design images" },
  { key: "received_at_printing", label: "Received date/time to printing" }
];

const DEFAULT_NEW_USER_PERMISSIONS = {
  can_edit_status: true,
  can_edit_remarks: false,
  can_edit_due_date: false,
  can_edit_qty: false,
  can_edit_coordinator_name: false,
  can_edit_printing_mtrs: false,
  can_edit_approved_design_images: true,
  can_edit_received_at_printing: false,
  can_create_orders: false
};

function hydrateDraftFromPermission(p) {
  const hasStored =
    p &&
    typeof p === "object" &&
    (Object.keys(p).some((k) => k.startsWith("can_edit_")) ||
      Object.prototype.hasOwnProperty.call(p, "can_create_orders"));
  if (!hasStored) {
    return { ...DEFAULT_NEW_USER_PERMISSIONS };
  }
  return {
    can_edit_status: p.can_edit_status !== false,
    can_edit_remarks: Boolean(p.can_edit_remarks),
    can_edit_due_date: Boolean(p.can_edit_due_date),
    can_edit_qty: Boolean(p.can_edit_qty),
    can_edit_coordinator_name: Boolean(p.can_edit_coordinator_name),
    can_edit_printing_mtrs: Boolean(p.can_edit_printing_mtrs),
    can_edit_approved_design_images: p.can_edit_approved_design_images !== false,
    can_edit_received_at_printing: Boolean(p.can_edit_received_at_printing),
    can_create_orders: Boolean(p.can_create_orders)
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
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [designFiles, setDesignFiles] = useState([]);
  const [owners, setOwners] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newCoordinatorName, setNewCoordinatorName] = useState("");
  const [showMasterList, setShowMasterList] = useState(false);
  const [showMockupStudio, setShowMockupStudio] = useState(false);
  const [masterTableMissing, setMasterTableMissing] = useState(false);
  const [viewerProfiles, setViewerProfiles] = useState([]);
  const [viewerPermissions, setViewerPermissions] = useState({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /** none = newest first; group = by coordinators catalog; name:… = one coordinator */
  const [coordinatorSort, setCoordinatorSort] = useState("none");
  const [ordersTab, setOrdersTab] = useState("active");
  const [statusUpdates, setStatusUpdates] = useState({});
  const [remarksUpdates, setRemarksUpdates] = useState({});
  const [qtyUpdates, setQtyUpdates] = useState({});
  const [dueDateUpdates, setDueDateUpdates] = useState({});
  const [printingMtrsUpdates, setPrintingMtrsUpdates] = useState({});
  const [coordinatorUpdates, setCoordinatorUpdates] = useState({});
  const [receivedAtPrintingUpdates, setReceivedAtPrintingUpdates] = useState({});
  const [previewImages, setPreviewImages] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [viewerNameDrafts, setViewerNameDrafts] = useState({});
  const [viewerDepartmentDrafts, setViewerDepartmentDrafts] = useState({});
  const [permissionDrafts, setPermissionDrafts] = useState({});
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef(null);
  const postDesignFileInputRef = useRef(null);
  const postDesignUploadTargetRef = useRef(null);
  const recentApprovedDesignSavesRef = useRef(new Map());
  const suppressOrdersFetchUntilRef = useRef(0);
  const [uploadingPostDesignOrderId, setUploadingPostDesignOrderId] = useState(null);
  const [postDesignUploadFeedback, setPostDesignUploadFeedback] = useState({});
  /** Map order id -> last known status (for new→pending tone). */
  const prevOrderStatusesRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    try {
      window.localStorage.setItem("printing-tracker-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const fetchOrders = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (silent && Date.now() < suppressOrdersFetchUntilRef.current) {
      return;
    }
    if (!silent) setLoadingOrders(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_id, order_date, due_date, owner_name, customer_name, coordinator_name, qty, size_breakdown, product_name, colors, approved_design_url, approved_design_images, printing_mtrs, status, remarks, created_at, is_live, is_complete, is_production_order, expected_handover_to_printing, received_at_printing"
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error.message);
        if (error.message?.includes("approved_design_images")) {
          alert(
            "Database is missing approved_design_images. Run supabase/schema.sql (or migrations/20260516120000_add_approved_design_images.sql) in Supabase SQL Editor."
          );
        }
        return;
      }
      const rows = data ?? [];
      const merged = rows.map((row) => {
        const pending = recentApprovedDesignSavesRef.current.get(row.id);
        if (!pending) return row;
        const serverUrls = parseDesignUrls(row.approved_design_images);
        const pendingUrls = parseDesignUrls(pending.serialized);
        if (serverUrls.length >= pendingUrls.length) {
          recentApprovedDesignSavesRef.current.delete(row.id);
          return row;
        }
        if (Date.now() - pending.at > 120_000) {
          recentApprovedDesignSavesRef.current.delete(row.id);
          return row;
        }
        return { ...row, approved_design_images: pending.serialized };
      });
      setOrders(merged);
      // Select uses statusUpdates[id] ?? order.status — stale keys hide remote changes until full reload.
      setStatusUpdates(Object.fromEntries(rows.map((o) => [o.id, o.status])));
      setReceivedAtPrintingUpdates(
        Object.fromEntries(rows.map((o) => [o.id, receivedAtToDatetimeLocalValue(o.received_at_printing)]))
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  }, []);

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
    if (!session?.user) {
      setOrders([]);
      setOwners([]);
      setCoordinators([]);
      return;
    }
    fetchOrders();
    fetchMasters();

    const ordersChannel = supabase
      .channel("orders-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => fetchOrders({ silent: true })
      )
      .subscribe();

    const coordinatorsChannel = supabase
      .channel("coordinators-master")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coordinators" },
        () => fetchMasters()
      )
      .subscribe();

    const pollMs = 25000;
    const pollId = setInterval(() => {
      fetchOrders({ silent: true });
    }, pollMs);

    return () => {
      clearInterval(pollId);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(coordinatorsChannel);
    };
  }, [session?.user?.id, fetchOrders]);

  /** Prime Web Audio after login so status-change tones can play (browser autoplay rules). */
  useEffect(() => {
    if (!session?.user) return undefined;
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
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) {
      prevOrderStatusesRef.current = null;
      return;
    }
    if (!orders.length) {
      prevOrderStatusesRef.current = null;
      return;
    }
    const prev = prevOrderStatusesRef.current;
    const nextMap = Object.fromEntries(orders.map((o) => [o.id, o.status]));
    if (prev && typeof prev === "object" && Object.keys(prev).length) {
      let anyStatusChanged = false;
      for (const o of orders) {
        const was = prev[o.id];
        if (was !== undefined && was !== o.status) {
          anyStatusChanged = true;
          break;
        }
      }
      if (anyStatusChanged) {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          playOrderStatusChangeTone();
        } else {
          pendingStatusTone = true;
        }
      }
    }
    prevOrderStatusesRef.current = nextMap;
  }, [session?.user?.id, orders]);

  /** Play deferred status tone when tab becomes visible (hidden-tab throttling). */
  useEffect(() => {
    if (!session?.user) return undefined;
    const flush = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      if (!pendingStatusTone) return;
      pendingStatusTone = false;
      playOrderStatusChangeTone();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("focus", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("focus", flush);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return undefined;

    async function promoteStaleNewOrdersToPending() {
      const { data, error } = await supabase
        .from("orders")
        .select("id, created_at")
        .eq("status", "new")
        .eq("is_complete", false);
      if (error || !data?.length) return;
      const now = Date.now();
      for (const row of data) {
        const createdMs = new Date(row.created_at).getTime();
        if (Number.isNaN(createdMs) || now - createdMs < SLA_NEW_TO_PENDING_MS) continue;
        await supabase.from("orders").update({ status: "pending" }).eq("id", row.id).eq("status", "new");
      }
      await fetchOrders({ silent: true });
    }

    const run = () => {
      promoteStaleNewOrdersToPending().catch((e) => console.error(e));
    };
    const t0 = setTimeout(run, 4000);
    const intervalId = setInterval(run, 120000);
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
    if (!session?.user || !profile?.role) return;
    fetchViewersAndPermissions();
  }, [session?.user?.id, profile?.role]);

  useEffect(() => {
    if (!showMasterList) return;
    const next = {};
    viewerProfiles.forEach((v) => {
      next[v.id] = hydrateDraftFromPermission(viewerPermissions[v.id] ?? {});
    });
    setPermissionDrafts(next);
    // Intentionally omit viewerPermissions: refetches after partial saves must not wipe other rows' drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMasterList, viewerProfiles]);

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
        .select("id, full_name, email, role, department")
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
          .select("id, full_name, email, role, department")
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
            .select("id, full_name, email, role, department")
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
    const [{ data: ownersData, error: ownersError }, { data: coordinatorsData, error: coordinatorsError }] =
      await Promise.all([
        supabase.from("owners").select("id, name").order("name", { ascending: true }),
        supabase.from("coordinators").select("id, name").order("name", { ascending: true })
      ]);

    if (ownersError) {
      console.error(ownersError.message);
      if (ownersError.message?.includes("Could not find the table")) {
        setMasterTableMissing(true);
      }
    } else {
      setOwners(ownersData ?? []);
    }

    if (coordinatorsError) {
      console.error(coordinatorsError.message);
      if (coordinatorsError.message?.includes("Could not find the table")) {
        setMasterTableMissing(true);
      }
    } else {
      setCoordinators(coordinatorsData ?? []);
    }
  }

  async function fetchViewersAndPermissions() {
    const role = (profile?.role ?? "").trim().toLowerCase();
    if (role === "admin") {
      const [{ data: viewersData, error: viewersError }, { data: permissionsData, error: permissionsError }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, department")
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

  async function handleSignIn(e) {
    e.preventDefault();
    // Still inside the sign-in click gesture — primes Web Audio before any await (autoplay policy).
    primeStatusToneFromUserGesture();
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
      alert("Please set the due date.");
      return;
    }
    if (orderForm.is_production_order) {
      const h = String(orderForm.expected_handover_to_printing ?? "").trim();
      if (!h) {
        alert("Please set expected product handover to printing (date) for production orders.");
        return;
      }
    }
    const sizeBreakdown = sizesFormToBreakdown(orderForm.sizes);
    const qtyTotal = sumSizeForm(orderForm.sizes);
    if (qtyTotal < 1) {
      alert("Enter at least one piece in the size quantities (total must be 1 or more).");
      return;
    }
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

    const rawMtrs = String(orderForm.printing_mtrs ?? "").trim().replace(",", ".");
    const parsedMtrs = Number.parseFloat(rawMtrs);
    const printingMtrs = Number.isFinite(parsedMtrs) && parsedMtrs >= 0 ? parsedMtrs : 0;

    const payload = {
      order_date: todayLocalISODate(),
      order_id: String(orderForm.order_id ?? "").trim() || null,
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
      status: "new",
      remarks: orderForm.remarks || null,
      created_by: session.user.id,
      is_production_order: Boolean(orderForm.is_production_order),
      expected_handover_to_printing: orderForm.is_production_order
        ? String(orderForm.expected_handover_to_printing).trim() || null
        : null
    };

    const { error } = await supabase.from("orders").insert(payload);
    if (error) {
      alert(error.message);
      return;
    }
    setOrderForm(emptyOrder);
    setDesignFiles([]);
    setShowCreateForm(false);
    alert("Job card has been saved successfully.");
    window.location.reload();
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

  function renderLiveOrderDesignSection(orderId, urls, sectionKey, label, altPrefix) {
    if (!urls.length) return null;
    return (
      <div className="live-order-detail-card__designs" key={`${orderId}-${sectionKey}`}>
        <span className="live-order-detail-card__designs-label">{label}</span>
        <div className={`approved-grid ${urls.length > 1 ? "multi" : "single"} live-order-thumb-grid`}>
          {urls.map((url, index) => (
            <button
              type="button"
              className="approved-thumb-btn"
              key={`${orderId}-live-${sectionKey}-${index}`}
              onClick={() => openPreview(urls, index)}
            >
              <img src={url} alt={`${altPrefix} ${index + 1}`} />
            </button>
          ))}
        </div>
      </div>
    );
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
    const draft = permissionDrafts[viewerId] ?? hydrateDraftFromPermission(viewerPermissions[viewerId] ?? {});

    const { error: nameErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName || null, department: department || null })
      .eq("id", viewerId);
    if (nameErr) {
      alert(nameErr.message);
      return;
    }

    const { error: permErr } = await supabase.from("profile_order_permissions").upsert(
      {
        user_id: viewerId,
        can_edit_status: draft.can_edit_status !== false,
        can_edit_remarks: Boolean(draft.can_edit_remarks),
        can_edit_due_date: Boolean(draft.can_edit_due_date),
        can_edit_qty: Boolean(draft.can_edit_qty),
        can_edit_coordinator_name: Boolean(draft.can_edit_coordinator_name),
        can_edit_printing_mtrs: Boolean(draft.can_edit_printing_mtrs),
        can_edit_approved_design_images: draft.can_edit_approved_design_images !== false,
        can_edit_received_at_printing: Boolean(draft.can_edit_received_at_printing),
        can_create_orders: Boolean(draft.can_create_orders),
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
    const refreshed = await fetchViewersAndPermissions();
    if (showMasterList && refreshed?.viewerPermissions) {
      setPermissionDrafts((prev) => ({
        ...prev,
        [viewerId]: hydrateDraftFromPermission(refreshed.viewerPermissions[viewerId] ?? {})
      }));
    }
  }

  async function handleResetViewerPermissions(userId) {
    const ok = window.confirm(
      "Reset saved field permissions for this user? They will follow default rules (usually status only) until set again."
    );
    if (!ok) return;
    const { error } = await supabase.from("profile_order_permissions").delete().eq("user_id", userId);
    if (error) {
      alert(error.message);
      return;
    }
    const refreshed = await fetchViewersAndPermissions();
    if (showMasterList && refreshed?.viewerPermissions) {
      setPermissionDrafts((prev) => ({
        ...prev,
        [userId]: hydrateDraftFromPermission(refreshed.viewerPermissions[userId] ?? {})
      }));
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
      "Due Date",
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
    fetchOrders();
  }

  async function handleSetLive(order) {
    if (order.is_live) return;
    const { error } = await supabase.from("orders").update({ is_live: true }).eq("id", order.id);
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, is_live: true } : o))
    );
    fetchOrders();
  }

  async function handleStopLive(order) {
    if (!order.is_live) return;
    const { error } = await supabase.from("orders").update({ is_live: false }).eq("id", order.id);
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, is_live: false } : o))
    );
    fetchOrders();
  }

  async function handleMarkComplete(order) {
    if (order.is_complete) return;
    const ok = window.confirm(
      `Mark this job as complete? It will move to the Complete orders tab.\n${order.customer_name} · ${order.order_date} · Qty ${order.qty}`
    );
    if (!ok) return;
    const { error } = await supabase
      .from("orders")
      .update({ is_complete: true, is_live: false })
      .eq("id", order.id);
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id ? { ...o, is_complete: true, is_live: false } : o
      )
    );
    setOrdersTab("complete");
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

  const ordersInDateRange = useMemo(
    () => orders.filter((order) => isInSelectedDateRange(order.order_date)),
    [orders, dateFrom, dateTo]
  );

  const filteredOrders = useMemo(() => {
    return ordersInDateRange.filter((o) =>
      ordersTab === "complete" ? o.is_complete : !o.is_complete
    );
  }, [ordersInDateRange, ordersTab]);

  const coordinatorCatalogOrder = useMemo(() => {
    const map = new Map();
    coordinators.forEach((c, index) => {
      const name = String(c.name ?? "").trim();
      if (name) map.set(name.toLowerCase(), index);
    });
    return map;
  }, [coordinators]);

  const effectiveCoordinatorName = useCallback(
    (order) => String(coordinatorUpdates[order.id] ?? order.coordinator_name ?? "").trim(),
    [coordinatorUpdates]
  );

  const sortedFilteredOrders = useMemo(() => {
    if (coordinatorSort === "none") return filteredOrders;

    if (coordinatorSort === "group") {
      const list = [...filteredOrders];
      list.sort((a, b) => {
        const ka = effectiveCoordinatorName(a).toLowerCase();
        const kb = effectiveCoordinatorName(b).toLowerCase();
        const ia = ka ? (coordinatorCatalogOrder.get(ka) ?? 9999) : 10000;
        const ib = kb ? (coordinatorCatalogOrder.get(kb) ?? 9999) : 10000;
        if (ia !== ib) return ia - ib;
        if (!ka && kb) return 1;
        if (ka && !kb) return -1;
        if (ka !== kb) return ka.localeCompare(kb, undefined, { sensitivity: "base" });
        return (
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );
      });
      return list;
    }

    if (coordinatorSort.startsWith("name:")) {
      const target = coordinatorSort.slice(5).trim().toLowerCase();
      if (!target) return filteredOrders;
      return filteredOrders.filter(
        (o) => effectiveCoordinatorName(o).toLowerCase() === target
      );
    }

    return filteredOrders;
  }, [filteredOrders, coordinatorSort, coordinatorCatalogOrder, effectiveCoordinatorName]);

  useEffect(() => {
    if (!coordinatorSort.startsWith("name:")) return;
    const target = coordinatorSort.slice(5).trim().toLowerCase();
    if (!target) {
      setCoordinatorSort("none");
      return;
    }
    const inCatalog = coordinators.some((c) => String(c.name ?? "").trim().toLowerCase() === target);
    if (!inCatalog) setCoordinatorSort("none");
  }, [coordinators, coordinatorSort]);

  const liveOrders = useMemo(() => {
    const live = orders.filter((o) => o.is_live && !o.is_complete);
    return [...live].sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
  }, [orders]);

  useEffect(() => {
    if (!session?.user || profileLoading || profileError) return;
    const role = (profile?.role ?? "").trim().toLowerCase();
    if (role !== "admin" && ordersTab === "coordinator_report") {
      setOrdersTab("active");
    }
  }, [session?.user?.id, profile?.role, profileLoading, profileError, ordersTab]);

  if (!session) {
    return (
      <div className="auth-page">
        <ThemeToggle
          theme={theme}
          onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="theme-toggle-btn theme-toggle-btn--floating"
        />
        <div className="panel auth-card">
          <h1>Printing Tracker Login</h1>
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
  const isAdmin = normalizedRole === "admin";
  const isViewer = normalizedRole === "viewer";
  const currentUserPermissions = viewerPermissions[session?.user?.id] ?? {};
  const viewerCanCreateOrders = isViewer && Boolean(currentUserPermissions.can_create_orders);
  const viewerMayUpdateOrders = isAdmin || (isViewer && viewerHasAnyOrderFieldEdit(currentUserPermissions));

  const canCurrentUserEdit = (field) => {
    if (field === "coordinator_name" && isAdmin) return false;
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
    if (canCurrentUserEdit("qty") && nextQty != null && nextQty !== "") payload.qty = Number(nextQty);
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
                : order.received_at_printing
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

    // Fallback sync in case realtime event is delayed/disabled.
    fetchOrders();
  }

  function applyApprovedDesignImagesToOrder(orderId, serialized) {
    suppressOrdersFetchUntilRef.current = Date.now() + 5000;
    recentApprovedDesignSavesRef.current.set(orderId, { serialized, at: Date.now() });
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, approved_design_images: serialized } : o))
    );
  }

  function openPostDesignFilePicker(order) {
    if (!order?.id) return;
    if (uploadingPostDesignOrderId === order.id) return;
    postDesignUploadTargetRef.current = order.id;
    postDesignFileInputRef.current?.click();
  }

  function handlePostDesignFileInputChange(e) {
    const pickedFiles = Array.from(e.target.files ?? []);
    e.target.value = "";
    const orderId = postDesignUploadTargetRef.current;
    postDesignUploadTargetRef.current = null;
    if (!pickedFiles.length) {
      if (orderId) {
        setPostDesignUploadFeedback((prev) => ({
          ...prev,
          [orderId]: { status: "error", message: "No file selected." }
        }));
      }
      return;
    }
    if (!orderId) return;
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      alert("Order not found. Refresh the page and try again.");
      return;
    }
    void handleAppendPostApprovedDesignImages(order, pickedFiles);
  }

  async function handleAppendPostApprovedDesignImages(order, fileList) {
    const picked = Array.isArray(fileList) ? fileList : Array.from(fileList ?? []);
    const files = picked.filter(isImageUploadFile);
    const setFeedback = (status, message) => {
      setPostDesignUploadFeedback((prev) => ({
        ...prev,
        [order.id]: { status, message }
      }));
    };
    if (!picked.length) {
      setFeedback("error", "No file selected.");
      return;
    }
    if (!files.length) {
      const msg = "Please choose an image file (JPEG, PNG, WebP, HEIC, etc.).";
      setFeedback("error", msg);
      alert(msg);
      return;
    }
    if (!session?.user) {
      const msg = "You must be signed in to upload approved design images.";
      setFeedback("error", msg);
      alert(msg);
      return;
    }
    if (!canCurrentUserEdit("approved_design_images")) {
      const msg = "You do not have permission to add approved design images.";
      setFeedback("error", msg);
      alert(msg);
      return;
    }
    setUploadingPostDesignOrderId(order.id);
    setFeedback("uploading", "Uploading…");
    try {
      const existing = parseDesignUrls(order.approved_design_images);
      const nextUrls = [...existing];
      for (const file of files) {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
        const uploadPath = `post-approved/${order.id}/${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("approved-designs")
          .upload(uploadPath, file, { upsert: true, contentType: file.type || undefined });
        if (uploadError) {
          setFeedback("error", uploadError.message);
          alert(uploadError.message);
          return;
        }
        const { data: publicUrlData } = supabase.storage.from("approved-designs").getPublicUrl(uploadPath);
        nextUrls.push(publicUrlData.publicUrl);
      }
      const serialized = JSON.stringify(nextUrls);
      applyApprovedDesignImagesToOrder(order.id, serialized);

      const { data: updatedRows, error } = await supabase
        .from("orders")
        .update({ approved_design_images: serialized })
        .eq("id", order.id)
        .select("id, approved_design_images");

      if (error) {
        const msg = error.message || "Could not save on order.";
        setFeedback("error", msg);
        alert(msg);
        console.error("approved design DB save failed", error);
        return;
      }

      const updatedRow = Array.isArray(updatedRows) ? updatedRows[0] : null;
      const savedSerialized =
        updatedRow?.approved_design_images != null ? updatedRow.approved_design_images : serialized;
      const savedUrls = parseDesignUrls(savedSerialized);

      if (savedUrls.length < nextUrls.length) {
        const msg =
          "Images uploaded but database did not store them. Run supabase/schema.sql in Supabase SQL Editor.";
        setFeedback("error", msg);
        alert(msg);
        console.warn("approved_design_images not persisted", { orderId: order.id, savedUrls, nextUrls });
        return;
      }

      applyApprovedDesignImagesToOrder(order.id, savedSerialized);
      setFeedback("ok", `Saved ${savedUrls.length} image${savedUrls.length === 1 ? "" : "s"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFeedback("error", message || "Upload failed.");
      alert(message || "Upload failed. Please try again.");
      console.error("approved design upload failed", err);
    } finally {
      setUploadingPostDesignOrderId(null);
    }
  }

  return (
    <div className="page">
      <header className="topbar panel">
        <div>
          <h1>Printing Orders</h1>
        </div>
        <div className="topbar-actions">
          <div className="topbar-user-badges">
            <div className="role-chip">
              {profileLoading ? "Loading…" : profileError ? "Error" : normalizedRole || "—"}
            </div>
            {!profileLoading && !profileError && profile?.department?.trim() ? (
              <div className="department-chip" title="Department">
                {profile.department.trim()}
              </div>
            ) : null}
          </div>
          {isAdmin && (
            <button type="button" className="topbar-users-btn" onClick={() => setShowMasterList(true)}>
              View users
            </button>
          )}
          <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
          <button onClick={handleSignOut}>Logout</button>
        </div>
      </header>

      {profileError && (
        <div className="panel profile-error-banner">
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

      <div className="dashboard-metrics">
        <section className="stats-grid">
          {summary.map((item) => (
            <div className={`stat-card stage-${item.key}`} key={item.key}>
              <div className="stat-title">
                {renderStageIcon(item.key, item.label)}
                {item.label}
              </div>
              <div className="stat-count">{item.count}</div>
              <div className="stat-sub">orders</div>
            </div>
          ))}
          <div className="stat-card stat-card-live">
            <div className="stat-title">
              <LiveStatusIcon active={liveOrders.length > 0} />
              Live
            </div>
            <div className="stat-count">{liveOrders.length}</div>
            <div className="stat-sub">live</div>
          </div>
        </section>

        {liveOrders.length > 0 && (
          <div className="live-orders-panel" aria-label="Live jobs">
          {liveOrders.map((lo) => {
            const mockupUrls = parseDesignUrls(lo.approved_design_url);
            const approvedDesignUrls = parseDesignUrls(lo.approved_design_images);
            return (
              <article className="live-order-detail-card" key={lo.id}>
                <div className="live-order-detail-card__top">
                  <div className="live-order-detail-card__brand">
                    <LiveActiveIcon size="md" />
                    <span className="live-order-detail-card__live-word">Live</span>
                  </div>
                  <div className="live-order-detail-card__hero">{lo.customer_name || "—"}</div>
                  <div className="live-order-detail-card__hero-sub">{lo.product_name || "—"}</div>
                  <div className="live-order-detail-card__tagline">live</div>
                </div>
                <dl className="live-order-detail-card__dl">
                  <div>
                    <dt>Order date</dt>
                    <dd>{lo.order_date}</dd>
                  </div>
                  <div>
                    <dt>Order ID</dt>
                    <dd>{lo.order_id?.trim() ? lo.order_id : "—"}</dd>
                  </div>
                  <div>
                    <dt>Due date</dt>
                    <dd>{lo.due_date}</dd>
                  </div>
                  <div>
                    <dt>Production order</dt>
                    <dd>
                      {lo.is_production_order ? (
                        <span className="production-order-pill" title="Production order">
                          Yes
                        </span>
                      ) : (
                        "No"
                      )}
                    </dd>
                  </div>
                  {lo.is_production_order ? (
                    <div>
                      <dt>Expected Handover to Printing</dt>
                      <dd>{lo.expected_handover_to_printing ?? "—"}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Received date &amp; time to printing</dt>
                    <dd>{formatReceivedAtDisplay(lo.received_at_printing)}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{lo.owner_name || "—"}</dd>
                  </div>
                  <div>
                    <dt>Coordinator</dt>
                    <dd>{lo.coordinator_name || "—"}</dd>
                  </div>
                  <div>
                    <dt>Qty</dt>
                    <dd>{lo.qty}</dd>
                  </div>
                  <div className="live-order-detail-card__full">
                    <dt>Sizes</dt>
                    <dd>{formatSizeBreakdownSummary(lo.size_breakdown)}</dd>
                  </div>
                  <div>
                    <dt>Printing mtrs</dt>
                    <dd>{Number(lo.printing_mtrs ?? 0).toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span className={`status-pill status-${lo.status}`}>
                        {renderStageIcon(lo.status, STAGE_LABEL[lo.status])} {STAGE_LABEL[lo.status]}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Colors</dt>
                    <dd>
                      {Array.isArray(lo.colors) && lo.colors.length ? (
                        <OrderColorsCell colors={lo.colors} />
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div className="live-order-detail-card__full">
                    <dt>Remarks</dt>
                    <dd>{lo.remarks?.trim() ? lo.remarks : "—"}</dd>
                  </div>
                </dl>
                {renderLiveOrderDesignSection(lo.id, mockupUrls, "mockups", "Mockups", "Mockup")}
                {renderLiveOrderDesignSection(
                  lo.id,
                  approvedDesignUrls,
                  "approved",
                  "Approved design images",
                  "Approved design"
                )}
              </article>
            );
          })}
        </div>
        )}
      </div>

      {isAdmin && masterTableMissing && (
        <p className="panel master-warning master-warning-banner">
          Supabase tables for Owners/Coordinators are missing. Run updated <code>supabase/schema.sql</code>.
        </p>
      )}

      {session && (
        <div className="create-order-row">
          <button type="button" className="btn-mockup" onClick={() => setShowMockupStudio(true)}>
            Create Mockup
          </button>
          {(isAdmin || viewerCanCreateOrders) && (
            <>
              <button type="button" onClick={() => setShowCreateForm((prev) => !prev)}>
                {showCreateForm ? "Close Form" : "Create New Order"}
              </button>
              {isAdmin && (
                <button type="button" onClick={handleExportCsv}>
                  Export
                </button>
              )}
            </>
          )}
        </div>
      )}

      {(isAdmin || viewerCanCreateOrders) && showCreateForm && (
        <section className="panel form-panel">
          <h2>{isAdmin ? "Create New Order (Master Admin)" : "Create New Order"}</h2>
          <form className="order-form" onSubmit={handleCreateOrder}>
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
            <div className="order-form-cell">
              <label htmlFor="create-order-external-id">Order ID</label>
              <input
                id="create-order-external-id"
                name="order_id"
                type="text"
                placeholder="e.g. shop / PO number"
                value={orderForm.order_id}
                onChange={onOrderFormChange}
              />
            </div>
            <div className="order-form-cell">
              <label htmlFor="create-order-due-date">Due date</label>
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
              {coordinators.map((coordinator) => (
                <option key={coordinator.id} value={coordinator.name}>
                  {coordinator.name}
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
                    <p className="order-form-hint colors-field-hint">
                      Tap swatches to add or remove. ✓ = selected. Pick at least one before save.
                    </p>
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
                <p className="order-form-hint order-size-total-hint">
                  Total: <strong>{sumSizeForm(orderForm.sizes)}</strong> (min 1)
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
            <div className="order-form-cell order-form-cell--full">
              <label htmlFor="create-order-mockups">Mockups</label>
              <p className="order-form-hint">Upload the approved design images for this job (one or more files).</p>
              <input
                id="create-order-mockups"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setDesignFiles(Array.from(e.target.files ?? []))}
                required
              />
            </div>
            <button type="submit">Save Job</button>
          </form>
        </section>
      )}

      <section className="panel table-panel">
        <div className="table-panel-head">
          <h2>
            {ordersTab === "active"
              ? "All orders"
              : ordersTab === "complete"
                ? "Complete orders"
                : isAdmin
                  ? "Coordinator report"
                  : "All orders"}
          </h2>
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
            {isAdmin ? (
              <button
                type="button"
                role="tab"
                aria-selected={ordersTab === "coordinator_report"}
                className={ordersTab === "coordinator_report" ? "orders-tab is-active" : "orders-tab"}
                onClick={() => setOrdersTab("coordinator_report")}
              >
                Coordinator report
              </button>
            ) : null}
          </div>
        </div>
        {!(ordersTab === "coordinator_report" && isAdmin) ? (
        <div className="table-filters">
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
            Sort by coordinator
            <select
              value={coordinatorSort}
              onChange={(e) => setCoordinatorSort(e.target.value)}
              aria-label="Sort or filter orders by coordinator"
            >
              <option value="none">Default (newest first)</option>
              <option value="group">All coordinators (grouped)</option>
              {coordinators.length > 0 ? (
                <optgroup label="Coordinator">
                  {coordinators.map((coordinator) => (
                    <option key={coordinator.id} value={`name:${coordinator.name}`}>
                      {coordinator.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
        </div>
        ) : null}
        {loadingOrders ? (
          <p>Loading orders...</p>
        ) : ordersTab === "coordinator_report" && isAdmin ? (
          <CoordinatorReportPanel orders={orders} coordinators={coordinators} />
        ) : (
          <div className="table-wrap">
            <input
              ref={postDesignFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="table-inline-file-input"
              aria-hidden
              tabIndex={-1}
              onChange={handlePostDesignFileInputChange}
            />
            <table>
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Order ID</th>
                  <th>Owner</th>
                  <th>Customer Name</th>
                  <th>Coordinator</th>
                  <th>Qty</th>
                  <th>Sizes</th>
                  <th>Product Name</th>
                  <th>Colors</th>
                  <th>Mockups</th>
                  <th>Approved Design Images</th>
                  <th>Due Date</th>
                  <th>Production</th>
                  <th>Expected Handover to Printing</th>
                  <th>Received date &amp; time to printing</th>
                  <th>Printing Mtrs</th>
                  <th>Status</th>
                  <th>Remarks</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedFilteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.order_date}</td>
                    <td>{order.order_id?.trim() ? order.order_id : "—"}</td>
                    <td>{order.owner_name || "-"}</td>
                    <td>
                      <span className="customer-name-cell">
                        {order.is_live && (
                          <span className="customer-live-wrap" title="Live job">
                            <LiveStatusIcon active size="sm" />
                          </span>
                        )}
                        {order.customer_name}
                      </span>
                    </td>
                    <td>
                      {canCurrentUserEdit("coordinator_name") ? (
                        <select
                          value={coordinatorUpdates[order.id] ?? order.coordinator_name}
                          onChange={(e) =>
                            setCoordinatorUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
                        >
                          {coordinators.map((coordinator) => (
                            <option key={coordinator.id} value={coordinator.name}>
                              {coordinator.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        order.coordinator_name
                      )}
                    </td>
                    <td>
                      {canCurrentUserEdit("qty") ? (
                        <input
                          type="number"
                          min="1"
                          value={qtyUpdates[order.id] ?? order.qty}
                          onChange={(e) =>
                            setQtyUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
                        />
                      ) : (
                        order.qty
                      )}
                    </td>
                    <td className="order-sizes-cell">{formatSizeBreakdownSummary(order.size_breakdown)}</td>
                    <td>{order.product_name}</td>
                    <td>
                      <OrderColorsCell colors={order.colors} />
                    </td>
                    <td>
                      {(() => {
                        const urls = parseDesignUrls(order.approved_design_url);
                        if (!urls.length) return "-";
                        return (
                          <div className={`approved-grid ${urls.length > 1 ? "multi" : "single"}`}>
                            {urls.map((url, index) => (
                              <button
                                type="button"
                                className="approved-thumb-btn"
                                onClick={() => openPreview(urls, index)}
                                key={`${order.id}-${index}`}
                              >
                                <img src={url} alt={`Mockup ${index + 1}`} />
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="approved-post-design-cell">
                      {(() => {
                        const postUrls = parseDesignUrls(order.approved_design_images);
                        return (
                          <div className="approved-post-design-wrap">
                            {postUrls.length > 0 ? (
                              <div className={`approved-grid ${postUrls.length > 1 ? "multi" : "single"}`}>
                                {postUrls.map((url, index) => (
                                  <button
                                    type="button"
                                    className="approved-thumb-btn"
                                    key={`${order.id}-post-${index}`}
                                    onClick={() => openPreview(postUrls, index)}
                                  >
                                    <img src={url} alt={`Approved design ${index + 1}`} />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {canCurrentUserEdit("approved_design_images") ? (
                              <>
                                <button
                                  type="button"
                                  className="table-inline-file-label"
                                  disabled={uploadingPostDesignOrderId === order.id}
                                  onClick={() => openPostDesignFilePicker(order)}
                                >
                                  {uploadingPostDesignOrderId === order.id
                                    ? "Uploading…"
                                    : postUrls.length
                                      ? "Add more"
                                      : "Add images"}
                                </button>
                                {postDesignUploadFeedback[order.id]?.message ? (
                                  <span
                                    className={`post-design-upload-feedback post-design-upload-feedback--${postDesignUploadFeedback[order.id].status}`}
                                    role="status"
                                  >
                                    {postDesignUploadFeedback[order.id].message}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      {canCurrentUserEdit("due_date") ? (
                        <input
                          type="date"
                          value={dueDateUpdates[order.id] ?? order.due_date}
                          onChange={(e) =>
                            setDueDateUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
                        />
                      ) : (
                        order.due_date
                      )}
                    </td>
                    <td>
                      {order.is_production_order ? (
                        <span className="production-order-pill" title="Production order">
                          Production
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="order-handover-cell">
                      {order.is_production_order && order.expected_handover_to_printing
                        ? order.expected_handover_to_printing
                        : "—"}
                    </td>
                    <td className="order-received-at-cell">
                      {canCurrentUserEdit("received_at_printing") ? (
                        <input
                          type="datetime-local"
                          className="inline-received-at-printing"
                          value={
                            receivedAtPrintingUpdates[order.id] !== undefined
                              ? receivedAtPrintingUpdates[order.id]
                              : receivedAtToDatetimeLocalValue(order.received_at_printing)
                          }
                          onChange={(e) =>
                            setReceivedAtPrintingUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
                          title="Received date and time to printing"
                        />
                      ) : (
                        formatReceivedAtDisplay(order.received_at_printing)
                      )}
                    </td>
                    <td>
                      {canCurrentUserEdit("printing_mtrs") ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="inline-printing-mtrs"
                          value={printingMtrsUpdates[order.id] ?? String(order.printing_mtrs ?? 0)}
                          onChange={(e) =>
                            setPrintingMtrsUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
                        />
                      ) : (
                        Number(order.printing_mtrs ?? 0).toFixed(2)
                      )}
                    </td>
                    <td>
                      <span className={`status-pill status-${order.status}`}>
                        {renderStageIcon(order.status, STAGE_LABEL[order.status])} {STAGE_LABEL[order.status]}
                      </span>
                      {canUseOrderControls && canCurrentUserEdit("status") && (
                        <select
                          className={`status-select status-${statusUpdates[order.id] ?? order.status}`}
                          value={statusUpdates[order.id] ?? order.status}
                          onChange={(e) => {
                            const value = e.target.value;
                            void persistOrderStatus(order, value);
                          }}
                        >
                          {STAGES.map((stage) => (
                            <option value={stage} key={stage}>
                              {STAGE_OPTION_ICON[stage]} {STAGE_LABEL[stage]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {canCurrentUserEdit("remarks") ? (
                        <textarea
                          className="inline-remarks"
                          value={remarksUpdates[order.id] ?? order.remarks ?? ""}
                          onChange={(e) =>
                            setRemarksUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
                        />
                      ) : (
                        order.remarks ?? "-"
                      )}
                    </td>
                    <td className="order-actions-cell">
                      {profileLoading ? (
                        "…"
                      ) : canUseOrderControls ? (
                        <>
                          {viewerMayUpdateOrders && (
                            <button
                              type="button"
                              onClick={() => handleViewerUpdate(order.id)}
                              disabled={Boolean(profileError)}
                            >
                              Update
                            </button>
                          )}
                          {!viewerMayUpdateOrders && !isAdmin && (
                            <span className="order-actions-note">View only</span>
                          )}
                          {isAdmin && (
                            <>
                              {!order.is_complete && (
                                <>
                                  {order.is_live ? (
                                    <button
                                      type="button"
                                      className="btn-stop-live"
                                      onClick={() => handleStopLive(order)}
                                      disabled={Boolean(profileError)}
                                    >
                                      Stop live
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-set-live"
                                      onClick={() => handleSetLive(order)}
                                      disabled={Boolean(profileError)}
                                      title="Mark this job as live"
                                    >
                                      Set Live
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-mark-complete"
                                    onClick={() => handleMarkComplete(order)}
                                    disabled={Boolean(profileError)}
                                  >
                                    Mark as complete
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="danger-btn order-delete-btn"
                                onClick={() => handleDeleteOrder(order)}
                                disabled={Boolean(profileError)}
                              >
                                Delete job
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        "Read Only"
                      )}
                    </td>
                  </tr>
                ))}
                {sortedFilteredOrders.length === 0 && (
                  <tr>
                    <td colSpan="16">
                      {ordersTab === "complete"
                        ? "No completed orders in the selected date range."
                        : "No orders found for selected date range."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <MockupStudio open={showMockupStudio} onClose={() => setShowMockupStudio(false)} />
      {previewImages.length > 0 && (
        <div className="image-modal-backdrop" onClick={closePreview}>
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
      {showMasterList && (
        <div className="image-modal-backdrop" onClick={() => setShowMasterList(false)}>
          <div className="master-list-modal master-list-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="master-list-head">
              <h3>Owners, coordinators & viewer users</h3>
              <button type="button" onClick={() => setShowMasterList(false)}>
                x
              </button>
            </div>

            <div className="viewer-users-section viewer-users-section-top">
              <h4>Viewer users & field access</h4>
              {viewerProfiles.length ? (
                <div className="users-access-table-wrap">
                  <table className="users-access-table">
                    <thead>
                      <tr>
                        <th>Display name</th>
                        <th>Department</th>
                        <th>Email</th>
                        <th>Can edit</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewerProfiles.map((viewer) => {
                        const nameValue =
                          viewerNameDrafts[viewer.id] !== undefined
                            ? viewerNameDrafts[viewer.id]
                            : viewer.full_name ?? "";
                        const departmentValue =
                          viewerDepartmentDrafts[viewer.id] !== undefined
                            ? viewerDepartmentDrafts[viewer.id]
                            : viewer.department ?? "";
                        const draft =
                          permissionDrafts[viewer.id] ??
                          hydrateDraftFromPermission(viewerPermissions[viewer.id] ?? {});
                        return (
                          <tr key={viewer.id}>
                            <td>
                              <input
                                className="user-name-input"
                                type="text"
                                placeholder="Display name"
                                value={nameValue}
                                onChange={(e) =>
                                  setViewerNameDrafts((prev) => ({
                                    ...prev,
                                    [viewer.id]: e.target.value
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="user-name-input"
                                type="text"
                                placeholder="Department"
                                value={departmentValue}
                                onChange={(e) =>
                                  setViewerDepartmentDrafts((prev) => ({
                                    ...prev,
                                    [viewer.id]: e.target.value
                                  }))
                                }
                              />
                            </td>
                            <td className="user-email-cell">{viewer.email?.trim() || "—"}</td>
                            <td>
                              <div className="viewer-permission-fields user-access-checkboxes">
                                {EDITABLE_FIELD_OPTIONS.map((option) => {
                                  const fieldKey = `can_edit_${option.key}`;
                                  return (
                                    <label key={fieldKey}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(draft[fieldKey])}
                                        onChange={(e) =>
                                          updatePermissionDraft(viewer.id, fieldKey, e.target.checked)
                                        }
                                      />
                                      {option.label}
                                    </label>
                                  );
                                })}
                                <label className="viewer-perm-create-order">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(draft.can_create_orders)}
                                    onChange={(e) =>
                                      updatePermissionDraft(viewer.id, "can_create_orders", e.target.checked)
                                    }
                                  />
                                  Create new order
                                </label>
                              </div>
                            </td>
                            <td className="user-access-actions">
                              <button
                                type="button"
                                className="btn-save-green"
                                onClick={() => handleSaveViewerRow(viewer.id)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="danger-btn"
                                onClick={() => handleResetViewerPermissions(viewer.id)}
                              >
                                Reset permissions
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="master-empty">No viewer accounts yet.</p>
              )}
            </div>

            <div className="master-list-divider" />

            <div className="master-list-add-row">
              <div className="master-box master-box-inline">
                <h4>Add owner</h4>
                <div className="master-row">
                  <input
                    type="text"
                    placeholder="Owner name"
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                  />
                  <button type="button" onClick={handleAddOwner}>
                    Add
                  </button>
                </div>
              </div>
              <div className="master-box master-box-inline">
                <h4>Add coordinator</h4>
                <div className="master-row">
                  <input
                    type="text"
                    placeholder="Coordinator name"
                    value={newCoordinatorName}
                    onChange={(e) => setNewCoordinatorName(e.target.value)}
                  />
                  <button type="button" onClick={handleAddCoordinator}>
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="master-list-grid">
              <div>
                <h4>Owners</h4>
                <ul className="master-list-items">
                  {owners.length ? (
                    owners.map((owner) => (
                      <li key={owner.id}>
                        <span>
                          {owner.name} - Owner
                        </span>
                        <div className="master-item-actions">
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => handleDeleteOwner(owner)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li>No owners added</li>
                  )}
                </ul>
              </div>
              <div>
                <h4>Coordinators</h4>
                <ul className="master-list-items">
                  {coordinators.length ? (
                    coordinators.map((coordinator) => (
                      <li key={coordinator.id}>
                        <span>
                          {coordinator.name} - Coordinator
                        </span>
                        <div className="master-item-actions">
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => handleDeleteCoordinator(coordinator)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li>No coordinators added</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
