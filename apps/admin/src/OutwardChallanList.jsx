import { useMemo, useState } from "react";
import { formatOcCreatedAt, ocTransportLabel } from "./outwardChallanUtils";
import { printOutwardChallanLabel } from "./outwardChallanPrint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

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
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
    );
  }

  if (!filtered.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {searchQuery.trim() ? "No matches." : "No outward challans yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Created</TableHead>
            <TableHead>OC #</TableHead>
            <TableHead>Sender</TableHead>
            <TableHead>Product / Material</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Mode of transport</TableHead>
            <TableHead>Sent to</TableHead>
            <TableHead>Receiver name</TableHead>
            <TableHead>Sender contact</TableHead>
            <TableHead>Receiver contact</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Bora / Carton</TableHead>
            <TableHead className="min-w-[12rem]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="whitespace-nowrap">{formatOcCreatedAt(record)}</TableCell>
              <TableCell>{record.id}</TableCell>
              <TableCell>{cell(record.sender)}</TableCell>
              <TableCell>{cell(record.product_material)}</TableCell>
              <TableCell>{cell(record.purpose)}</TableCell>
              <TableCell>{ocTransportLabel(record.mode_of_transport)}</TableCell>
              <TableCell>{cell(record.sent_to)}</TableCell>
              <TableCell>{cell(record.receiver_name)}</TableCell>
              <TableCell>{cell(record.sender_contact)}</TableCell>
              <TableCell>{cell(record.receiver_contact)}</TableCell>
              <TableCell>{cell(record.quantity)}</TableCell>
              <TableCell>{cell(record.bora_carton_count)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onViewRecord?.(record)}
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => printOutwardChallanLabel(record)}
                  >
                    Print label
                  </Button>
                  {canDelete ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={deletingId === record.id}
                      onClick={() => handleDelete(record)}
                    >
                      {deletingId === record.id ? "Deleting…" : "Delete"}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
