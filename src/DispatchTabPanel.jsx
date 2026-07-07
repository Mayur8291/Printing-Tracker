import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  deliveryMethodLabel,
  DISPATCH_ISSUE_TYPES,
  DISPATCH_FAIL_STATUS,
  DISPATCHED_STATUS,
  dispatchIssueLabel,
  filterDispatchActiveOrders,
  filterDispatchProcessedOrders,
  filterOrdersBySearch,
  isDispatchVerificationFailed,
  suggestDispatchIssueType
} from "./orderTabUtils";
import {
  formatDeliveryDate,
  formatSizeBreakdownSummary,
  getDispatchSizeRows,
  STAGE_LABEL
} from "./orderViewUtils";
import { supabase } from "./supabaseClient";
import { OrdersPagination, usePagination } from "./orderPagination";
import OrdersListFilters from "./components/orders/OrdersListFilters";
import OrdersListSummary from "./components/orders/OrdersListSummary";
import OrderIdBadges from "./components/orders/OrderIdBadges";
import OrderStatusBadge from "./components/orders/OrderStatusBadge";
import OrderViewActionCell from "./components/orders/OrderViewActionCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import CreateInwardEntryModal from "./CreateInwardEntryModal";
import CreateOutwardChallanModal from "./CreateOutwardChallanModal";
import InwardEntryList from "./InwardEntryList";
import InwardEntryPreviewFloatingCard from "./InwardEntryPreviewFloatingCard";
import InwardGrnEntryPage from "./InwardGrnEntryPage";
import OcPreviewFloatingCard from "./OcPreviewFloatingCard";
import OutwardChallanList from "./OutwardChallanList";
import {
  deleteInwardEntry,
  INWARD_ENTRY_WITH_GRNS_SELECT,
  INWARD_SELECT_FIELDS
} from "./inwardEntryUtils";
import { deleteOutwardChallan, OC_SELECT_FIELDS } from "./outwardChallanUtils";

function formatColorsList(colors) {
  if (!Array.isArray(colors) || !colors.length) return "—";
  return colors.map((c) => String(c).trim()).filter(Boolean).join(", ") || "—";
}

function profileDisplay(profile) {
  if (!profile) return "order creator";
  const name = profile.full_name?.trim();
  const email = profile.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || "order creator";
}

function parseSizeVerifiedMap(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out = {};
  for (const [k, v] of Object.entries(stored)) {
    if (v === true || v === "true") out[k] = true;
  }
  return out;
}

function buildInitialSizeVerified(order, sizeRows) {
  const stored = parseSizeVerifiedMap(order.dispatch_sizes_verified);
  const out = {};
  for (const row of sizeRows) {
    out[row.key] = Boolean(stored[row.key]);
  }
  return out;
}

function allSizesVerified(sizeRows, sizeVerified) {
  if (!sizeRows.length) return false;
  return sizeRows.every((row) => Boolean(sizeVerified[row.key]));
}

const DISPATCH_TAB_LABELS = {
  printing: "Printing order",
  regular_stock: "Regular stock",
  inward: "Inward (Regular stock)",
  outward: "Outward (Regular stock)"
};

function isRegularStockOrder(order) {
  return (order.order_kind ?? "printing") === "regular_stock";
}

