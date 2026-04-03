import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const STAGES = ["new", "printing", "fusing", "ironing", "packing", "pending", "on_hold", "ready"];
const STAGE_LABEL = {
  new: "New Orders",
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
  printing: "🖨️",
  fusing: "🟧",
  ironing: "♨️",
  packing: "📦",
  pending: "⏳",
  on_hold: "⚠",
  ready: "✅"
};

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

const emptyOrder = {
  due_date: "",
  owner_name: "",
  customer_name: "",
  coordinator_name: "",
  qty: "",
  product_name: "",
  colors: [],
  printing_mtrs: "0.00",
  remarks: ""
};

const EDITABLE_FIELD_OPTIONS = [
  { key: "status", label: "Status" },
  { key: "remarks", label: "Remarks" },
  { key: "due_date", label: "Due Date" },
  { key: "qty", label: "Qty" },
  { key: "coordinator_name", label: "Coordinator" },
  { key: "printing_mtrs", label: "Printing Mtrs" }
];

const DEFAULT_NEW_USER_PERMISSIONS = {
  can_edit_status: true,
  can_edit_remarks: false,
  can_edit_due_date: false,
  can_edit_qty: false,
  can_edit_coordinator_name: false,
  can_edit_printing_mtrs: false,
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
  return Boolean(permissions[`can_edit_${field}`]);
}

