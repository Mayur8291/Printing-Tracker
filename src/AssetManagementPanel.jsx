import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  LayoutDashboard,
  Package,
  Plus,
  Printer,
  ScanLine,
  Search,
  Settings
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { renderAssetLabelBarcodeSvg } from "./assetLabelBarcode";
import { printAssetLabel } from "./assetLabelPrint";
import {
  assignHrAsset,
  checkInHrAsset,
  insertHrAsset,
  listHrAssets,
  summarizeHrAssetCategories,
  summarizeHrAssetStatuses
} from "./hrAssetUtils";
import {
  ASSET_LABEL_FIELD_OPTIONS,
  DEFAULT_ASSET_LABEL_SETTINGS,
  SAMPLE_LABEL_ASSET,
  buildAssetLabelLines,
  loadAssetLabelSettings,
  saveAssetLabelSettings
} from "./assetLabelSettings";
import { profileDisplayName } from "./coordinatorSelectUtils";
import { supabase } from "./supabaseClient";
import { generateNextAssetTag, userDisplayInitials } from "./assetTagUtils";
import { viewerIsActive } from "./viewerUserListUtils";

const STATUS_STYLES = {
  Available: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  "Checked out": { badge: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-600" },
  Maintenance: { badge: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  Retired: { badge: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400" }
};

const THUMB_STYLES = {
  Laptop: { box: "bg-blue-50", dot: "bg-blue-600" },
  Monitor: { box: "bg-sky-50", dot: "bg-sky-500" },
  Phone: { box: "bg-violet-50", dot: "bg-violet-600" },
  Networking: { box: "bg-indigo-50", dot: "bg-indigo-600" },
  Peripheral: { box: "bg-emerald-50", dot: "bg-emerald-600" },
  Printer: { box: "bg-slate-100", dot: "bg-slate-500" },
  Tablet: { box: "bg-rose-50", dot: "bg-rose-500" }
};

const STATS = [
  { label: "Total assets", sub: "none yet", icon: LayoutDashboard },
  { label: "Checked out", sub: "of fleet", icon: Package },
  { label: "Available", sub: "ready to deploy", icon: Package },
  { label: "In maintenance", sub: "on bench", icon: Settings }
];

const ACTIVITY = [];
const ATTENTION = [];
const HISTORY = [];
const AUDIT = [];
const FILTERS = ["All assets", "Checked out", "Maintenance"];
const ASSET_CATEGORIES = ["Laptop", "Monitor", "Phone", "Tablet", "Networking", "Peripheral", "Printer", "Server"];
const ASSET_LOCATIONS = ["Ground floor", "4th floor IT room"];
const CONDITION_OPTIONS = ["Good", "Fair", "Damaged"];

const blankForm = () => ({
  "Asset name": "",
  Category: "Laptop",
  Manufacturer: "",
  Model: "",
  "Serial number": "",
  "Purchase date": "",
  Location: "Ground floor",
  "Assigned to": "",
  Notes: ""
});

const TEXT_FIELDS = [
  { label: "Manufacturer", ph: "Apple" },
  { label: "Model", ph: "A2991" },
  { label: "Serial number", ph: "C02XK1MPJGH7" },
  { label: "Purchase date", ph: "mm / dd / yyyy" }
];

const emptyHint = (text) => <div className="py-10 text-center text-sm text-muted-foreground">{text}</div>;

function statusStyle(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.Retired;
}

function thumb(category) {
  return THUMB_STYLES[category] || THUMB_STYLES.Printer;
}

export default function AssetManagementPanel({ isAdmin = false, sessionUserId = "" }) {
  const [screen, setScreen] = useState("dashboard");
  const [selectedTag, setSelectedTag] = useState(null);
  const [modal, setModal] = useState(null);
  const [charger, setCharger] = useState(true);
  const [rawAssets, setRawAssets] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All assets");
  const [form, setForm] = useState(blankForm);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [assignPickUserId, setAssignPickUserId] = useState("");
  const [modalAssignUserId, setModalAssignUserId] = useState("");
  const [labelSettings, setLabelSettings] = useState(() => loadAssetLabelSettings());
  const [settingsDraft, setSettingsDraft] = useState(() => loadAssetLabelSettings());
  const [settingsNotice, setSettingsNotice] = useState("");

  useEffect(() => {
    setAssignPickUserId("");
  }, [selectedTag]);

  useEffect(() => {
    if (screen === "settings") {
      setSettingsDraft(labelSettings);
      setSettingsNotice("");
    }
  }, [screen, labelSettings]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      setListLoading(true);
      setListError("");
      try {
        const rows = await listHrAssets();
        if (!cancelled) setRawAssets(rows);
      } catch (error) {
        if (!cancelled) {
          setRawAssets([]);
          setListError(error?.message || "Could not load assets.");
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    }
    void loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      setUsersLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, department, job_role, employee_id, is_active, role")
        .in("role", ["viewer", "admin"])
        .order("full_name", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Asset assign users:", error.message);
        setDirectoryUsers([]);
      } else {
        setDirectoryUsers(data ?? []);
      }
      setUsersLoading(false);
    }
    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDirectoryUsers = useMemo(
    () => directoryUsers.filter((user) => viewerIsActive(user)),
    [directoryUsers]
  );

  const nextTag = useMemo(
    () => generateNextAssetTag(rawAssets.map((a) => a.tag)),
    [rawAssets]
  );

  const userLabel = (user) => profileDisplayName(user) || user?.email || "User";
  const setField = (label, value) => setForm((p) => ({ ...p, [label]: value }));
  const go = (s) => () => {
    setScreen(s);
    if (s !== "detail") {
      setSelectedTag(null);
      setModal(null);
    }
  };

  const open = (tag) => {
    setSelectedTag(tag);
    setScreen("detail");
  };

  const closeDetail = () => {
    setSelectedTag(null);
    setModal(null);
    setScreen("assets");
  };

  const replaceAsset = (updated) => {
    if (!updated) return;
    setRawAssets((prev) => [updated, ...prev.filter((a) => a.id !== updated.id)]);
  };

  const assignAsset = async (asset, userId) => {
    if (!asset?.id) return false;
    const user = activeDirectoryUsers.find((u) => u.id === userId);
    if (!user) return false;
    setSaveError("");
    try {
      const updated = await assignHrAsset(asset.id, {
        userId,
        assigneeName: userLabel(user)
      });
      replaceAsset(updated);
      return true;
    } catch (error) {
      setSaveError(error?.message || "Could not assign asset.");
      return false;
    }
  };

  const checkInAsset = async (asset) => {
    if (!asset?.id) return;
    setSaveError("");
    try {
      const updated = await checkInHrAsset(asset.id);
      replaceAsset(updated);
    } catch (error) {
      setSaveError(error?.message || "Could not check in asset.");
    }
  };

  const saveAsset = async () => {
    setSaveError("");
    setSaving(true);
    try {
      const created = await insertHrAsset({
        sessionUserId,
        form,
        charger,
        directoryUsers: activeDirectoryUsers,
        existingTags: rawAssets.map((a) => a.tag)
      });
      replaceAsset(created);
      setForm(blankForm());
      setCharger(true);
      setActiveFilter("All assets");
      setScreen("assets");
    } catch (error) {
      console.error("[hr-assets] save failed", error);
      setSaveError(error?.message || "Could not save asset.");
    } finally {
      setSaving(false);
    }
  };

  const assets = rawAssets.map((a) => {
    const st = statusStyle(a.status);
    const th = thumb(a.cat);
    return {
      ...a,
      badgeClass: st.badge,
      badgeDotClass: st.dot,
      thumbClass: th.box,
      thumbDotClass: th.dot
    };
  });

  const filteredAssets = assets.filter((a) => {
    if (activeFilter === "All assets") return true;
    return a.status === activeFilter;
  });

  const detail = selectedTag ? assets.find((a) => a.tag === selectedTag) || null : null;
  const tagValue = nextTag;

  const statCounts = {
    "Total assets": assets.length,
    "Checked out": assets.filter((a) => a.status === "Checked out").length,
    Available: assets.filter((a) => a.status === "Available").length,
    "In maintenance": assets.filter((a) => a.status === "Maintenance").length
  };

  const specs = !detail
    ? []
    : [
        { k: "Asset tag", v: detail.tag, mono: true },
        { k: "Serial number", v: detail.serial, mono: true },
        { k: "Category", v: detail.cat },
        { k: "Manufacturer", v: detail.maker },
        { k: "Model", v: detail.model },
        { k: "Purchase date", v: detail.purchaseDate },
        { k: "Charger included", v: detail.chargerIncluded ? "Yes" : "No" },
        { k: "Location", v: detail.location }
      ];

  const detailAssignedUser = detail?.assigneeUserId
    ? activeDirectoryUsers.find((u) => u.id === detail.assigneeUserId)
    : null;

  const detailIsUnassigned =
    detail && (detail.status === "Available" || detail.assignee === "—" || !detail.assigneeUserId);

  const handleDetailAssign = async () => {
    if (!detail || !assignPickUserId) return;
    if (await assignAsset(detail, assignPickUserId)) {
      setAssignPickUserId("");
    }
  };

  const handleModalConfirm = async () => {
    if (!detail) return;
    if (modal === "out") {
      if (!modalAssignUserId) return;
      if (await assignAsset(detail, modalAssignUserId)) {
        setModal(null);
        setModalAssignUserId("");
      }
      return;
    }
    if (modal === "in") {
      await checkInAsset(detail);
      setModal(null);
    }
  };

  const detailBarcodeSvg = useMemo(
    () => (detail ? renderAssetLabelBarcodeSvg(detail.tag) : ""),
    [detail?.tag]
  );
  const tagBarcodeSvg = useMemo(() => renderAssetLabelBarcodeSvg(tagValue), [tagValue]);

  const handlePrintLabel = async (overrides = {}, settingsOverride) => {
    setPrintingLabel(true);
    try {
      await printAssetLabel(
        {
          tag: overrides.tag ?? tagValue,
          name: overrides.name ?? form["Asset name"],
          serial: overrides.serial ?? form["Serial number"],
          location: overrides.location ?? form.Location,
          category: overrides.category ?? form.Category,
          assignee: overrides.assignee
        },
        settingsOverride ?? labelSettings
      );
    } finally {
      setPrintingLabel(false);
    }
  };

  const updateLabelSetting = (key, value) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveLabelSettings = () => {
    const saved = saveAssetLabelSettings(settingsDraft);
    setLabelSettings(saved);
    setSettingsDraft(saved);
    setSettingsNotice("Label settings saved.");
  };

  const handleResetLabelSettings = () => {
    const saved = saveAssetLabelSettings(DEFAULT_ASSET_LABEL_SETTINGS);
    setLabelSettings(saved);
    setSettingsDraft(saved);
    setSettingsNotice("Reset to default label layout.");
  };

  const labelPreviewAsset = useMemo(() => {
    if (screen === "settings") return SAMPLE_LABEL_ASSET;
    if (screen === "add") {
      return {
        tag: tagValue,
        name: form["Asset name"] || "Sample asset",
        cat: form.Category,
        serial: form["Serial number"],
        maker: form.Manufacturer,
        location: form.Location,
        assignee: "—"
      };
    }
    if (detail) return detail;
    return SAMPLE_LABEL_ASSET;
  }, [screen, tagValue, form, detail]);

  const labelPreviewLines = useMemo(
    () => buildAssetLabelLines(labelPreviewAsset, screen === "settings" ? settingsDraft : labelSettings),
    [labelPreviewAsset, labelSettings, settingsDraft, screen]
  );

  const categoryBars = summarizeHrAssetCategories(assets);
  const statusDist = summarizeHrAssetStatuses(assets);

  const renderLabelPreview = (lines, { compact = false } = {}) => (
    <div
      className={cn(
        "rounded-lg border border-dashed bg-muted/40 text-center",
        compact ? "space-y-1 p-3" : "space-y-1.5 p-4"
      )}
    >
      {lines.aboveLine1 ? <div className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>{lines.aboveLine1}</div> : null}
      {lines.aboveLine2 ? <div className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{lines.aboveLine2}</div> : null}
      <div
        className="flex justify-center py-1"
        dangerouslySetInnerHTML={{
          __html:
            screen === "settings"
              ? renderAssetLabelBarcodeSvg(SAMPLE_LABEL_ASSET.tag)
              : tagBarcodeSvg || detailBarcodeSvg || renderAssetLabelBarcodeSvg(labelPreviewAsset.tag || "IT-00001")
        }}
      />
      {lines.belowLine1 ? <div className={cn("font-mono font-semibold tracking-[0.16em]", compact ? "text-xs" : "text-sm")}>{lines.belowLine1}</div> : null}
      {lines.belowLine2 ? <div className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{lines.belowLine2}</div> : null}
    </div>
  );

  const activeId = screen === "detail" ? "assets" : screen;
  const modalTitle = modal === "in" ? "Check in asset" : "Check out asset";
  const modalCta = modal === "in" ? "Confirm check-in" : "Confirm check-out";

  const navGroups = [
    {
      title: "Manage",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "assets", label: "Assets", icon: Package },
        { id: "add", label: "Add asset", icon: Plus }
      ]
    },
    {
      title: "Operate",
      items: [
        { id: "scanner", label: "Scanner", icon: ScanLine },
        { id: "reports", label: "Audit log", icon: FileText }
      ]
    }
  ];

  return (
    <div className="flex min-h-0 flex-1 w-full overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4">
            {navGroups.map((group) => (
              <div key={group.title} className="space-y-1">
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">{group.title}</div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeId === item.id;
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant={active ? "default" : "ghost"}
                      onClick={() => {
                        setScreen(item.id);
                        setSelectedTag(null);
                        setModal(null);
                      }}
                      className={cn(
                        "w-full justify-start",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Button>
                  );
                })}
              </div>
            ))}
            {isAdmin ? (
              <div className="space-y-1">
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">Admin</div>
                <Button
                  type="button"
                  variant={activeId === "settings" ? "default" : "ghost"}
                  onClick={go("settings")}
                  className={cn(
                    "w-full justify-start",
                    activeId === "settings"
                      ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Settings className="size-4" />
                  Label settings
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search assets, tags, people..." />
          </div>
          <Button type="button" variant="outline" onClick={go("scanner")}>
            <ScanLine className="size-4" />
            Scan
          </Button>
          <Button type="button" onClick={go("add")}>
            <Plus className="size-4" />
            New asset
          </Button>
        </header>

        <main className="relative min-h-0 flex-1 overflow-auto">
          {screen === "dashboard" && renderDashboard()}
          {(screen === "assets" || screen === "detail") && renderAssets()}
          {screen === "detail" && detail ? (
            <div className="absolute inset-0 z-10 overflow-auto bg-background">
              {renderDetail()}
            </div>
          ) : null}
          {screen === "add" && renderAdd()}
          {screen === "reports" && renderAudit()}
          {screen === "scanner" && renderScanner()}
          {screen === "settings" && isAdmin && renderSettings()}
        </main>
      </div>

      {modal ? renderModal() : null}
    </div>
  );

  function renderDashboard() {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Fleet overview · {assets.length === 0 ? "no assets tracked yet" : `${assets.length} tracked asset${assets.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <Badge variant="outline" className="gap-2 px-3 py-1 text-xs font-medium">
            <span className="size-2 rounded-full bg-emerald-500" />
            Saved in register
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATS.map((s) => (
            <Card key={s.label}>
              <CardHeader className="space-y-0 pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{s.label}</CardDescription>
                  <s.icon className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tracking-tight">{statCounts[s.label]}</div>
                <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Assets by category</CardTitle>
                <Badge variant="outline" className="font-mono text-xs">
                  {categoryBars.length} types
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {categoryBars.length === 0 ? emptyHint("No categories yet") : null}
              {categoryBars.map((c) => (
                <div key={c.name} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="font-mono text-muted-foreground">{c.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-muted">
                    <div className={cn("h-full rounded", thumb(c.name).dot)} style={{ width: c.pct }} />
                  </div>
                </div>
              ))}
              <Separator />
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status distribution</h3>
                <div className="flex h-3 gap-1 overflow-hidden rounded-full bg-muted">
                  {statusDist.map((d) => (
                    <div key={d.label} className={cn("h-full", statusStyle(d.label).dot)} style={{ width: d.pct }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-4">
                  {statusDist.map((d) => (
                    <div key={d.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn("size-2 rounded-sm", statusStyle(d.label).dot)} />
                      <span>{d.label}</span>
                      <span className="font-mono">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Recent activity</CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={go("reports")}>
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {ACTIVITY.length === 0 ? emptyHint("No recent activity") : null}
              {ACTIVITY.map((a, i) => (
                <div key={i} className="flex items-start gap-3 border-b pb-3 last:border-0 last:pb-0">
                  <Badge variant="secondary" className="mt-0.5 whitespace-nowrap">
                    {a.type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{a.tag}</span> · {a.user}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{a.time}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 text-amber-600" />
              <CardTitle className="text-sm">Needs attention</CardTitle>
              <Badge variant="outline" className="text-amber-700">
                {ATTENTION.length} items
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {ATTENTION.length === 0 ? emptyHint("Nothing needs attention") : null}
            {ATTENTION.map((a) => (
              <button
                key={a.tag}
                type="button"
                onClick={() => open(a.tag)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="size-2 rounded-full" style={{ background: a.dot }} />
                <span className="w-24 font-mono text-xs text-muted-foreground">{a.tag}</span>
                <span className="flex-1 truncate text-sm font-medium">{a.name}</span>
                <span className="text-sm text-muted-foreground">{a.reason}</span>
                <span className="text-xs font-semibold" style={{ color: a.dueColor }}>{a.due}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderAssets() {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeFilter === "All assets" ? `${assets.length} assets` : `${filteredAssets.length} of ${assets.length} · ${activeFilter}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((label) => (
            <Button
              key={label}
              type="button"
              variant={activeFilter === label ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(label)}
            >
              {label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button type="button" variant="outline" size="sm">
            Sort
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {listError ? (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertTitle>Could not load assets</AlertTitle>
                  <AlertDescription>{listError}</AlertDescription>
                </Alert>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Tag</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listLoading ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex flex-col gap-2 py-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                {!listLoading && assets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>{emptyHint("No assets yet — click 'New asset' to add one")}</TableCell>
                  </TableRow>
                ) : null}
                {!listLoading && assets.length > 0 && filteredAssets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>{emptyHint("No assets match this filter")}</TableCell>
                  </TableRow>
                ) : null}
                {!listLoading &&
                  filteredAssets.map((a) => (
                  <TableRow key={a.id || a.tag} className="cursor-pointer" onClick={() => open(a.tag)}>
                    <TableCell>
                      <div className="size-4 rounded-sm border border-muted-foreground/30" />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-primary">{a.tag}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className={cn("flex size-8 items-center justify-center rounded-md", a.thumbClass)}>
                          <span className={cn("size-3 rounded-sm", a.thumbDotClass)} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{a.name}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{a.serial}</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{a.cat}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("gap-1.5", a.badgeClass)}>
                        <span className={cn("size-1.5 rounded-full", a.badgeDotClass)} />
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{a.assignee}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{a.seen}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderDetail() {
    if (!detail) return null;

    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
        {saveError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not update asset</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={closeDetail} className="w-fit">
          <ArrowLeft className="size-4" />
          Back to assets
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
              <Badge variant="outline" className={cn("gap-1.5", detail.badgeClass)}>
                <span className={cn("size-1.5 rounded-full", detail.badgeDotClass)} />
                {detail.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{detail.maker} · {detail.cat}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Card className="w-fit">
                <CardContent className="space-y-1 p-3">
                  <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: detailBarcodeSvg }} />
                  <p className="text-center font-mono text-xs font-semibold tracking-[0.18em]">{detail.tag}</p>
                </CardContent>
              </Card>
              <Button
                type="button"
                variant="outline"
                disabled={printingLabel}
                onClick={() => handlePrintLabel({
                  tag: detail.tag,
                  name: detail.name,
                  serial: detail.serial,
                  location: detail.location,
                  category: detail.cat,
                  assignee: detail.assignee
                })}
              >
                <Printer className="size-4" />
                {printingLabel ? "Preparing..." : "Print label"}
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline">Edit</Button>
            {detailIsUnassigned ? (
              <Button type="button" onClick={() => { setModalAssignUserId(""); setModal("out"); }}>
                Check out
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setModal("in")}>
                Check in
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Specifications</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 md:grid-cols-2 md:gap-x-8">
              {specs.map((s) => (
                <div key={s.k} className="flex items-center justify-between border-b py-3 text-sm">
                  <span className="text-muted-foreground">{s.k}</span>
                  <span className={cn("font-medium text-foreground", s.mono ? "font-mono text-xs" : "")}>{s.v}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detailIsUnassigned ? (
                <>
                  <p className="text-sm text-muted-foreground">This asset is unassigned. Choose a user from the admin user list.</p>
                  <div className="space-y-2">
                    <Label>Assign to</Label>
                    <Select
                      value={assignPickUserId || undefined}
                      onValueChange={setAssignPickUserId}
                      disabled={usersLoading || activeDirectoryUsers.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={usersLoading ? "Loading users..." : "Select user"} />
                      </SelectTrigger>
                      <SelectContent>
                        {activeDirectoryUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {userLabel(user)}{user.department ? ` · ${user.department}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" className="w-full" disabled={!assignPickUserId} onClick={handleDetailAssign}>
                    Assign asset
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {userDisplayInitials(detail.assignee, detailAssignedUser?.email)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{detail.assignee}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {detailAssignedUser?.department || "—"}
                        {detailAssignedUser?.email ? ` · ${detailAssignedUser.email}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium">{detail.status}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Location</span>
                      <span className="font-medium">{detail.location}</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {HISTORY.length === 0 ? emptyHint("No history yet") : null}
            {HISTORY.map((hh, i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1 size-2.5 rounded-full" style={{ background: hh.dot }} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{hh.title}</span>
                    <span className="text-xs text-muted-foreground">{hh.date}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{hh.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderAdd() {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Add asset</CardTitle>
            <CardDescription>Register a new device and generate its barcode tag.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Asset name</Label>
                <Input value={form["Asset name"]} onChange={(e) => setField("Asset name", e.target.value)} placeholder='MacBook Pro 16"' />
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.Category} onValueChange={(v) => setField("Category", v)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {ASSET_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {TEXT_FIELDS.map((field) => (
                <div key={field.label} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input
                    value={form[field.label]}
                    onChange={(e) => setField(field.label, e.target.value)}
                    placeholder={field.ph}
                  />
                </div>
              ))}

              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={form.Location} onValueChange={(v) => setField("Location", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_LOCATIONS.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Assigned to</Label>
                <Select
                  value={form["Assigned to"] || "__unassigned__"}
                  onValueChange={(v) => setField("Assigned to", v === "__unassigned__" ? "" : v)}
                  disabled={usersLoading}
                >
                  <SelectTrigger><SelectValue placeholder={usersLoading ? "Loading users..." : "Unassigned"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {activeDirectoryUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {userLabel(user)}{user.department ? ` · ${user.department}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Charger included</Label>
                <div className="flex gap-2">
                  <Button type="button" variant={charger ? "default" : "outline"} className="flex-1" onClick={() => setCharger(true)}>Yes</Button>
                  <Button type="button" variant={!charger ? "default" : "outline"} className="flex-1" onClick={() => setCharger(false)}>No</Button>
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.Notes}
                  onChange={(e) => setField("Notes", e.target.value)}
                  placeholder="Condition, accessories, purchase order..."
                />
              </div>
            </div>

            <Separator />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setForm(blankForm()); setSaveError(""); setScreen("assets"); }}>
                Cancel
              </Button>
              <Button type="button" onClick={saveAsset} disabled={saving}>
                {saving ? "Saving..." : "Save asset"}
              </Button>
            </div>
            {saveError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not save</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-sm">Label preview (4×6 cm)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {renderLabelPreview(labelPreviewLines, { compact: true })}
            <div className="space-y-2">
              <Label>Asset tag</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm font-semibold tracking-wider">{tagValue}</div>
            </div>
            {isAdmin ? (
              <Button type="button" variant="outline" className="w-full" onClick={go("settings")}>
                <Settings className="size-4" />
                Label settings
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="w-full" disabled={printingLabel} onClick={() => handlePrintLabel()}>
              <Printer className="size-4" />
              {printingLabel ? "Preparing..." : "Print label"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderSettingsField(key, title, hint) {
    return (
      <div key={key} className="space-y-2">
        <Label>{title}</Label>
        <Select value={settingsDraft[key]} onValueChange={(v) => updateLabelSetting(key, v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ASSET_LABEL_FIELD_OPTIONS.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    );
  }

  function renderSettings() {
    const previewLines = buildAssetLabelLines(SAMPLE_LABEL_ASSET, settingsDraft);
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Label settings</CardTitle>
            <CardDescription>
              Choose what prints above and below the barcode on 4×6 cm asset labels. Settings apply for all users on this browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderSettingsField("aboveLine1", "Above barcode — line 1", "Usually the main title, e.g. asset name.")}
            {renderSettingsField("aboveLine2", "Above barcode — line 2", "Optional subtitle, e.g. category and serial.")}
            {renderSettingsField("belowLine1", "Below barcode — line 1", "Often the scannable asset tag (IT-00001).")}
            {renderSettingsField("belowLine2", "Below barcode — line 2", "Optional footer, e.g. location.")}
            <Separator />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleResetLabelSettings}>Reset defaults</Button>
              <Button type="button" onClick={handleSaveLabelSettings}>Save settings</Button>
            </div>
            {settingsNotice ? (
              <Alert>
                <AlertTitle>Saved</AlertTitle>
                <AlertDescription>{settingsNotice}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-sm">Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {renderLabelPreview(previewLines, { compact: true })}
            <p className="text-xs text-muted-foreground">Sample data shown. Barcode always encodes the asset tag for scanning.</p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={printingLabel}
              onClick={() => handlePrintLabel({
                tag: SAMPLE_LABEL_ASSET.tag,
                name: SAMPLE_LABEL_ASSET.name,
                serial: SAMPLE_LABEL_ASSET.serial,
                location: SAMPLE_LABEL_ASSET.location,
                category: SAMPLE_LABEL_ASSET.cat,
                assignee: SAMPLE_LABEL_ASSET.assignee
              }, settingsDraft)}
            >
              <Printer className="size-4" />
              {printingLabel ? "Preparing..." : "Print sample label"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderAudit() {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every scan, assignment and status change · last 30 days</p>
          </div>
          <Button type="button" variant="outline">
            <FileText className="size-4" />
            Export CSV
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AUDIT.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>{emptyHint("No audit events yet")}</TableCell>
                  </TableRow>
                ) : null}
                {AUDIT.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.time}</TableCell>
                    <TableCell><Badge variant="secondary">{e.type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs text-primary">{e.tag}</TableCell>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell>{e.user}</TableCell>
                    <TableCell className="text-muted-foreground">{e.location}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderScanner() {
    const steps = [
      { id: "1", title: "Scan the tag", sub: "CODE-128 and QR are recognised instantly." },
      { id: "2", title: "Confirm the action", sub: "Assign, return, or flag for maintenance." },
      { id: "3", title: "Synced everywhere", sub: "Updates land in the audit log in real time." }
    ];

    return (
      <div className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Mobile scanner</CardTitle>
            <CardDescription>Point a phone at any asset barcode to check it in or out on the spot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {steps.map((step) => (
              <div key={step.id} className="flex gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{step.id}</span>
                <div>
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.sub}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-slate-950 text-slate-50">
          <CardHeader>
            <CardTitle className="text-sm">Scanner preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative rounded-xl border border-slate-700 p-4">
              <div className="aspect-[9/16] rounded-lg border border-dashed border-blue-400 p-3">
                <div className="relative h-full rounded bg-slate-900/70">
                  <div className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-blue-400 shadow-[0_0_12px] shadow-blue-400/70" />
                </div>
              </div>
            </div>
            <Alert className="border-slate-700 bg-slate-900 text-slate-100">
              <AlertTitle>Awaiting scan</AlertTitle>
              <AlertDescription>Point the camera at an asset barcode to see details here.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderModal() {
    if (!detail) return null;

    return (
      <Dialog
        open={Boolean(modal)}
        onOpenChange={(openValue) => {
          if (!openValue) {
            setModal(null);
            setModalAssignUserId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
            <DialogDescription>
              {detail.name} · <span className="font-mono">{detail.tag}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <span className={cn("flex size-10 items-center justify-center rounded-md", detail.thumbClass)}>
                <span className={cn("size-4 rounded-sm", detail.thumbDotClass)} />
              </span>
              <div>
                <p className="text-sm font-semibold">{detail.name}</p>
                <p className="text-xs text-muted-foreground">{detail.cat} · {detail.maker}</p>
              </div>
            </div>

            {modal === "out" ? (
              <div className="space-y-2">
                <Label>Assign to</Label>
                <Select
                  value={modalAssignUserId || undefined}
                  onValueChange={setModalAssignUserId}
                  disabled={usersLoading || activeDirectoryUsers.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={usersLoading ? "Loading users..." : "Select user"} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeDirectoryUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {userLabel(user)}{user.department ? ` · ${user.department}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Alert>
                <AlertTitle>Check-in confirmation</AlertTitle>
                <AlertDescription>This will mark the asset as available and clear the current assignee.</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Due date</Label>
                <Input defaultValue="Jul 02, 2026" />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input defaultValue={detail.location} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Condition at handover</Label>
              <div className="flex gap-2">
                {CONDITION_OPTIONS.map((condition) => (
                  <Button key={condition} type="button" variant={condition === "Good" ? "default" : "outline"} className="flex-1">
                    {condition}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea placeholder="Optional handover note..." />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="button" disabled={modal === "out" && !modalAssignUserId} onClick={handleModalConfirm}>
              {modalCta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}
