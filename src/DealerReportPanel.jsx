import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { supabase } from "./supabaseClient";
import { exportDealerReportExcel, fetchEntriesForPeriodRange } from "./dealerReportExport";
import {
  buildDealerPeriodProgress,
  DEALER_PROGRESS_VIEWS,
  formatQuarterLabel,
  formatYearLabel,
  progressPeriodLabel,
  progressRangeForView,
  progressViewMeta,
  quarterFromISODate,
  yearFromISODate
} from "./dealerReportPeriodUtils";
import {
  buildDealerDailyTotalRows,
  buildDealerPayload,
  buildDealerRangeTotalRows,
  buildReportDealerColumns,
  computeDealerColumnTotals,
  currentWeekRange,
  DEALER_REPORT_SELECT,
  DEALERS_SELECT,
  dealerRecordToForm,
  emptyDealerForm,
  formatDateRangeLabel,
  formatDealerAmountInput,
  formatDealerNumber,
  formatMonthLabel,
  formatReportDateHeading,
  getAmountFromRecord,
  monthKeyFromDate,
  normalizeAllDealerRows,
  normalizeDateRange,
  parseDealerAmount,
  slugifyDealerKey,
  sumDealerFormValues,
  targetFormFromDealers,
  todayLocalISODate,
  weekRangeFromDate
} from "./dealerReportUtils";