export default function DispatchTabPanel({
  orders,
  loadingOrders,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearDates,
  onViewOrder,
  onVerificationUpdated,
  renderStageIcon,
  canEdit = true,
  isAdmin = false,
  sessionUserId,
  teamProfiles,
  initialDispatchSubview = null,
  pendingOutwardOcId = null,
  pendingInwardEntryId = null,
  onNavigateConsumed
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  const [draftByOrderId, setDraftByOrderId] = useState({});
  const [dispatchTab, setDispatchTab] = useState("printing");
  const [searchQuery, setSearchQuery] = useState("");
  const [createOcOpen, setCreateOcOpen] = useState(false);
  const [createInwardOpen, setCreateInwardOpen] = useState(false);
  const [outwardChallans, setOutwardChallans] = useState([]);
  const [inwardEntries, setInwardEntries] = useState([]);
  const [loadingChallans, setLoadingChallans] = useState(false);
  const [loadingInward, setLoadingInward] = useState(false);
  const [previewRecord, setPreviewRecord] = useState(null);
  const [previewInwardRecord, setPreviewInwardRecord] = useState(null);
  const [grnEntryRecord, setGrnEntryRecord] = useState(null);

  const regularStockOrders = useMemo(
    () => (orders ?? []).filter(isRegularStockOrder),
    [orders]
  );

  const printingOrders = useMemo(
    () => (orders ?? []).filter((o) => !isRegularStockOrder(o)),
    [orders]
  );

  const tabOrders = useMemo(() => {
    switch (dispatchTab) {
      case "inward":
        return filterDispatchActiveOrders(regularStockOrders);
      case "outward":
        return filterDispatchProcessedOrders(regularStockOrders);
      case "regular_stock":
        return regularStockOrders;
      case "printing":
      default:
        return filterDispatchActiveOrders(printingOrders);
    }
  }, [dispatchTab, regularStockOrders, printingOrders]);

  const isProcessedView = dispatchTab === "outward";
  const isInwardGrnView = dispatchTab === "inward";
  const isInwardGrnFullView = isInwardGrnView && Boolean(grnEntryRecord);
  const isLedgerView = isProcessedView || (isInwardGrnView && !isInwardGrnFullView);

  const filteredOrders = useMemo(
    () => (isLedgerView ? tabOrders : filterOrdersBySearch(tabOrders, searchQuery)),
    [tabOrders, searchQuery, isLedgerView]
  );

  const searchTrimmed = searchQuery.trim();
  const paginationKey = `${dispatchTab}|${dateFrom}|${dateTo}|${searchTrimmed}`;

  const {
    visible: visibleOrders,
    total: totalFiltered,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(filteredOrders, "dispatch", paginationKey);

  const profileById = useMemo(() => {
    const map = new Map();
    for (const p of teamProfiles ?? []) {
      if (p?.id) map.set(p.id, p);
    }
    return map;
  }, [teamProfiles]);

  const loadOutwardChallans = useCallback(async () => {
    setLoadingChallans(true);
    const { data, error } = await supabase
      .from("outward_challans")
      .select(OC_SELECT_FIELDS)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("outward_challans load:", error.message);
      setOutwardChallans([]);
    } else {
      setOutwardChallans(data ?? []);
    }
    setLoadingChallans(false);
  }, []);

  const loadInwardEntries = useCallback(async () => {
    setLoadingInward(true);
    let { data, error } = await supabase
      .from("inward_entries")
      .select(INWARD_ENTRY_WITH_GRNS_SELECT)
      .order("created_at", { ascending: false });
    if (error?.message?.includes("inward_grn_entries")) {
      const fallback = await supabase
        .from("inward_entries")
        .select(INWARD_SELECT_FIELDS)
        .order("created_at", { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      console.error("inward_entries load:", error.message);
      setInwardEntries([]);
    } else {
      setInwardEntries(data ?? []);
    }
    setLoadingInward(false);
  }, []);

  useEffect(() => {
    if (dispatchTab === "outward") {
      loadOutwardChallans();
    }
    if (dispatchTab === "inward") {
      loadInwardEntries();
    }
  }, [dispatchTab, loadOutwardChallans, loadInwardEntries]);

  function closeVerifyPanel() {
    setExpandedId(null);
  }

  useEffect(() => {
    if (!initialDispatchSubview) return;
    setDispatchTab(initialDispatchSubview);
    closeVerifyPanel();
    if (pendingOutwardOcId == null && pendingInwardEntryId == null) {
      onNavigateConsumed?.();
    }
  }, [initialDispatchSubview, pendingOutwardOcId, pendingInwardEntryId, onNavigateConsumed]);

  useEffect(() => {
    if (pendingOutwardOcId == null) return;
    setDispatchTab("outward");
    const openPending = async () => {
      const local = outwardChallans.find((c) => c.id === pendingOutwardOcId);
      if (local) {
        setPreviewRecord(local);
        onNavigateConsumed?.();
        return;
      }
      const { data, error } = await supabase
        .from("outward_challans")
        .select(OC_SELECT_FIELDS)
        .eq("id", pendingOutwardOcId)
        .maybeSingle();
      if (!error && data) setPreviewRecord(data);
      onNavigateConsumed?.();
    };
    openPending();
  }, [pendingOutwardOcId, outwardChallans, onNavigateConsumed]);

  useEffect(() => {
    if (pendingInwardEntryId == null) return;
    setDispatchTab("inward");
    const openPending = async () => {
      const local = inwardEntries.find((entry) => entry.id === pendingInwardEntryId);
      if (local) {
        setPreviewInwardRecord(local);
        onNavigateConsumed?.();
        return;
      }
      const { data, error } = await supabase
        .from("inward_entries")
        .select(INWARD_ENTRY_WITH_GRNS_SELECT)
        .eq("id", pendingInwardEntryId)
        .maybeSingle();
      if (!error && data) setPreviewInwardRecord(data);
      onNavigateConsumed?.();
    };
    void openPending();
  }, [pendingInwardEntryId, inwardEntries, onNavigateConsumed]);

  const openOcPreview = useCallback((record) => {
    setPreviewRecord(record);
  }, []);

  const closeOcPreview = useCallback(() => {
    setPreviewRecord(null);
  }, []);

  const handleDeleteOc = useCallback(
    async (record) => {
      if (!isAdmin || !record?.id) return;
      await deleteOutwardChallan(supabase, record);
      if (previewRecord?.id === record.id) {
        closeOcPreview();
      }
      await loadOutwardChallans();
    },
    [isAdmin, previewRecord?.id, closeOcPreview, loadOutwardChallans]
  );

  const openInwardPreview = useCallback((record) => {
    setPreviewInwardRecord(record);
  }, []);

  const closeInwardPreview = useCallback(() => {
    setPreviewInwardRecord(null);
  }, []);

  const openGrnEntry = useCallback((record) => {
    setGrnEntryRecord(record);
  }, []);

  const closeGrnEntry = useCallback(() => {
    setGrnEntryRecord(null);
  }, []);

  const handleDeleteInward = useCallback(
    async (record) => {
      if (!isAdmin || !record?.id) return;
      await deleteInwardEntry(supabase, record);
      if (previewInwardRecord?.id === record.id) {
        closeInwardPreview();
      }
      await loadInwardEntries();
    },
    [isAdmin, previewInwardRecord?.id, closeInwardPreview, loadInwardEntries]
  );

  const totalQty = filteredOrders.reduce((sum, o) => sum + (Number(o.qty) || 0), 0);
  const failedCount = filteredOrders.filter((o) => isDispatchVerificationFailed(o)).length;

  const filterBits = [DISPATCH_TAB_LABELS[dispatchTab] ?? "Dispatch"];
  if (!isLedgerView) {
    if (dateFrom && dateTo) filterBits.push(`${dateFrom} → ${dateTo}`);
    else if (dateFrom) filterBits.push(`From ${dateFrom}`);
    else if (dateTo) filterBits.push(`To ${dateTo}`);
    if (searchTrimmed) filterBits.push(`Search: “${searchTrimmed}”`);
  } else if (searchTrimmed) {
    filterBits.push(
      isInwardGrnView ? `Inward filter “${searchTrimmed}”` : `OC # filter “${searchTrimmed}”`
    );
  }

  function getDraft(order) {
    const sizeRows = getDispatchSizeRows(order.size_breakdown);
    const saved = draftByOrderId[order.id];
    if (saved) return { ...saved, sizeRows };
    return {
      sizeRows,
      sizeVerified: buildInitialSizeVerified(order, sizeRows),
      productNameOk: Boolean(order.dispatch_product_name_ok),
      colorsOk: Boolean(order.dispatch_colors_ok),
      issueType: order.dispatch_issue_type || ""
    };
  }

  function setDraft(orderId, patch) {
    setDraftByOrderId((prev) => ({
      ...prev,
      [orderId]: { ...prev[orderId], ...patch }
    }));
  }

  function openVerifyPanel(order) {
    const sizeRows = getDispatchSizeRows(order.size_breakdown);
    setExpandedId(order.id);
    setDraftByOrderId((prev) => {
      if (prev[order.id]) return prev;
      return {
        ...prev,
        [order.id]: {
          sizeRows,
          sizeVerified: buildInitialSizeVerified(order, sizeRows),
          productNameOk: Boolean(order.dispatch_product_name_ok),
          colorsOk: Boolean(order.dispatch_colors_ok),
          issueType: order.dispatch_issue_type || ""
        }
      };
    });
  }

  async function saveVerification(order, pass) {
    const draft = getDraft(order);
    const sizesOk = allSizesVerified(draft.sizeRows, draft.sizeVerified);
    const allOk = Boolean(pass && sizesOk && draft.productNameOk && draft.colorsOk);
    const issueType = allOk ? null : draft.issueType || null;

    if (!pass && !issueType) {
      alert("Pick mismatch type: Count, Product, or Color.");
      return;
    }

    if (pass) {
      if (!sizesOk) {
        alert("Tick every size qty box before mark as dispatched.");
        return;
      }
      if (!draft.productNameOk || !draft.colorsOk) {
        alert("Tick product name and colors match before mark as dispatched.");
        return;
      }
    }

    setSubmittingId(order.id);
    try {
      const payload = {
        dispatch_sizes_verified: draft.sizeVerified,
        dispatch_sizes_qty_ok: sizesOk,
        dispatch_product_name_ok: draft.productNameOk,
        dispatch_colors_ok: draft.colorsOk,
        dispatch_issue_type: issueType,
        dispatch_verification_failed: !allOk,
        dispatch_verified_at: new Date().toISOString(),
        dispatch_verified_by: sessionUserId ?? null,
        status: allOk ? DISPATCHED_STATUS : DISPATCH_FAIL_STATUS
      };

      const { error } = await supabase.from("orders").update(payload).eq("id", order.id);
      if (error) throw new Error(error.message);

      if (!allOk) {
        const creator = profileById.get(order.created_by);
        const jobLabel = order.order_id?.trim() || `#${order.id}`;
        alert(
          `Dispatch check FAILED for ${jobLabel}.\n\n` +
            `Status: Dispatch Fail\n` +
            `Issue: ${dispatchIssueLabel(issueType)}\n` +
            `Tell ${profileDisplay(creator)} — order stay RED in Billing & Printing Orders.`
        );
      }

      setDraftByOrderId((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      closeVerifyPanel();
      if (allOk) {
        setDispatchTab("outward");
      }
      await onVerificationUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingId(null);
    }
  }

  function switchDispatchTab(nextTab) {
    setDispatchTab(nextTab);
    closeVerifyPanel();
    if (nextTab !== "inward") {
      closeGrnEntry();
    }
  }

  const summaryFilterBits = [...filterBits];
  if (failedCount > 0) {
    summaryFilterBits.push(`Failed verify: ${failedCount}`);
  }

  const dispatchExtraActions =
    dispatchTab === "inward" && !isInwardGrnFullView ? (
      <Button
        type="button"
        size="sm"
        disabled={!canEdit}
        title={canEdit ? "Record a new inward entry" : "View only"}
        onClick={() => setCreateInwardOpen(true)}
      >
        Make Entry
      </Button>
    ) : dispatchTab === "outward" ? (
      <Button
        type="button"
        size="sm"
        disabled={!canEdit}
        title={canEdit ? "Create a new outward challan" : "View only"}
        onClick={() => setCreateOcOpen(true)}
      >
        Create New OC
      </Button>
    ) : null;

  return (
    <div className="space-y-4">
      <Tabs value={dispatchTab} onValueChange={switchDispatchTab} aria-label="Dispatch views">
        <TabsList>
          <TabsTrigger value="printing">Printing order</TabsTrigger>
          <TabsTrigger value="regular_stock">Regular stock</TabsTrigger>
          <TabsTrigger value="inward">Inward</TabsTrigger>
          <TabsTrigger value="outward">Outward</TabsTrigger>
        </TabsList>
      </Tabs>
      {!isInwardGrnFullView ? (
        <OrdersListFilters
          idPrefix="dispatch"
          showDates={!isLedgerView}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
          onClearDates={onClearDates}
          clearDatesLabel="Clear"
          showSearch
          searchLabel={
            isProcessedView ? "Search by OC number" : isInwardGrnView ? "Search inward entries" : "Search"
          }
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onClearSearch={() => setSearchQuery("")}
          searchPlaceholder={
            isProcessedView
              ? "e.g. 4 or OC #4"
              : isInwardGrnView
                ? "Product, department, GRN…"
                : "Order #, customer, coordinator…"
          }
          searchInputMode={isProcessedView ? "numeric" : undefined}
          showPerPage={!isLedgerView}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          extraActions={dispatchExtraActions}
        />
      ) : null}
      {isInwardGrnFullView ? (
        <InwardGrnEntryPage
          inwardRecord={grnEntryRecord}
          sessionUserId={sessionUserId}
          canEdit={canEdit}
          onBack={closeGrnEntry}
          onSaved={async (record) => {
            await loadInwardEntries();
            if (previewInwardRecord?.id === record?.id) {
              const { data } = await supabase
                .from("inward_entries")
                .select(INWARD_ENTRY_WITH_GRNS_SELECT)
                .eq("id", record.id)
                .maybeSingle();
              if (data) setPreviewInwardRecord(data);
            }
          }}
        />
      ) : isInwardGrnView ? (
        <Card aria-labelledby="inward-entries-heading">
          <CardHeader>
            <CardTitle id="inward-entries-heading">Inward entries</CardTitle>
            <CardDescription>
              {loadingInward ? "Loading…" : `${inwardEntries.length} saved`}
              {searchTrimmed ? ` · filter “${searchTrimmed}”` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InwardEntryList
              entries={inwardEntries}
              loading={loadingInward}
              searchQuery={searchQuery}
              onViewRecord={openInwardPreview}
              onGrnEntry={openGrnEntry}
              canEdit={canEdit}
              canDelete={isAdmin}
              onDelete={handleDeleteInward}
            />
          </CardContent>
        </Card>
      ) : null}
      {isProcessedView ? (
        <Card aria-labelledby="outward-challans-heading">
          <CardHeader>
            <CardTitle id="outward-challans-heading">Outward challans</CardTitle>
            <CardDescription>
              {loadingChallans ? "Loading…" : `${outwardChallans.length} saved`}
              {searchTrimmed ? ` · OC # filter “${searchTrimmed}”` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OutwardChallanList
              challans={outwardChallans}
              loading={loadingChallans}
              searchQuery={searchQuery}
              onViewRecord={openOcPreview}
              canDelete={isAdmin}
              onDelete={handleDeleteOc}
            />
          </CardContent>
        </Card>
      ) : null}
      {!isLedgerView && loadingOrders ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : null}
      {!isLedgerView && !loadingOrders ? (
        <>
          <OrdersListSummary
            label={DISPATCH_TAB_LABELS[dispatchTab] ?? "Dispatch"}
            count={totalFiltered}
            totalQty={totalQty}
            filterBits={summaryFilterBits}
          />
          <div className="rounded-xl border bg-card shadow-sm">
            <Table data-orders-table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[7rem]" />
                  <TableHead>Order number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product name</TableHead>
                  <TableHead className="min-w-[11rem]">Status</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>{dispatchTab === "regular_stock" ? "Dispatch" : "Verify"}</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOrders.map((order) => {
                  const failed = isDispatchVerificationFailed(order);
                  const expanded = expandedId === order.id;
                  const draft = getDraft(order);
                  const sizesOk = allSizesVerified(draft.sizeRows, draft.sizeVerified);
                  const allOk = sizesOk && draft.productNameOk && draft.colorsOk;
                  const showIssueSelect = !allOk;
                  const isDispatched = order.status === DISPATCHED_STATUS;
                  const statusLabel = STAGE_LABEL[order.status] ?? order.status ?? "—";

                  return (
                    <Fragment key={order.id}>
                      <TableRow
                        className={cn(
                          failed && "bg-destructive/5 hover:bg-destructive/10"
                        )}
                        title={
                          failed
                            ? `Verification failed: ${dispatchIssueLabel(order.dispatch_issue_type)}`
                            : undefined
                        }
                      >
                        <TableCell>
                          <OrderViewActionCell order={order} onViewOrder={onViewOrder} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <OrderIdBadges orderId={order.order_id} />
                            {failed ? (
                              <Badge variant="destructive" className="text-[10px] uppercase">
                                Fail
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {order.customer_name?.trim() ? order.customer_name : "—"}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {order.product_name?.trim() ? order.product_name : "—"}
                        </TableCell>
                        <TableCell>
                          <OrderStatusBadge
                            status={order.status}
                            label={statusLabel}
                            icon={renderStageIcon?.(order.status, statusLabel)}
                          />
                        </TableCell>
                        <TableCell>{deliveryMethodLabel(order.delivery_method)}</TableCell>
                        <TableCell>
                          {isDispatched ? (
                            <span className="text-sm text-muted-foreground">
                              {order.dispatch_verified_at
                                ? new Date(order.dispatch_verified_at).toLocaleString()
                                : "—"}
                            </span>
                          ) : (
                            <div className="dispatch-verify-cell">
                              {failed ? (
                                <p className="dispatch-fail-reason text-sm text-destructive" title="Why verification failed">
                                  {order.dispatch_issue_type
                                    ? dispatchIssueLabel(order.dispatch_issue_type)
                                    : "Verification failed"}
                                </p>
                              ) : null}
                              {canEdit ? (
                                <div className="flex flex-wrap gap-2">
                                  {failed ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openVerifyPanel(order)}
                                    >
                                      Verify again
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      expanded ? closeVerifyPanel() : openVerifyPanel(order)
                                    }
                                  >
                                    {expanded ? "Close" : failed ? "Re-open" : "Verify"}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{order.qty}</TableCell>
                      </TableRow>
                      {expanded && !isDispatched ? (
                        <TableRow className="dispatch-verify-row hover:bg-transparent">
                          <TableCell colSpan={8} className="p-0">
                            <div className="dispatch-verify-panel">
                              {failed ? (
                                <div className="dispatch-verify-fail-banner" role="alert">
                                  <span className="dispatch-verify-fail-banner-label">Failed</span>
                                  {order.dispatch_issue_type
                                    ? dispatchIssueLabel(order.dispatch_issue_type)
                                    : "Verification did not pass"}
                                </div>
                              ) : null}
                              <div className="dispatch-verify-job-ref">
                                <h4>Job record (from create form)</h4>
                                <dl className="dispatch-verify-ref-grid">
                                  <div>
                                    <dt>Product</dt>
                                    <dd>{order.product_name?.trim() || "—"}</dd>
                                  </div>
                                  <div>
                                    <dt>Colors</dt>
                                    <dd>{formatColorsList(order.colors)}</dd>
                                  </div>
                                  <div>
                                    <dt>Total qty</dt>
                                    <dd>{order.qty ?? "—"}</dd>
                                  </div>
                                  <div>
                                    <dt>All sizes</dt>
                                    <dd>{formatSizeBreakdownSummary(order.size_breakdown)}</dd>
                                  </div>
                                  <div>
                                    <dt>Delivery</dt>
                                    <dd>{deliveryMethodLabel(order.delivery_method)}</dd>
                                  </div>
                                  <div>
                                    <dt>Due</dt>
                                    <dd>{formatDeliveryDate(order.due_date)}</dd>
                                  </div>
                                </dl>
                              </div>

                              <fieldset className="dispatch-verify-sizes" disabled={!canEdit}>
                                <legend>Count pieces per size (tick when qty match)</legend>
                                {draft.sizeRows.length === 0 ? (
                                  <p className="dispatch-verify-empty-sizes">
                                    No sizes on job — cannot verify counts.
                                  </p>
                                ) : (
                                  <div className="dispatch-size-grid" role="group" aria-label="Size quantities">
                                    {draft.sizeRows.map((row) => {
                                      const checked = Boolean(draft.sizeVerified[row.key]);
                                      return (
                                        <label
                                          key={row.key}
                                          className={`dispatch-size-box${checked ? " dispatch-size-box--checked" : ""}`}
                                        >
                                          <span className="dispatch-size-box__size">{row.label}</span>
                                          <span className="dispatch-size-box__qty">{row.qty}</span>
                                          <span className="dispatch-size-box__ok">
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              disabled={!canEdit}
                                              onChange={(e) => {
                                                const sizeVerified = {
                                                  ...draft.sizeVerified,
                                                  [row.key]: e.target.checked
                                                };
                                                const sizesOkNext = allSizesVerified(
                                                  draft.sizeRows,
                                                  sizeVerified
                                                );
                                                const allOkNext =
                                                  sizesOkNext &&
                                                  draft.productNameOk &&
                                                  draft.colorsOk;
                                                setDraft(order.id, {
                                                  sizeVerified,
                                                  issueType: allOkNext
                                                    ? ""
                                                    : draft.issueType ||
                                                      suggestDispatchIssueType({
                                                        sizesQtyOk: sizesOkNext,
                                                        productNameOk: draft.productNameOk,
                                                        colorsOk: draft.colorsOk
                                                      })
                                                });
                                              }}
                                            />
                                            OK
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </fieldset>

                              <fieldset className="dispatch-verify-checks" disabled={!canEdit}>
                                <legend>Product &amp; colors</legend>
                                <label className="dispatch-verify-check">
                                  <input
                                    type="checkbox"
                                    checked={draft.productNameOk}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      const productNameOk = e.target.checked;
                                      const allOkNext =
                                        sizesOk && productNameOk && draft.colorsOk;
                                      setDraft(order.id, {
                                        productNameOk,
                                        issueType: allOkNext
                                          ? ""
                                          : draft.issueType ||
                                            suggestDispatchIssueType({
                                              sizesQtyOk: sizesOk,
                                              productNameOk,
                                              colorsOk: draft.colorsOk
                                            })
                                      });
                                    }}
                                  />
                                  Product name matches
                                </label>
                                <label className="dispatch-verify-check">
                                  <input
                                    type="checkbox"
                                    checked={draft.colorsOk}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      const colorsOk = e.target.checked;
                                      const allOkNext =
                                        sizesOk && draft.productNameOk && colorsOk;
                                      setDraft(order.id, {
                                        colorsOk,
                                        issueType: allOkNext
                                          ? ""
                                          : draft.issueType ||
                                            suggestDispatchIssueType({
                                              sizesQtyOk: sizesOk,
                                              productNameOk: draft.productNameOk,
                                              colorsOk
                                            })
                                      });
                                    }}
                                  />
                                  Colors match
                                </label>
                              </fieldset>

                              {showIssueSelect ? (
                                <label className="dispatch-verify-issue">
                                  Mismatch type
                                  <select
                                    value={draft.issueType}
                                    disabled={!canEdit}
                                    onChange={(e) =>
                                      setDraft(order.id, { issueType: e.target.value })
                                    }
                                  >
                                    <option value="">Select…</option>
                                    {DISPATCH_ISSUE_TYPES.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null}

                              {canEdit ? (
                                <div className="dispatch-verify-actions flex flex-wrap items-center gap-3">
                                  {allOk ? (
                                    <Button
                                      type="button"
                                      disabled={submittingId === order.id}
                                      onClick={() => saveVerification(order, true)}
                                    >
                                      {submittingId === order.id
                                        ? "Saving…"
                                        : "Verified & mark as dispatch"}
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      disabled={submittingId === order.id}
                                      onClick={() => saveVerification(order, false)}
                                    >
                                      {submittingId === order.id
                                        ? "Saving…"
                                        : "Submit — Dispatch Fail"}
                                    </Button>
                                  )}
                                  {order.dispatch_verified_at ? (
                                    <span className="dispatch-verify-meta text-sm text-muted-foreground">
                                      Last verified{" "}
                                      {new Date(order.dispatch_verified_at).toLocaleString()}
                                      {failed && order.dispatch_issue_type
                                        ? ` · ${dispatchIssueLabel(order.dispatch_issue_type)}`
                                        : ""}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
                {visibleOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      {searchTrimmed
                        ? "No orders match your search."
                        : `No orders in ${DISPATCH_TAB_LABELS[dispatchTab] ?? "this view"} for the selected date range.`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <OrdersPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={totalFiltered}
            pageSize={pageSize}
          />
        </>
      ) : null}
      <OcPreviewFloatingCard
        open={Boolean(previewRecord)}
        record={previewRecord}
        onClose={closeOcPreview}
        canDelete={isAdmin}
        onDelete={handleDeleteOc}
      />
      <InwardEntryPreviewFloatingCard
        open={Boolean(previewInwardRecord)}
        record={previewInwardRecord}
        onClose={closeInwardPreview}
        canDelete={isAdmin}
        onDelete={handleDeleteInward}
      />
      <CreateOutwardChallanModal
        open={createOcOpen}
        onClose={() => setCreateOcOpen(false)}
        sessionUserId={sessionUserId}
        onCreated={(record) => {
          loadOutwardChallans();
          openOcPreview(record);
          setCreateOcOpen(false);
        }}
      />
      <CreateInwardEntryModal
        open={createInwardOpen}
        onClose={() => setCreateInwardOpen(false)}
        sessionUserId={sessionUserId}
        onCreated={() => {
          loadInwardEntries();
          setCreateInwardOpen(false);
        }}
      />
    </div>
  );
}
