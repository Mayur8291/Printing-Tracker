import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  deliveryMethodLabel,
  DISPATCH_ISSUE_TYPES,
  DISPATCH_FAIL_STATUS,
  DISPATCHED_STATUS,
  dispatchIssueLabel,
  dispatchRowHighlightClass,
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
  splitOrderIds,
  STAGE_LABEL
} from "./orderViewUtils";
import { supabase } from "./supabaseClient";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";
import CreateInwardEntryModal from "./CreateInwardEntryModal";
import CreateOutwardChallanModal from "./CreateOutwardChallanModal";
import InwardEntryList from "./InwardEntryList";
import InwardEntryPreviewFloatingCard from "./InwardEntryPreviewFloatingCard";
import OcPreviewFloatingCard from "./OcPreviewFloatingCard";
import OutwardChallanList from "./OutwardChallanList";
import { deleteInwardEntry, INWARD_SELECT_FIELDS } from "./inwardEntryUtils";
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
  const isLedgerView = isProcessedView || isInwardGrnView;

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
    const { data, error } = await supabase
      .from("inward_entries")
      .select(INWARD_SELECT_FIELDS)
      .order("created_at", { ascending: false });
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
    if (pendingOutwardOcId == null) {
      onNavigateConsumed?.();
    }
  }, [initialDispatchSubview, pendingOutwardOcId, onNavigateConsumed]);

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

  function renderOrderIdBadges(orderId) {
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
  }

  return (
    <>
      <div className="table-filters linked-tab-filters dispatch-tab-filters">
        <div className="orders-tabs dispatch-orders-tabs" role="tablist" aria-label="Dispatch views">
          <button
            type="button"
            role="tab"
            aria-selected={dispatchTab === "printing"}
            className={dispatchTab === "printing" ? "orders-tab is-active" : "orders-tab"}
            onClick={() => switchDispatchTab("printing")}
          >
            Printing order
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dispatchTab === "regular_stock"}
            className={dispatchTab === "regular_stock" ? "orders-tab is-active" : "orders-tab"}
            onClick={() => switchDispatchTab("regular_stock")}
          >
            Regular stock
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dispatchTab === "inward"}
            className={dispatchTab === "inward" ? "orders-tab is-active" : "orders-tab"}
            onClick={() => switchDispatchTab("inward")}
          >
            Inward
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dispatchTab === "outward"}
            className={dispatchTab === "outward" ? "orders-tab is-active" : "orders-tab"}
            onClick={() => switchDispatchTab("outward")}
          >
            Outward
          </button>
        </div>
        {!isLedgerView ? (
          <>
            <label>
              From
              <input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} />
            </label>
            <button type="button" onClick={onClearDates}>
              Clear dates
            </button>
          </>
        ) : null}
        <label className="orders-search-field">
          {isProcessedView ? "Search by OC number" : isInwardGrnView ? "Search inward entries" : "Search"}
          <input
            type="search"
            className="orders-search-input"
            placeholder={
              isProcessedView
                ? "e.g. 4 or OC #4"
                : isInwardGrnView
                  ? "GRN, supplier, product, for whom…"
                  : "Order #, customer, coordinator…"
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            inputMode={isProcessedView ? "numeric" : undefined}
          />
        </label>
        {searchTrimmed ? (
          <button type="button" onClick={() => setSearchQuery("")}>
            Clear search
          </button>
        ) : null}
        {!isLedgerView ? (
          <OrdersPerPageControl
            idPrefix="dispatch-orders-per-page"
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        ) : null}
        {dispatchTab === "inward" ? (
          <button
            type="button"
            className="dispatch-create-oc-btn"
            disabled={!canEdit}
            title={canEdit ? "Record a new inward entry" : "View only"}
            onClick={() => setCreateInwardOpen(true)}
          >
            Make Entry
          </button>
        ) : null}
        {dispatchTab === "outward" ? (
          <button
            type="button"
            className="dispatch-create-oc-btn"
            disabled={!canEdit}
            title={canEdit ? "Create a new outward challan" : "View only"}
            onClick={() => setCreateOcOpen(true)}
          >
            Create New OC
          </button>
        ) : null}
      </div>
      {isInwardGrnView ? (
        <section
          className="outward-challans-section dashboard-card"
          aria-labelledby="inward-entries-heading"
        >
          <header className="outward-challans-section-head">
            <h3 id="inward-entries-heading" className="dashboard-section-title">
              Inward entries
            </h3>
            <p className="outward-challans-section-meta">
              {loadingInward ? "Loading…" : `${inwardEntries.length} saved`}
              {searchTrimmed ? ` · filter “${searchTrimmed}”` : ""}
            </p>
          </header>
          <InwardEntryList
            entries={inwardEntries}
            loading={loadingInward}
            searchQuery={searchQuery}
            onViewRecord={openInwardPreview}
            canDelete={isAdmin}
            onDelete={handleDeleteInward}
          />
        </section>
      ) : null}
      {isProcessedView ? (
        <section
          className="outward-challans-section dashboard-card"
          aria-labelledby="outward-challans-heading"
        >
          <header className="outward-challans-section-head">
            <h3 id="outward-challans-heading" className="dashboard-section-title">
              Outward challans
            </h3>
            <p className="outward-challans-section-meta">
              {loadingChallans ? "Loading…" : `${outwardChallans.length} saved`}
              {searchTrimmed ? ` · OC # filter “${searchTrimmed}”` : ""}
            </p>
          </header>
          <OutwardChallanList
            challans={outwardChallans}
            loading={loadingChallans}
            searchQuery={searchQuery}
            onViewRecord={openOcPreview}
            canDelete={isAdmin}
            onDelete={handleDeleteOc}
          />
        </section>
      ) : null}
      {!isLedgerView && loadingOrders ? (
        <p>Loading orders…</p>
      ) : null}
      {!isLedgerView ? (
        <>
          <div className="orders-processed-summary" role="status">
            <div className="orders-processed-summary-main">
              <span className="orders-processed-label">
                {DISPATCH_TAB_LABELS[dispatchTab] ?? "Dispatch"}
              </span>
              <span className="orders-processed-count">{totalFiltered}</span>
            </div>
            <div className="orders-processed-summary-meta">
              <span className="orders-processed-qty">
                Total qty: <strong>{totalQty}</strong>
              </span>
              {failedCount > 0 ? (
                <span className="dispatch-failed-summary">
                  Failed verify: <strong>{failedCount}</strong>
                </span>
              ) : null}
              <span className="orders-processed-filters">{filterBits.join(" · ")}</span>
            </div>
          </div>
          <div className="table-wrap table-wrap--compact">
            <table className="orders-table-compact dispatch-orders-table">
              <thead>
                <tr>
                  <th />
                  <th>Order number</th>
                  <th>Customer</th>
                  <th>Product name</th>
                  <th>Status</th>
                  <th>Delivery</th>
                  <th>{dispatchTab === "regular_stock" ? "Dispatch" : "Verify"}</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const failed = isDispatchVerificationFailed(order);
                  const expanded = expandedId === order.id;
                  const draft = getDraft(order);
                  const sizesOk = allSizesVerified(draft.sizeRows, draft.sizeVerified);
                  const allOk = sizesOk && draft.productNameOk && draft.colorsOk;
                  const showIssueSelect = !allOk;
                  const rowClass = dispatchRowHighlightClass(order);
                  const isDispatched = order.status === DISPATCHED_STATUS;

                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={rowClass || undefined}
                        title={
                          failed
                            ? `Verification failed: ${dispatchIssueLabel(order.dispatch_issue_type)}`
                            : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="btn-view-order"
                            onClick={() => onViewOrder(order)}
                          >
                            View order
                          </button>
                        </td>
                        <td className="orders-compact-id">
                          {renderOrderIdBadges(order.order_id)}
                          {failed ? (
                            <span className="dispatch-failed-badge" title="Verification failed">
                              FAIL
                            </span>
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
                            {renderStageIcon?.(order.status, STAGE_LABEL[order.status])}{" "}
                            {STAGE_LABEL[order.status] ?? order.status ?? "—"}
                          </span>
                        </td>
                        <td>{deliveryMethodLabel(order.delivery_method)}</td>
                        <td>
                          {isDispatched ? (
                            <span className="dispatch-processed-at">
                              {order.dispatch_verified_at
                                ? new Date(order.dispatch_verified_at).toLocaleString()
                                : "—"}
                            </span>
                          ) : (
                            <div className="dispatch-verify-cell">
                              {failed ? (
                                <p className="dispatch-fail-reason" title="Why verification failed">
                                  {order.dispatch_issue_type
                                    ? dispatchIssueLabel(order.dispatch_issue_type)
                                    : "Verification failed"}
                                </p>
                              ) : null}
                              {canEdit ? (
                                <div className="dispatch-verify-cell-actions">
                                  {failed ? (
                                    <button
                                      type="button"
                                      className="btn-dispatch-verify-again"
                                      onClick={() => openVerifyPanel(order)}
                                    >
                                      Verify again
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={`btn-dispatch-verify${expanded ? " btn-dispatch-verify--open" : ""}`}
                                    onClick={() =>
                                      expanded ? closeVerifyPanel() : openVerifyPanel(order)
                                    }
                                  >
                                    {expanded ? "Close" : failed ? "Re-open" : "Verify"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>{order.qty}</td>
                      </tr>
                      {expanded && !isDispatched ? (
                        <tr className="dispatch-verify-row">
                          <td colSpan={8}>
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
                                <div className="dispatch-verify-actions">
                                  {allOk ? (
                                    <button
                                      type="button"
                                      className="btn-dispatch-pass"
                                      disabled={submittingId === order.id}
                                      onClick={() => saveVerification(order, true)}
                                    >
                                      {submittingId === order.id
                                        ? "Saving…"
                                        : "Verified & mark as dispatch"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-dispatch-submit"
                                      disabled={submittingId === order.id}
                                      onClick={() => saveVerification(order, false)}
                                    >
                                      {submittingId === order.id
                                        ? "Saving…"
                                        : "Submit — Dispatch Fail"}
                                    </button>
                                  )}
                                  {order.dispatch_verified_at ? (
                                    <span className="dispatch-verify-meta">
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
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {visibleOrders.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      {searchTrimmed
                        ? "No orders match your search."
                        : `No orders in ${DISPATCH_TAB_LABELS[dispatchTab] ?? "this view"} for the selected date range.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
        onCreated={(record) => {
          loadInwardEntries();
          openInwardPreview(record);
          setCreateInwardOpen(false);
        }}
      />
    </>
  );
}