export default function DealerReportPanel({ canEdit = false, isAdmin = false, sessionUserId }) {
  const [allDealers, setAllDealers] = useState([]);
  const [form, setForm] = useState(() => emptyDealerForm([]));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [entries, setEntries] = useState([]);
  const [weekFromDate, setWeekFromDate] = useState(() => currentWeekRange().startISO);
  const [weekToDate, setWeekToDate] = useState(() => currentWeekRange().endISO);
  const [showAddDealer, setShowAddDealer] = useState(false);
  const [newDealerName, setNewDealerName] = useState("");
  const [addingDealer, setAddingDealer] = useState(false);
  const [removingDealerKey, setRemovingDealerKey] = useState("");
  const [exporting, setExporting] = useState(false);
  const [showSetTarget, setShowSetTarget] = useState(false);
  const [targetForm, setTargetForm] = useState({});
  const [savingTargets, setSavingTargets] = useState(false);
  const [progressView, setProgressView] = useState("weekly");
  const [filterYear, setFilterYear] = useState(() => yearFromISODate(todayLocalISODate()));
  const [filterQuarter, setFilterQuarter] = useState(() => quarterFromISODate(todayLocalISODate()));
  const [progressEntries, setProgressEntries] = useState([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [chartIsDark, setChartIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("theme-dark")
  );

  useEffect(() => {
    const syncChartTheme = () => {
      setChartIsDark(document.documentElement.classList.contains("theme-dark"));
    };
    syncChartTheme();
    const observer = new MutationObserver(syncChartTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const dateRange = useMemo(
    () => normalizeDateRange(weekFromDate, weekToDate),
    [weekFromDate, weekToDate]
  );
  const rangeLabel = useMemo(
    () => formatDateRangeLabel(dateRange.from, dateRange.to),
    [dateRange.from, dateRange.to]
  );

  const dealers = useMemo(() => allDealers.filter((d) => d.isActive), [allDealers]);
  const reportDealers = useMemo(
    () => buildReportDealerColumns(allDealers, entries),
    [allDealers, entries]
  );

  const formTotal = useMemo(() => sumDealerFormValues(form.values, dealers), [form.values, dealers]);

  const columnTotals = useMemo(
    () => computeDealerColumnTotals(entries, reportDealers),
    [entries, reportDealers]
  );

  const dailyChartRows = useMemo(() => buildDealerDailyTotalRows(entries), [entries]);
  const dealerTotalRows = useMemo(
    () => buildDealerRangeTotalRows(entries, reportDealers).filter((row) => row.total > 0),
    [entries, reportDealers]
  );

  const progressRange = useMemo(
    () => progressRangeForView(progressView, { filterYear, filterQuarter, weekFrom: weekFromDate, weekTo: weekToDate }),
    [progressView, filterYear, filterQuarter, weekFromDate, weekToDate]
  );
  const progressLabel = useMemo(
    () => progressPeriodLabel(progressView, { filterYear, filterQuarter, weekFrom: weekFromDate, weekTo: weekToDate }),
    [progressView, filterYear, filterQuarter, weekFromDate, weekToDate]
  );
  const progressMeta = useMemo(() => progressViewMeta(progressView), [progressView]);
  const targetProgress = useMemo(
    () => buildDealerPeriodProgress(dealers, progressEntries, progressView),
    [dealers, progressEntries, progressView]
  );
  const hasAnyTarget = useMemo(
    () => dealers.some((d) => (Number(d.salesTarget) || 0) > 0),
    [dealers]
  );

  const fetchDealers = useCallback(async () => {
    const { data, error } = await supabase
      .from("dealers")
      .select(DEALERS_SELECT)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error(error.message);
      return [];
    }
    return normalizeAllDealerRows(data);
  }, []);

  const fetchEntriesForRange = useCallback(async (fromDate, toDate) => {
    const { from, to } = normalizeDateRange(fromDate, toDate);
    setLoading(true);
    setLoadError("");
    const { data, error } = await supabase
      .from("dealer_daily_reports")
      .select(DEALER_REPORT_SELECT)
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date", { ascending: true });
    setLoading(false);
    if (error) {
      setLoadError(error.message);
      setEntries([]);
      return;
    }
    setEntries(data ?? []);
  }, []);

  const fetchProgressEntries = useCallback(async (fromDate, toDate) => {
    const { from, to } = normalizeDateRange(fromDate, toDate);
    if (!from || !to) {
      setProgressEntries([]);
      return;
    }
    setLoadingTargets(true);
    try {
      const data = await fetchEntriesForPeriodRange(supabase, from, to);
      setProgressEntries(data);
    } catch (err) {
      console.error(err?.message ?? err);
      setProgressEntries([]);
    } finally {
      setLoadingTargets(false);
    }
  }, []);

  const loadFormForDate = useCallback(
    async (reportDate, dealerList) => {
      const list = dealerList?.length ? dealerList : dealers;
      if (!list.length) return;
      const { data, error } = await supabase
        .from("dealer_daily_reports")
        .select(DEALER_REPORT_SELECT)
        .eq("report_date", reportDate)
        .maybeSingle();
      if (error) {
        console.error(error.message);
        setForm(emptyDealerForm(list, reportDate));
        return;
      }
      setForm(data ? dealerRecordToForm(data, list) : emptyDealerForm(list, reportDate));
    },
    [dealers]
  );

  useEffect(() => {
    void (async () => {
      const list = await fetchDealers();
      setAllDealers(list);
      const active = list.filter((d) => d.isActive);
      if (active.length) {
        setForm((prev) => emptyDealerForm(active, prev.report_date || todayLocalISODate()));
      }
    })();
  }, [fetchDealers]);

  useEffect(() => {
    void fetchEntriesForRange(dateRange.from, dateRange.to);
  }, [dateRange.from, dateRange.to, fetchEntriesForRange]);

  useEffect(() => {
    void fetchProgressEntries(progressRange.from, progressRange.to);
  }, [progressRange.from, progressRange.to, fetchProgressEntries]);

  useEffect(() => {
    if (showSetTarget) {
      setTargetForm(targetFormFromDealers(dealers));
    }
  }, [showSetTarget, dealers]);

  useEffect(() => {
    if (!dealers.length) return;
    void loadFormForDate(form.report_date, dealers);
  }, [form.report_date, dealers, loadFormForDate]);

  function setDealerValue(key, raw) {
    const cleaned = String(raw ?? "").replace(/\D/g, "");
    setForm((prev) => ({
      ...prev,
      values: { ...prev.values, [key]: cleaned }
    }));
  }

  function onReportDateChange(isoDate) {
    const mk = monthKeyFromDate(isoDate);
    setForm((prev) => ({
      ...prev,
      report_date: isoDate,
      month_key: mk
    }));
    if (isoDate < dateRange.from || isoDate > dateRange.to) {
      const { startISO, endISO } = weekRangeFromDate(isoDate);
      setWeekFromDate(startISO);
      setWeekToDate(endISO);
    }
  }

  function onWeekFromChange(isoDate) {
    const next = isoDate || currentWeekRange().startISO;
    setWeekFromDate(next);
    if (next > weekToDate) setWeekToDate(next);
  }

  function onWeekToChange(isoDate) {
    const next = isoDate || weekFromDate;
    setWeekToDate(next);
    if (next < weekFromDate) setWeekFromDate(next);
  }

  function loadHistoryDate(isoDate) {
    onReportDateChange(isoDate);
    document.getElementById("dealer-daily-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleRemoveDealer(dealer) {
    if (!isAdmin || !dealer?.id) return;
    const ok = window.confirm(
      `Remove "${dealer.label}" from daily entry?\n\nPast report data for this dealer will stay in history and exports.`
    );
    if (!ok) return;
    setRemovingDealerKey(dealer.key);
    const { error } = await supabase.from("dealers").update({ is_active: false }).eq("id", dealer.id);
    setRemovingDealerKey("");
    if (error) {
      alert(error.message);
      return;
    }
    const list = await fetchDealers();
    setAllDealers(list);
    const active = list.filter((d) => d.isActive);
    setForm((prev) => {
      const nextValues = { ...prev.values };
      delete nextValues[dealer.key];
      return { ...prev, values: Object.fromEntries(active.map(({ key }) => [key, nextValues[key] ?? ""])) };
    });
  }

  async function handleExportExcel() {
    if (!entries.length || !reportDealers.length) return;
    setExporting(true);
    try {
      const quarterRange = progressRangeForView("quarterly", {
        filterYear,
        filterQuarter,
        weekFrom: weekFromDate,
        weekTo: weekToDate
      });
      const annualRange = progressRangeForView("annual", {
        filterYear,
        filterQuarter,
        weekFrom: weekFromDate,
        weekTo: weekToDate
      });
      const [quarterEntries, annualEntries] = await Promise.all([
        fetchEntriesForPeriodRange(supabase, quarterRange.from, quarterRange.to),
        fetchEntriesForPeriodRange(supabase, annualRange.from, annualRange.to)
      ]);
      const result = await exportDealerReportExcel({
        dealers,
        reportDealers,
        filterYear,
        filterQuarter,
        weekFrom: weekFromDate,
        weekTo: weekToDate,
        weekEntries: entries,
        quarterEntries,
        annualEntries
      });
      alert(`Exported ${result.rowCount} daily row(s). Weekly achieved total: ${result.total}`);
    } catch (err) {
      alert(err?.message ?? "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  function openSetTargetPanel() {
    setShowAddDealer(false);
    setNewDealerName("");
    setTargetForm(targetFormFromDealers(dealers));
    setShowSetTarget(true);
  }

  async function handleSaveTargets() {
    if (!isAdmin || !dealers.length) return;
    setSavingTargets(true);
    let hadError = false;
    for (const dealer of dealers) {
      const { error } = await supabase
        .from("dealers")
        .update({ sales_target: parseDealerAmount(targetForm[dealer.key]) })
        .eq("id", dealer.id);
      if (error) {
        hadError = true;
        alert(
          error.message.includes("sales_target")
            ? `${error.message}\n\nRun migration 20260622120000_add_dealer_sales_target.sql on this Supabase project.`
            : error.message
        );
        break;
      }
    }
    setSavingTargets(false);
    if (hadError) return;
    const list = await fetchDealers();
    setAllDealers(list);
    setShowSetTarget(false);
    alert("Dealer targets saved.");
  }

  async function handleAddDealer() {
    if (!isAdmin) return;
    const name = newDealerName.trim();
    if (!name) {
      alert("Enter a dealer name.");
      return;
    }
    setAddingDealer(true);
    const dealer_key = slugifyDealerKey(name);
    const sort_order = dealers.length + 1;
    const { data, error } = await supabase
      .from("dealers")
      .insert({ name, dealer_key, sort_order })
      .select(DEALERS_SELECT)
      .single();
    setAddingDealer(false);
    if (error) {
      alert(
        error.message.includes("dealers")
          ? `${error.message}\n\nRun migration 20260615120000_add_dealers_directory.sql on this Supabase project.`
          : error.message
      );
      return;
    }
    const list = await fetchDealers();
    setAllDealers(list);
    const active = list.filter((d) => d.isActive);
    if (data) {
      setForm((prev) => ({
        ...prev,
        values: { ...prev.values, [data.dealer_key]: "" }
      }));
    }
    setNewDealerName("");
    setShowAddDealer(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!canEdit || !dealers.length) return;
    if (!form.report_date) {
      alert("Please choose a date.");
      return;
    }
    setSaving(true);
    const { data: existing } = await supabase
      .from("dealer_daily_reports")
      .select("dealer_amounts")
      .eq("report_date", form.report_date)
      .maybeSingle();
    const payload = buildDealerPayload(form, dealers, sessionUserId, existing?.dealer_amounts);
    const { error } = await supabase
      .from("dealer_daily_reports")
      .upsert(payload, { onConflict: "report_date" });
    setSaving(false);
    if (error) {
      alert(
        error.message.includes("dealer_daily_reports") || error.message.includes("dealer_amounts")
          ? `${error.message}\n\nRun latest dealer migrations on this Supabase project.`
          : error.message
      );
      return;
    }
    await fetchEntriesForRange(dateRange.from, dateRange.to);
    await fetchProgressEntries(progressRange.from, progressRange.to);
    alert("Dealer report saved.");
  }

  const dealerChartHeight = Math.max(240, dealerTotalRows.length * 36 + 48);
  const chartTick = { fontSize: 11, fill: chartIsDark ? "#8b949e" : "#64748b" };
  const chartGrid = chartIsDark ? "#30363d" : "#e2e8f0";

  return (
    <div className="dealer-report-panel">
      <div className="dealer-report-layout">
        <section className="dealer-report-form-card" id="dealer-daily-entry">
          <header className="dealer-report-form-head">
            <div className="dealer-report-form-head-row">
              <div>
                <h3>Daily entry</h3>
                <p className="dealer-report-form-lead">
                  Enter dealer quantities for one day. Saving again on the same date updates that row.
                </p>
              </div>
              {isAdmin ? (
                <div className="dealer-report-form-head-actions">
                  {showSetTarget ? (
                    <div className="dealer-set-target-panel">
                      <p className="dealer-set-target-lead">
                        Set annual sales target for each active dealer ({formatYearLabel(filterYear)}).
                      </p>
                      <div className="dealer-set-target-grid">
                        {dealers.map((dealer) => (
                          <label key={dealer.key} className="dealer-set-target-row">
                            <span className="dealer-set-target-name">{dealer.label}</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="0"
                              value={formatDealerAmountInput(targetForm[dealer.key])}
                              onChange={(e) => {
                                const cleaned = String(e.target.value).replace(/\D/g, "");
                                setTargetForm((prev) => ({ ...prev, [dealer.key]: cleaned }));
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="dealer-set-target-actions">
                        <button type="button" disabled={savingTargets} onClick={() => void handleSaveTargets()}>
                          {savingTargets ? "Saving…" : "Save targets"}
                        </button>
                        <button
                          type="button"
                          className="dealer-add-cancel"
                          onClick={() => setShowSetTarget(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : showAddDealer ? (
                    <div className="dealer-add-inline">
                      <input
                        type="text"
                        className="dealer-add-input"
                        placeholder="New dealer name"
                        value={newDealerName}
                        onChange={(e) => setNewDealerName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleAddDealer();
                          }
                        }}
                      />
                      <button type="button" disabled={addingDealer} onClick={() => void handleAddDealer()}>
                        {addingDealer ? "Adding…" : "Save dealer"}
                      </button>
                      <button
                        type="button"
                        className="dealer-add-cancel"
                        onClick={() => {
                          setShowAddDealer(false);
                          setNewDealerName("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="dealer-admin-head-btns">
                      <button type="button" className="btn-set-target" onClick={openSetTargetPanel}>
                        Set Target
                      </button>
                      <button
                        type="button"
                        className="btn-add-dealer"
                        onClick={() => {
                          setShowSetTarget(false);
                          setShowAddDealer(true);
                        }}
                      >
                        + Add dealer
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </header>
          {!canEdit ? (
            <p className="dealer-report-readonly-note">
              You can view reports. An admin must grant edit access on the Distributor tab to enter data.
            </p>
          ) : null}
          <form className="dealer-report-form" onSubmit={(e) => void handleSave(e)}>
            <div className="dealer-report-form-meta">
              <div className="dealer-report-form-cell">
                <label htmlFor="dealer-month-display">Month</label>
                <input
                  id="dealer-month-display"
                  type="text"
                  readOnly
                  className="order-form-readonly-input"
                  value={formatMonthLabel(form.month_key)}
                />
              </div>
              <div className="dealer-report-form-cell">
                <label htmlFor="dealer-report-date">Date</label>
                <input
                  id="dealer-report-date"
                  type="date"
                  value={form.report_date}
                  max={todayLocalISODate()}
                  disabled={!canEdit}
                  onChange={(e) => onReportDateChange(e.target.value)}
                  required
                />
                <p className="dealer-report-date-hint">{formatReportDateHeading(form.report_date)}</p>
              </div>
              <div className="dealer-report-form-cell dealer-report-total-cell">
                <label htmlFor="dealer-total">Day total</label>
                <input
                  id="dealer-total"
                  type="text"
                  readOnly
                  className="order-form-readonly-input dealer-report-total-input"
                  value={formatDealerNumber(formTotal)}
                />
              </div>
            </div>
            <div className="dealer-report-dealer-grid">
              {dealers.map((dealer) => (
                <div key={dealer.key} className="dealer-report-form-cell dealer-report-dealer-cell">
                  <div className="dealer-report-dealer-label-row">
                    <label htmlFor={`dealer-${dealer.key}`}>{dealer.label}</label>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="dealer-remove-btn"
                        title={`Remove ${dealer.label}`}
                        disabled={removingDealerKey === dealer.key}
                        onClick={() => void handleRemoveDealer(dealer)}
                      >
                        {removingDealerKey === dealer.key ? "…" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                  <input
                    id={`dealer-${dealer.key}`}
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    disabled={!canEdit}
                    value={formatDealerAmountInput(form.values[dealer.key])}
                    onChange={(e) => setDealerValue(dealer.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            {canEdit ? (
              <div className="dealer-report-form-actions">
                <button type="submit" disabled={saving || !dealers.length}>
                  {saving ? "Saving…" : "Save daily report"}
                </button>
              </div>
            ) : null}
          </form>

          {(hasAnyTarget || loadingTargets) && dealers.length > 0 ? (
            <div className="dealer-target-progress">
              <div className="dealer-target-progress-head">
                <h4>{progressMeta.title}</h4>
                <p>{progressLabel}</p>
                <p className="dealer-target-progress-hint">
                  Targets set annually · monitored quarterly · daily data entry · weekly dealer progress
                </p>
              </div>
              <div className="dealer-progress-filters">
                <div className="coordinator-report-group">
                  <span className="coordinator-report-label">Progress view</span>
                  <div className="coordinator-report-segment" role="group" aria-label="Progress view">
                    {DEALER_PROGRESS_VIEWS.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className={progressView === id ? "is-active" : ""}
                        onClick={() => setProgressView(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="coordinator-report-field dealer-progress-year">
                  <span className="coordinator-report-label">Year</span>
                  <input
                    type="number"
                    min={2020}
                    max={2100}
                    value={filterYear}
                    onChange={(e) => setFilterYear(Number(e.target.value) || yearFromISODate(todayLocalISODate()))}
                  />
                </label>
                {progressView === "quarterly" ? (
                  <div className="coordinator-report-group">
                    <span className="coordinator-report-label">Quarter</span>
                    <div className="coordinator-report-segment" role="group" aria-label="Quarter">
                      {[1, 2, 3, 4].map((q) => (
                        <button
                          key={q}
                          type="button"
                          className={filterQuarter === q ? "is-active" : ""}
                          onClick={() => setFilterQuarter(q)}
                        >
                          Q{q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              {loadingTargets ? (
                <p className="dealer-target-progress-empty">Loading target progress…</p>
              ) : (
                <div className="coordinator-report-table-wrap dealer-report-table-wrap">
                  <table className="coordinator-report-table coordinator-report-table--rich dealer-target-table">
                    <thead>
                      <tr>
                        <th>Dealer</th>
                        <th>Annual target</th>
                        <th>{progressMeta.targetColumn}</th>
                        <th>Achieved</th>
                        <th>Progress</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targetProgress.rows.map((row) => (
                        <tr key={row.key} className={row.met ? "dealer-target-met" : ""}>
                          <td>{row.label}</td>
                          <td>{formatDealerNumber(row.annualTarget)}</td>
                          <td>{formatDealerNumber(row.periodTarget)}</td>
                          <td>{formatDealerNumber(row.achieved)}</td>
                          <td>
                            {row.periodTarget > 0 ? (
                              <span className={`dealer-target-pct${row.met ? " is-met" : ""}`}>
                                {row.percent}%
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{row.periodTarget > 0 ? formatDealerNumber(row.remaining) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="dealer-report-footer-row">
                        <td>
                          <strong>Total</strong>
                        </td>
                        <td>
                          <strong>{formatDealerNumber(targetProgress.totals.annualTarget)}</strong>
                        </td>
                        <td>
                          <strong>{formatDealerNumber(targetProgress.totals.periodTarget)}</strong>
                        </td>
                        <td>
                          <strong>{formatDealerNumber(targetProgress.totals.achieved)}</strong>
                        </td>
                        <td>
                          <strong>
                            {targetProgress.totals.percent != null ? `${targetProgress.totals.percent}%` : "—"}
                          </strong>
                        </td>
                        <td>
                          <strong>{formatDealerNumber(targetProgress.totals.remaining)}</strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="dealer-report-chart-card coordinator-report">
          <div className="dealer-report-toolbar coordinator-report-toolbar">
            <div className="dealer-report-toolbar-left">
              <div className="coordinator-report-group">
                <span className="coordinator-report-label">Daily data (weekly range)</span>
                <div className="coordinator-report-range-fields">
                  <label className="coordinator-report-field">
                    <span className="dealer-report-range-sublabel">From</span>
                    <input
                      type="date"
                      value={weekFromDate}
                      max={weekToDate}
                      onChange={(e) => onWeekFromChange(e.target.value)}
                    />
                  </label>
                  <label className="coordinator-report-field">
                    <span className="dealer-report-range-sublabel">To</span>
                    <input
                      type="date"
                      value={weekToDate}
                      min={weekFromDate}
                      max={todayLocalISODate()}
                      onChange={(e) => onWeekToChange(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              <button
                type="button"
                className="btn-admin-secondary dealer-export-btn"
                disabled={exporting || loading || entries.length === 0}
                onClick={() => void handleExportExcel()}
              >
                {exporting ? "Exporting…" : "Export Excel"}
              </button>
            </div>
            <div
              className="dealer-report-month-stat"
              aria-label={`Total distributor sales value for ${rangeLabel}`}
            >
              <p className="dealer-report-month-stat__label">Total Distributor Sales Value</p>
              <p className="dealer-report-month-stat__value home-stat-card__count">
                {formatDealerNumber(columnTotals.total)}
              </p>
            </div>
          </div>
          <p className="coordinator-report-summary">
            <strong>{entries.length}</strong> daily row{entries.length === 1 ? "" : "s"} from{" "}
            <strong>{rangeLabel}</strong> — charts and history below. Progress uses{" "}
            <strong>{progressView}</strong> view ({progressLabel}).
          </p>
          {loadError ? (
            <p className="dealer-report-error" role="alert">
              {loadError}
            </p>
          ) : null}
          <div className="dealer-report-charts">
            <div className="dealer-report-chart-block">
              <h4 className="dealer-report-chart-title">Daily totals</h4>
              <p className="dealer-report-chart-caption">Total amount reported on each day</p>
              <div className="coordinator-report-chart-wrap dealer-report-chart-wrap">
                {loading ? (
                  <p className="coordinator-report-empty">Loading report…</p>
                ) : dailyChartRows.length === 0 ? (
                  <p className="coordinator-report-empty">
                    No entries for this date range yet. Save a daily report above.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={dailyChartRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                      <XAxis dataKey="label" tick={chartTick} />
                      <YAxis
                        tick={chartTick}
                        width={72}
                        tickFormatter={(v) => formatDealerNumber(v)}
                      />
                      <Tooltip
                        formatter={(value) => [formatDealerNumber(value), "Day total"]}
                        labelFormatter={(label) => `Date ${label}`}
                      />
                      <Bar dataKey="total" name="Day total" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="dealer-report-chart-block">
              <h4 className="dealer-report-chart-title">By dealer</h4>
              <p className="dealer-report-chart-caption">Combined total per dealer for {rangeLabel}</p>
              <div className="coordinator-report-chart-wrap dealer-report-chart-wrap">
                {loading ? (
                  <p className="coordinator-report-empty">Loading report…</p>
                ) : dealerTotalRows.length === 0 ? (
                  <p className="coordinator-report-empty">No dealer amounts in this range yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={dealerChartHeight}>
                    <BarChart
                      layout="vertical"
                      data={dealerTotalRows}
                      margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} horizontal={false} />
                      <XAxis
                        type="number"
                        tick={chartTick}
                        tickFormatter={(v) => formatDealerNumber(v)}
                      />
                      <YAxis
                        type="category"
                        dataKey="dealerName"
                        tick={chartTick}
                        width={132}
                      />
                      <Tooltip
                        formatter={(value) => [formatDealerNumber(value), "Dealer total"]}
                        labelFormatter={(label) => label}
                      />
                      <Bar dataKey="total" name="Dealer total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {entries.length > 0 && reportDealers.length > 0 ? (
            <div className="dealer-report-history">
              <div className="dealer-report-history-head">
                <div>
                  <h4 className="dealer-report-history-title">Report history</h4>
                  <p className="dealer-report-history-caption">
                    {entries.length} saved report{entries.length === 1 ? "" : "s"} for {rangeLabel}. Click a row
                    to open that day in daily entry.
                  </p>
                </div>
              </div>
              <div className="coordinator-report-table-wrap dealer-report-table-wrap">
                <table className="coordinator-report-table coordinator-report-table--rich dealer-report-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {reportDealers.map((dealer) => (
                        <th key={dealer.key} className={dealer.isActive ? "" : "dealer-col-inactive"}>
                          {dealer.label}
                          {!dealer.isActive ? " (removed)" : ""}
                        </th>
                      ))}
                      <th className="dealer-report-total-col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...entries].reverse().map((row) => (
                      <tr
                        key={row.id ?? row.report_date}
                        className={`dealer-history-row${form.report_date === row.report_date ? " is-selected" : ""}`}
                        tabIndex={0}
                        onClick={() => loadHistoryDate(row.report_date)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            loadHistoryDate(row.report_date);
                          }
                        }}
                      >
                        <td>{formatReportDateHeading(row.report_date)}</td>
                        {reportDealers.map(({ key }) => (
                          <td key={key}>{formatDealerNumber(getAmountFromRecord(row, key))}</td>
                        ))}
                        <td className="dealer-report-total-col">
                          <strong>{formatDealerNumber(row.total)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="dealer-report-footer-row">
                      <td>
                        <strong>Total</strong>
                      </td>
                      {reportDealers.map(({ key }) => (
                        <td key={key}>
                          <strong>{formatDealerNumber(columnTotals.byKey[key])}</strong>
                        </td>
                      ))}
                      <td className="dealer-report-total-col">
                        <strong>{formatDealerNumber(columnTotals.total)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="dealer-report-history dealer-report-history--empty">
              <h4 className="dealer-report-history-title">Report history</h4>
              <p className="coordinator-report-empty">
                {loading ? "Loading reports…" : "No saved reports for this date range yet."}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