function viewerHasAnyOrderFieldEdit(permissions) {
  return EDITABLE_FIELD_OPTIONS.some((opt) => viewerMayEditOrderField(permissions, opt.key));
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
  const [authLoading, setAuthLoading] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [designFiles, setDesignFiles] = useState([]);
  const [colorInput, setColorInput] = useState("");
  const [owners, setOwners] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newCoordinatorName, setNewCoordinatorName] = useState("");
  const [showMasterList, setShowMasterList] = useState(false);
  const [masterTableMissing, setMasterTableMissing] = useState(false);
  const [viewerProfiles, setViewerProfiles] = useState([]);
  const [viewerPermissions, setViewerPermissions] = useState({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ordersTab, setOrdersTab] = useState("active");
  const [statusUpdates, setStatusUpdates] = useState({});
  const [remarksUpdates, setRemarksUpdates] = useState({});
  const [qtyUpdates, setQtyUpdates] = useState({});
  const [dueDateUpdates, setDueDateUpdates] = useState({});
  const [printingMtrsUpdates, setPrintingMtrsUpdates] = useState({});
  const [coordinatorUpdates, setCoordinatorUpdates] = useState({});
  const [previewImages, setPreviewImages] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [viewerNameDrafts, setViewerNameDrafts] = useState({});
  const [viewerDepartmentDrafts, setViewerDepartmentDrafts] = useState({});
  const [permissionDrafts, setPermissionDrafts] = useState({});

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

    const channel = supabase
      .channel("orders-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => fetchOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

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

  async function fetchOrders() {
    setLoadingOrders(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_date, due_date, owner_name, customer_name, coordinator_name, qty, product_name, colors, approved_design_url, printing_mtrs, status, remarks, created_at, is_live, is_complete"
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error.message);
        return;
      }
      setOrders(data ?? []);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    } finally {
      setLoadingOrders(false);
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
  }

  function handleAddColor() {
    const value = colorInput.trim();
    if (!value) return;
    setOrderForm((prev) => {
      if (prev.colors.includes(value)) return prev;
      return { ...prev, colors: [...prev.colors, value] };
    });
    setColorInput("");
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
      alert("At least one approved design image is required.");
      return;
    }
    if (!orderForm.colors.length) {
      alert("Please add at least one color.");
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
      due_date: orderForm.due_date,
      owner_name: orderForm.owner_name,
      customer_name: orderForm.customer_name,
      coordinator_name: orderForm.coordinator_name,
      qty: Number(orderForm.qty),
      product_name: orderForm.product_name,
      colors: orderForm.colors,
      approved_design_url: JSON.stringify(uploadedUrls),
      printing_mtrs: printingMtrs,
      status: "new",
      remarks: orderForm.remarks || null,
      created_by: session.user.id
    };

    const { error } = await supabase.from("orders").insert(payload);
    if (error) {
      alert(error.message);
      return;
    }
    setOrderForm(emptyOrder);
    setDesignFiles([]);
    setColorInput("");
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
    if (filteredOrders.length === 0) {
      alert("No data available for selected date range.");
      return;
    }

    const headers = [
      "Order Date",
      "Due Date",
      "Owner",
      "Customer Name",
      "Coordinator",
      "Qty",
      "Product Name",
      "Colors",
      "Printing Mtrs",
      "Status",
      "Remarks"
    ];

    const rows = filteredOrders.map((order) => [
      formatDateForCsv(order.order_date),
      formatDateForCsv(order.due_date),
      order.owner_name,
      order.customer_name,
      order.coordinator_name,
      order.qty,
      order.product_name,
      Array.isArray(order.colors) ? order.colors.join(" | ") : "",
      order.printing_mtrs,
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

  async function handleViewerUpdate(orderId) {
    const currentUserPermissions = viewerPermissions[session?.user?.id] ?? {};
    const role = (profile?.role ?? "").trim().toLowerCase();
    const canEdit = (field) => {
      if (field === "coordinator_name" && role === "admin") return false;
      if (role === "admin") return true;
      if (role !== "viewer") return false;
      return viewerMayEditOrderField(currentUserPermissions, field);
    };

    const nextStatus = statusUpdates[orderId];
    const nextRemarks = remarksUpdates[orderId];
    const nextQty = qtyUpdates[orderId];
    const nextDueDate = dueDateUpdates[orderId];
    const nextPrintingMtrs = printingMtrsUpdates[orderId];
    const nextCoordinator = coordinatorUpdates[orderId];
    const payload = {};

    if (canEdit("status") && nextStatus) payload.status = nextStatus;
    if (canEdit("remarks") && typeof nextRemarks === "string") {
      payload.remarks = nextRemarks.trim() || null;
    }
    if (canEdit("qty") && nextQty != null && nextQty !== "") payload.qty = Number(nextQty);
    if (canEdit("due_date") && typeof nextDueDate === "string" && nextDueDate) payload.due_date = nextDueDate;
    if (canEdit("coordinator_name") && typeof nextCoordinator === "string" && nextCoordinator.trim()) {
      payload.coordinator_name = nextCoordinator.trim();
    }
    if (canEdit("printing_mtrs") && nextPrintingMtrs != null && nextPrintingMtrs !== "") {
      const n = Number(nextPrintingMtrs);
      if (!Number.isNaN(n) && n >= 0) payload.printing_mtrs = n;
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
                : order.printing_mtrs
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

    // Fallback sync in case realtime event is delayed/disabled.
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

  const liveOrders = useMemo(() => {
    const live = orders.filter((o) => o.is_live && !o.is_complete);
    return [...live].sort(
      (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
  }, [orders]);

  if (!session) {
    return (
      <div className="auth-page">
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
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
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
            const designUrls = parseDesignUrls(lo.approved_design_url);
            const colorsText =
              Array.isArray(lo.colors) && lo.colors.length ? lo.colors.join(", ") : "—";
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
                    <dt>Due date</dt>
                    <dd>{lo.due_date}</dd>
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
                    <dd>{colorsText}</dd>
                  </div>
                  <div className="live-order-detail-card__full">
                    <dt>Remarks</dt>
                    <dd>{lo.remarks?.trim() ? lo.remarks : "—"}</dd>
                  </div>
                </dl>
                {designUrls.length > 0 && (
                  <div className="live-order-detail-card__designs">
                    <span className="live-order-detail-card__designs-label">Approved design</span>
                    <div
                      className={`approved-grid ${designUrls.length > 1 ? "multi" : "single"} live-order-thumb-grid`}
                    >
                      {designUrls.map((url, index) => (
                        <button
                          type="button"
                          className="approved-thumb-btn"
                          key={`${lo.id}-live-design-${index}`}
                          onClick={() => openPreview(designUrls, index)}
                        >
                          <img src={url} alt={`Design ${index + 1}`} />
                        </button>
                      ))}
                    </div>
                  </div>
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

      {(isAdmin || viewerCanCreateOrders) && (
        <div className="create-order-row">
          <button type="button" onClick={() => setShowCreateForm((prev) => !prev)}>
            {showCreateForm ? "Close Form" : "Create New Order"}
          </button>
          {isAdmin && (
            <button type="button" onClick={handleExportCsv}>
              Export
            </button>
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
            <input name="qty" type="number" min="1" placeholder="Qty" value={orderForm.qty} onChange={onOrderFormChange} required />
            <input
              name="product_name"
              placeholder="Product Name"
              value={orderForm.product_name}
              onChange={onOrderFormChange}
              required
            />
            <div className="colors-field">
              <div className="colors-input-row">
                <input
                  type="text"
                  placeholder="Add Color"
                  value={colorInput}
                  onChange={(e) => setColorInput(e.target.value)}
                />
                <button type="button" onClick={handleAddColor}>
                  Add Color
                </button>
              </div>
              <div className="color-chips">
                {orderForm.colors.map((color) => (
                  <span key={color} className="color-chip">
                    {color}
                    <button type="button" onClick={() => handleRemoveColor(color)}>
                      x
                    </button>
                  </span>
                ))}
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
            <textarea
              name="remarks"
              placeholder="Remarks (optional)"
              value={orderForm.remarks}
              onChange={onOrderFormChange}
            />
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setDesignFiles(Array.from(e.target.files ?? []))}
              required
            />
            <button type="submit">Save Job</button>
          </form>
        </section>
      )}

      <section className="panel table-panel">
        <div className="table-panel-head">
          <h2>{ordersTab === "active" ? "All orders" : "Complete orders"}</h2>
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
        </div>
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
        </div>
        {loadingOrders ? (
          <p>Loading orders...</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order Date</th>
                  <th>Owner</th>
                  <th>Customer Name</th>
                  <th>Coordinator</th>
                  <th>Qty</th>
                  <th>Product Name</th>
                  <th>Colors</th>
                  <th>Approved Design</th>
                  <th>Due Date</th>
                  <th>Printing Mtrs</th>
                  <th>Status</th>
                  <th>Remarks</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.order_date}</td>
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
                    <td>{order.product_name}</td>
                    <td>{Array.isArray(order.colors) && order.colors.length ? order.colors.join(", ") : "-"}</td>
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
                                <img src={url} alt={`Approved Design ${index + 1}`} />
                              </button>
                            ))}
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
                          onChange={(e) =>
                            setStatusUpdates((prev) => ({
                              ...prev,
                              [order.id]: e.target.value
                            }))
                          }
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
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan="13">
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
            <img src={previewImages[previewIndex]} alt="Approved Design Preview" />
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
              <p className="master-help">
                Set <strong>Display name</strong> and <strong>Department</strong> (shown beside role in the header for that
                user), edit checkboxes, then click the green <strong>Save</strong> button for that row. Changes apply only
                after Save. Email is shown for reference. <strong>Create new order</strong> lets viewers submit new jobs;
                they cannot change those jobs after save unless you also tick field access (e.g. Status).
              </p>
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
                <p className="master-help master-help-tight">
                  Names shown as stored. Use <strong>Add owner</strong> above to add entries. <strong>Remove</strong> deletes
                  the master option (existing orders keep their saved owner text).
                </p>
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
                <p className="master-help master-help-tight">
                  Names shown as stored on each order. <strong>Add coordinator</strong> adds a pick-list option for{" "}
                  <em>new</em> orders only. <strong>Remove</strong> drops the name from the master list — existing orders
                  keep their saved coordinator text unchanged (same as owners).
                </p>
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
