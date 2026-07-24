import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { resolveFacilityCode } from "../inventoryFacilityUtils";
import {
  downloadStockAdjustTemplate,
  enrichStockAdjustRows,
  parseStockAdjustWorkbook
} from "../inventoryStockAdjustImportUtils";

export default function ImportStockAdjustModal({
  onClose,
  onImport,
  skus = [],
  warehouse,
  warehouses = [],
  availabilityBySku
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [downloading, setDownloading] = useState(false);

  const facilityCode = resolveFacilityCode(warehouse);

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await downloadStockAdjustTemplate(warehouse?.name || "");
    } catch (err) {
      setParseError(err?.message || "Could not generate template.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileChange(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    setFile(picked || null);
    setPreview(null);
    setParseError("");
    if (!picked) return;

    try {
      const records = await parseStockAdjustWorkbook(picked);
      const enriched = enrichStockAdjustRows(skus, records, {
        warehouseId: warehouse?.id,
        warehouses,
        availabilityBySku
      });
      const valid = enriched.filter((r) => !r.error);
      const invalid = enriched.filter((r) => r.error);
      setPreview({
        total: enriched.length,
        validCount: valid.length,
        invalidCount: invalid.length,
        sample: enriched.slice(0, 8),
        records: valid
      });
    } catch (err) {
      setParseError(err?.message || "Could not read the Excel file.");
    }
  }

  async function handleImport() {
    if (!preview?.records?.length) return;
    setImporting(true);
    setProgress("Uploading…");
    try {
      await onImport(preview.records, {
        warehouseId: warehouse?.id,
        onProgress: (done, total) => setProgress(`Processed ${done} of ${total}…`)
      });
      onClose();
    } catch (err) {
      setParseError(err?.message || "Upload failed.");
    } finally {
      setImporting(false);
      setProgress("");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk stock &amp; DOC upload — {warehouse?.name || "Warehouse"}</DialogTitle>
          <DialogDescription>
            Stock qty updates apply only to <strong>{warehouse?.name || "this warehouse"}</strong>
            {facilityCode ? (
              <>
                {" "}
                (<span className="font-mono">{facilityCode}</span>)
              </>
            ) : null}
            . Other warehouses are not changed. DRR stays auto-calculated from orders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleDownloadTemplate}
              disabled={importing || downloading}
            >
              <Download className="size-3.5" />
              {downloading ? "Preparing…" : "Download template"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Columns: SKU Code (required), Stock Qty, DOC, Storage Location, Reason — scoped to this warehouse
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-stock-adjust-file">Upload filled Excel (.xlsx)</Label>
            <Input
              id="import-stock-adjust-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
              disabled={importing}
            />
            {file ? (
              <p className="text-xs text-muted-foreground">
                Selected: <strong>{file.name}</strong>
              </p>
            ) : null}
          </div>

          {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}

          {preview ? (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm">
                <strong>{preview.validCount.toLocaleString()}</strong> rows ready at {warehouse?.name || "warehouse"}
                {preview.invalidCount > 0 ? (
                  <>
                    {" "}
                    · <span className="text-destructive">{preview.invalidCount} skipped</span>
                  </>
                ) : null}
              </p>
              <div className="max-h-64 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Stock at warehouse</TableHead>
                      <TableHead>DOC</TableHead>
                      <TableHead>Storage</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((row) => (
                      <TableRow key={row.skuCode}>
                        <TableCell className="font-mono text-xs">{row.skuCode}</TableCell>
                        <TableCell className="text-xs">
                          {row.error ? (
                            "—"
                          ) : row.willAdjustStock ? (
                            <>
                              {row.currentStock} → {row.targetStock}
                              <span className="ml-1 text-muted-foreground">
                                ({row.delta > 0 ? "+" : ""}
                                {row.delta})
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">No change</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.error
                            ? "—"
                            : row.willUpdateDoc
                              ? `${row.currentDoc ?? "—"} → ${row.doc}`
                              : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.error
                            ? "—"
                            : row.willUpdateBin
                              ? `${row.currentBin || "—"} → ${row.targetBin}`
                              : row.targetBin
                                ? row.currentBin || "—"
                                : "—"}
                        </TableCell>
                        <TableCell>
                          {row.error ? (
                            <Badge variant="destructive" className="text-[10px] font-normal">
                              {row.error}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              OK
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.total > 8 ? (
                <p className="text-xs text-muted-foreground">Showing 8 of {preview.total.toLocaleString()} rows.</p>
              ) : null}
            </div>
          ) : null}

          {progress ? <p className="text-xs text-muted-foreground">{progress}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={handleImport}
            disabled={importing || !preview?.records?.length}
          >
            <Upload className="size-3.5" />
            {importing ? "Uploading…" : `Apply ${preview?.validCount?.toLocaleString() || 0} rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
