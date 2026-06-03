import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  buildAndDownloadMonthlyArchive,
  getPreviousMonthRange,
  monthInputToRange,
  periodRangeToQueryIsos,
  purgeArchivedOrdersFromCloud
} from "./monthlyArchive";

const ARCHIVE_DUE_KEY = "printing-tracker-monthly-archive-due";

export default function MonthlyArchivePanel({ orders, onPurged, inModal = false }) {
  const defaultMonth = getPreviousMonthRange();
  const [monthValue, setMonthValue] = useState(defaultMonth.month);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [archivedOrders, setArchivedOrders] = useState([]);
  const [showDueBanner, setShowDueBanner] = useState(false);

  const { start: periodStart, end: periodEnd } = useMemo(
    () => monthInputToRange(monthValue),
    [monthValue]
  );

  useEffect(() => {
    try {
      const last = window.localStorage.getItem(ARCHIVE_DUE_KEY);
      const monthMs = 30 * 24 * 60 * 60 * 1000;
      if (!last || Date.now() - Number(last) >= monthMs) setShowDueBanner(true);
    } catch {
      setShowDueBanner(true);
    }
  }, []);

  async function handleDownloadArchive() {
    if (!monthValue || !periodStart || !periodEnd) {
      alert("Select a month.");
      return;
    }
    setBusy(true);
    setProgress("Starting…");
    setLastResult(null);
    setPurgeConfirm(false);
    try {
      const result = await buildAndDownloadMonthlyArchive({
        supabase,
        periodStart,
        periodEnd,
        monthLabel: monthValue,
        onProgress: setProgress
      });

      setArchivedOrders(result.orders ?? []);
      setLastResult(result);
      try {
        window.localStorage.setItem(ARCHIVE_DUE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      setShowDueBanner(false);
      alert(
        `Monthly archive saved to Downloads.\n\n${result.orderCount} order folder(s), ${result.activityCount} history row(s).\n\nEach folder is named by Order ID and contains mockups/, approved-designs/, and order-details.xlsx (job form + history).`
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function handlePurgeFromCloud() {
    if (!purgeConfirm) {
      alert('Check "I saved the ZIP locally" before purging cloud data.');
      return;
    }
    if (!archivedOrders.length) {
      alert("Download the monthly archive first for this month.");
      return;
    }
    const typed = window.prompt(
      `Permanently delete ${archivedOrders.length} job(s) and their images from Supabase?\n\nType PURGE to confirm.`,
      ""
    );
    if (typed?.trim().toUpperCase() !== "PURGE") {
      alert("Purge cancelled.");
      return;
    }
    setBusy(true);
    setProgress("Removing files from cloud storage…");
    try {
      const stats = await purgeArchivedOrdersFromCloud(supabase, archivedOrders);
      setArchivedOrders([]);
      setLastResult(null);
      onPurged?.();
      alert(
        `Cloud purge done.\n${stats.deletedOrders} job(s) removed from database.\n${stats.deletedFiles} file(s) removed from storage.`
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const monthOrderCount = (() => {
    if (!periodStart || !periodEnd) return 0;
    const { startIso, endIso } = periodRangeToQueryIsos(periodStart, periodEnd);
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    return orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= s && t < e;
    }).length;
  })();

  return (
    <section
      className={
        inModal ? "monthly-archive-panel monthly-archive-panel--modal" : "monthly-archive-panel panel"
      }
    >
      {!inModal ? <h3>Monthly cloud archive</h3> : null}
      <div className="monthly-archive-dates">
        <label>
          Month
          <input
            type="month"
            value={monthValue}
            disabled={busy}
            onChange={(e) => setMonthValue(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="monthly-archive-preset"
          disabled={busy}
          onClick={() => {
            const m = getPreviousMonthRange();
            setMonthValue(m.month);
          }}
        >
          Previous month
        </button>
        <span className="monthly-archive-range-hint">
          {periodStart && periodEnd ? `${periodStart} → ${periodEnd}` : ""}
        </span>
      </div>
      <p className="monthly-archive-meta">{monthOrderCount} job(s) this month</p>
      {progress ? <p className="monthly-archive-progress">{progress}</p> : null}
      {lastResult ? (
        <p className="monthly-archive-result">
          Last archive: {lastResult.orderCount} order folders, {lastResult.activityCount} history
          entries.
        </p>
      ) : null}
      <div className="monthly-archive-actions">
        <button
          type="button"
          className="btn-monthly-archive-download"
          disabled={busy}
          onClick={handleDownloadArchive}
        >
          {busy ? "Working…" : "Download monthly ZIP"}
        </button>
        <label className="monthly-archive-purge-check">
          <input
            type="checkbox"
            checked={purgeConfirm}
            disabled={busy || !archivedOrders.length}
            onChange={(e) => setPurgeConfirm(e.target.checked)}
          />
          I saved the ZIP locally — purge this month from cloud
        </label>
        <button
          type="button"
          className="btn-monthly-archive-purge"
          disabled={busy || !archivedOrders.length}
          onClick={handlePurgeFromCloud}
        >
          Purge from Supabase
        </button>
      </div>
    </section>
  );
}
