import { useMemo, useState } from "react";
import {
  formatInwardDepartmentDisplay,
  formatInwardEntryListDate,
  formatInwardGrnListSummary,
  formatInwardPhotoUploadStatus,
  getInwardGrnEntries,
  inwardHasGrnDetails
} from "./inwardEntryUtils";

function cell(value) {
  const t = String(value ?? "").trim();
  return t || "—";
}

function matchesInwardSearch(record, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    record?.id,
    ...getInwardGrnEntries(record).map((grn) => grn.grn_no),
    record?.product_material,
    record?.department,
    record?.individual_name,
    record?.for_whom,
    record?.supplier,
    record?.invoice_no,
    record?.received_by,
    record?.location_rack
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  return haystack.includes(q);
}

export default function InwardEntryList({
  entries,
  loading,
  searchQuery,
  onViewRecord,
  onGrnEntry,
  canEdit = false,
  canDelete = false,
  onDelete
}) {
  const [deletingId, setDeletingId] = useState(null);

  const filtered = useMemo(() => {
    const list = Array.isArray(entries) ? entries : [];
    return list.filter((entry) => matchesInwardSearch(entry, searchQuery));
  }, [entries, searchQuery]);

  async function handleDelete(record) {
    if (!canDelete || !onDelete || deletingId != null) return;
    const grnSummary = formatInwardGrnListSummary(record);
    const label = inwardHasGrnDetails(record)
      ? `${grnSummary} (entry #${record.id})`
      : `entry #${record.id}`;
    if (!window.confirm(`Delete ${label} from Inward entries?\n\nThis cannot be undone.`)) {
      return;
    }
    setDeletingId(record.id);
    try {
      await onDelete(record);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <p className="outward-challan-list-loading">Loading inward entries…</p>;
  }

  if (!filtered.length) {
    return (
      <p className="outward-challan-list-empty">
        {searchQuery.trim() ? "No matches." : "No inward entries yet."}
      </p>
    );
  }

  return (
    <div className="table-wrap table-wrap--compact outward-challan-list-wrap">
      <table className="orders-table-compact outward-challans-table inward-entries-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Product / Material</th>
            <th>Department</th>
            <th>Photos</th>
            <th>GRN</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((record) => {
            const hasGrn = inwardHasGrnDetails(record);
            return (
              <tr key={record.id}>
                <td className="outward-challan-created">{formatInwardEntryListDate(record)}</td>
                <td>{cell(record.product_material)}</td>
                <td>{formatInwardDepartmentDisplay(record)}</td>
                <td>{formatInwardPhotoUploadStatus(record)}</td>
                <td>
                  {hasGrn ? (
                    <span className="inward-grn-badge inward-grn-badge--done">
                      {formatInwardGrnListSummary(record)}
                    </span>
                  ) : (
                    <span className="inward-grn-badge inward-grn-badge--pending">Pending</span>
                  )}
                </td>
                <td>
                  <div className="outward-challan-actions">
                    <button
                      type="button"
                      className="outward-challan-view-btn"
                      onClick={() => onViewRecord?.(record)}
                    >
                      View
                    </button>
                    {canEdit ? (
                      <button
                        type="button"
                        className="inward-grn-entry-btn"
                        onClick={() => onGrnEntry?.(record)}
                      >
                        GRN Entry
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        className="outward-challan-delete-btn"
                        disabled={deletingId === record.id}
                        onClick={() => handleDelete(record)}
                      >
                        {deletingId === record.id ? "Deleting…" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
