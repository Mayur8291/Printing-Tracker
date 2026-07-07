import { useMemo, useState } from "react";
import {
  formatInwardDepartmentDisplay,
  formatInwardEntryListDate,
  formatInwardGrnListSummary,
  formatInwardPhotoUploadStatus,
  getInwardGrnEntries,
  inwardHasGrnDetails
} from "./inwardEntryUtils";
import { Badge } from "@/components/ui/badge";
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
        {searchQuery.trim() ? "No matches." : "No inward entries yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Product / Material</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Photos</TableHead>
            <TableHead>GRN</TableHead>
            <TableHead className="min-w-[12rem]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((record) => {
            const hasGrn = inwardHasGrnDetails(record);
            return (
              <TableRow key={record.id}>
                <TableCell className="whitespace-nowrap">
                  {formatInwardEntryListDate(record)}
                </TableCell>
                <TableCell>{cell(record.product_material)}</TableCell>
                <TableCell>{formatInwardDepartmentDisplay(record)}</TableCell>
                <TableCell>{formatInwardPhotoUploadStatus(record)}</TableCell>
                <TableCell>
                  {hasGrn ? (
                    <Badge variant="secondary">{formatInwardGrnListSummary(record)}</Badge>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </TableCell>
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
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onGrnEntry?.(record)}
                      >
                        GRN Entry
                      </Button>
                    ) : null}
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
