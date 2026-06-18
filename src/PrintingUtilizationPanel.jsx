import { useCallback, useEffect, useState } from "react";
import InventoryIcon from "./inventory/InventoryIcon";
import CreatePrintingUtilizationModal from "./CreatePrintingUtilizationModal";
import { exportPrintingUtilizationExcel } from "./printingUtilizationExport";
import { OrdersPagination, OrdersPerPageControl, usePagination } from "./orderPagination";
import {
  fetchPrintingUtilizationEntries,
  formatPrintingMetres,
  formatPrintingUtilizationDate,
  formatPcsFused
} from "./printingUtilizationUtils";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchPrintingUtilizationEntries();
      setEntries(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const {
    visible: visibleEntries,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages
  } = usePagination(entries, "printing-utilization", `${entries.length}`);

  const totalMetres = entries.reduce((sum, row) => sum + (Number(row.printing_metres) || 0), 0);
  const totalPcs = entries.reduce((sum, row) => sum + (Number(row.pcs_fused) || 0), 0);

  async function handleExport() {
    if (!isAdmin || !entries.length) return;
    setExporting(true);
    setExportMessage("");
    try {
      const result = await exportPrintingUtilizationExcel(entries);
      setExportMessage(`Exported ${result.rowCount} entries.`);
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
                <button
                  type="button"
                  className="btn btn-export"
                  onClick={() => void handleExport()}
                  disabled={exporting || !entries.length}
                >
                  <InventoryIcon name="download" size={13} /> {exporting ? "Exporting…" : "Export"}
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" className="btn primary" onClick={() => setModalOpen(true)}>
                  <InventoryIcon name="plus" size={13} /> Make entry
                </button>
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
                <p className="kpi-value">{entries.length}</p>
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
              <div className="printing-dept-toolbar">
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
                        <td colSpan={3}>No utilization entries yet.</td>
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
