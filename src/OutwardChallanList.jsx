import { useMemo, useState } from "react";
import { formatOcCreatedAt, ocTransportLabel } from "./outwardChallanUtils";
import { printOutwardChallanLabel } from "./outwardChallanPrint";

function cell(value) {
  const t = String(value ?? "").trim();
  return t || "—";
}

function matchesOcNumberSearch(record, query) {
  const q = query.trim();
  if (!q) return true;
  const idStr = String(record.id ?? "");
  let num = q;
  if (/^oc\s*#?\s*/i.test(q)) {
    num = q.replace(/^oc\s*#?\s*/i, "").trim();
  }
  const digitsOnly = num.replace(/\D/g, "");
  const compare = digitsOnly || num;
  if (!compare) return true;
  return idStr === compare || idStr.startsWith(compare) || compare.startsWith(idStr);
}

export default function OutwardChallanList({
  challans,
  loading,
  searchQuery,
  onViewRecord,
  canDelete = false,
  onDelete
}) {
  const [deletingId, setDeletingId] = useState(null);

  const filtered = useMemo(() => {
    const list = Array.isArray(challans) ? challans : [];
    return list.filter((c) => matchesOcNumberSearch(c, searchQuery));
  }, [challans, searchQuery]);

  async function handleDelete(record) {
    if (!canDelete || !onDelete || deletingId != null) return;
    const ocLabel = `OC #${record.id}`;
    if (
      !window.confirm(
        `Delete ${ocLabel} from Outward challans?\n\nThis cannot be undone.`
      )
    ) {
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
    return <p className="outward-challan-list-loading">Loading outward challans…</p>;
  }

  if (!filtered.length) {
    return (
      <p className="outward-challan-list-empty">
        {searchQuery.trim() ? "No matches." : "No outward challans yet."}
      </p>
    );
  }

  return (
    <div className="table-wrap table-wrap--compact outward-challan-list-wrap">
      <table className="orders-table-compact outward-challans-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>OC #</th>
            <th>Sender</th>
            <th>Product / Material</th>
            <th>Purpose</th>
            <th>Mode of transport</th>
            <th>Sent to</th>
            <th>Receiver name</th>
            <th>Sender contact</th>
            <th>Receiver contact</th>
            <th>Quantity</th>
            <th>Bora / Carton</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((record) => (
            <tr key={record.id}>
              <td className="outward-challan-created">{formatOcCreatedAt(record)}</td>
              <td>{record.id}</td>
              <td>{cell(record.sender)}</td>
              <td>{cell(record.product_material)}</td>
              <td>{cell(record.purpose)}</td>
              <td>{ocTransportLabel(record.mode_of_transport)}</td>
              <td>{cell(record.sent_to)}</td>
              <td>{cell(record.receiver_name)}</td>
              <td>{cell(record.sender_contact)}</td>
              <td>{cell(record.receiver_contact)}</td>
              <td>{cell(record.quantity)}</td>
              <td>{cell(record.bora_carton_count)}</td>
              <td>
                <div className="outward-challan-actions">
                  <button
                    type="button"
                    className="outward-challan-view-btn"
                    onClick={() => onViewRecord?.(record)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="outward-challan-print-btn"
                    onClick={() => printOutwardChallanLabel(record)}
                  >
                    Print label
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
