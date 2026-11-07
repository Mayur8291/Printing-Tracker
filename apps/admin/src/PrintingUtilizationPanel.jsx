import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import CreatePrintingUtilizationModal from "./CreatePrintingUtilizationModal";
import { exportPrintingUtilizationExcel } from "./printingUtilizationExport";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";
import {
  fetchPrintingUtilizationEntries,
  filterPrintingUtilizationByDate,
  formatPrintingMetres,
  formatPrintingUtilizationDate,
  formatPcsFused
} from "./printingUtilizationUtils";
import { subscribePostgresChanges } from "./realtimeUtils";
import "./inventory/inventory.css";

export default function PrintingUtilizationPanel({
  sessionUserId,
  canEdit = false,
  isAdmin = false
}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const rows = await fetchPrintingUtilizationEntries();
      setEntries(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribePostgresChanges({
      channelName: "printing-utilization-live",
      tables: ["printing_utilization_entries"],
      onEvent: () => {
        void load({ silent: true });
      }
    });
  }, [load]);

  const filteredEntries = useMemo(
    () => filterPrintingUtilizationByDate(entries, dateFrom, dateTo),
    [entries, dateFrom, dateTo]
  );
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const {
    visible: visibleEntries,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(filteredEntries, "printing-utilization", `${dateFrom}|${dateTo}|${filteredEntries.length}`);

  const totalMetres = filteredEntries.reduce((sum, row) => sum + (Number(row.printing_metres) || 0), 0);
  const totalPcs = filteredEntries.reduce((sum, row) => sum + (Number(row.pcs_fused) || 0), 0);

  async function handleExport() {
    if (!isAdmin || !filteredEntries.length) return;
    setExporting(true);
    setExportMessage("");
    try {
      const result = await exportPrintingUtilizationExcel(filteredEntries, { dateFrom, dateTo });
      setExportMessage(
        hasDateFilter
          ? `Exported ${result.rowCount} entries in the selected dates.`
          : `Exported ${result.rowCount} entries.`
      );
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="inventory-dashboard printing-dept-utilization">
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Printing Utilization</h1>
            <p className="page-subtitle">Daily metres printed and pcs fused — saved entries cannot be edited.</p>
          </div>
          {canEdit || isAdmin ? (
            <div className="page-actions printing-dept-page-actions">
              {isAdmin ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleExport()}
                  disabled={exporting || !filteredEntries.length}
                >
                  <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export"}
                </Button>
              ) : null}
              {canEdit ? (
                <Button type="button" onClick={() => setModalOpen(true)}>
                  <Plus className="size-3.5" /> Make entry
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="printing-dept-inv-error" role="alert">
            {error}
          </p>
        ) : null}

        {exportMessage ? <p className="printing-util-export-msg">{exportMessage}</p> : null}

        {loading ? <p className="printing-dept-inv-loading">Loading utilization entries…</p> : null}

        {!loading ? (
          <>
            <div className="kpi-grid printing-util-kpi-grid">
              <div className="kpi">
                <p className="kpi-label">Entries</p>
                <p className="kpi-value">{filteredEntries.length}</p>
              </div>
              <div className="kpi">
                <p className="kpi-label">Total metres</p>
                <p className="kpi-value">{formatPrintingMetres(totalMetres)}</p>
              </div>
              <div className="kpi">
                <p className="kpi-label">Total pcs fused</p>
                <p className="kpi-value">{formatPcsFused(totalPcs)}</p>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">
                <h3 className="card-title">Utilization log</h3>
                <p className="card-subtitle">Date, metres printed, and pcs fused per entry</p>
              </div>
              <div className="printing-dept-toolbar flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="printing-util-from">From</Label>
                  <DatePicker
                    id="printing-util-from"
                    value={dateFrom}
                    onChange={setDateFrom}
                    placeholder="From date"
                    className="min-w-[10.5rem]"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="printing-util-to">To</Label>
                  <DatePicker
                    id="printing-util-to"
                    value={dateTo}
                    onChange={setDateTo}
                    placeholder="To date"
                    className="min-w-[10.5rem]"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  disabled={!hasDateFilter}
                >
                  Clear
                </Button>
                <OrdersPerPageControl
                  idPrefix="printing-util-per-page"
                  pageSize={pageSize}
                  onPageSizeChange={setPageSize}
                />
              </div>
              <div className="table-wrap">
                <table className="t printing-util-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="right">Number of metre printed</th>
                      <th className="right">Number of pcs fused</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((row) => (
                      <tr key={row.id}>
                        <td>{formatPrintingUtilizationDate(row.created_at)}</td>
                        <td className="right mono">{formatPrintingMetres(row.printing_metres)}</td>
                        <td className="right mono">{formatPcsFused(row.pcs_fused)}</td>
                      </tr>
                    ))}
                    {!total ? (
                      <tr>
                        <td colSpan={3}>
                          {hasDateFilter
                            ? "No utilization entries in this date range."
                            : "No utilization entries yet."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <OrdersPagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                total={total}
                pageSize={pageSize}
              />
            </div>
          </>
        ) : null}
      </div>

      <CreatePrintingUtilizationModal
        open={modalOpen}
        sessionUserId={sessionUserId}
        onClose={() => setModalOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}
