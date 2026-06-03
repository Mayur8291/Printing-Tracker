import { useMemo, useState } from "react";
import { formatInwardEntryCreatedAt } from "./inwardEntryUtils";

function cell(value) {
  const t = String(value ?? "").trim();
  return t || "—";
}

function matchesInwardSearch(record, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    record?.id,
    record?.grn_no,
    record?.for_whom,
    record?.supplier,
    record?.invoice_no,
    record?.product_material,
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
    const label = `GRN ${cell(record.grn_no)} (entry #${record.id})`;
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
      <table className="orders-table-compact outward-challans-table">
        <thead>
          <tr>
            <th>Date & time</th>
            <th>GRN NO.</th>
            <th>For whom</th>
            <th>Supplier</th>
            <th>Invoice No.</th>
            <th>Product / Material</th>
            <th>Qty received</th>
            <th>Bora / Carton</th>
            <th>Location / Rack</th>
            <th>Received by</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((record) => (
            <tr key={record.id}>
              <td className="outward-challan-created">{formatInwardEntryCreatedAt(record)}</td>
              <td>{cell(record.grn_no)}</td>
              <td>{cell(record.for_whom)}</td>
              <td>{cell(record.supplier)}</td>
              <td>{cell(record.invoice_no)}</td>
              <td>{cell(record.product_material)}</td>
              <td>{cell(record.qty_received)}</td>
              <td>{cell(record.bora_carton_unit)}</td>
              <td>{cell(record.location_rack)}</td>
              <td>{cell(record.received_by)}</td>
              <td>
                <div className="outward-challan-actions">
                  <button
                    type="button"
                    className="outward-challan-view-btn"
                    onClick={() => onViewRecord?.(record)}
                  >
                    View
                  </button>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
