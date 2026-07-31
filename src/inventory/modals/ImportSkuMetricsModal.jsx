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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchInventorySkuRowsAll, rowToSku } from "../inventoryDbUtils";
import {
  downloadSkuMetricsSkipReport,
  downloadSkuMetricsTemplate,
  enrichSkuMetricsRows,
  parseSkuMetricsWorkbook,
  summarizeSkuMetricsPreview
} from "../inventorySkuMetricsImportUtils";

function formatMetric(value) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString();
}

export default function ImportSkuMetricsModal({ onClose, onImport }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState("");
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await downloadSkuMetricsTemplate();
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

    setParsing(true);
    try {
      const [{ records, parseMeta }, skuRows] = await Promise.all([
        parseSkuMetricsWorkbook(picked),
        fetchInventorySkuRowsAll()
      ]);
      const allSkus = skuRows.map(rowToSku);
      const enriched = enrichSkuMetricsRows(allSkus, records);
      const summary = summarizeSkuMetricsPreview(enriched);
      setPreview({
        ...summary,
        parseMeta,
        sample: enriched.slice(0, 8),
        allRows: enriched,
        records: summary.valid
      });
    } catch (err) {
      setParseError(err?.message || "Could not read the Excel file.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!preview?.records?.length) return;
    setImporting(true);
    setProgress("Uploading…");
    try {
      await onImport(preview.records, {
        onProgress: (done, total) => setProgress(`Updated ${done.toLocaleString()} of ${total.toLocaleString()}…`)
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
          <DialogTitle>Bulk pricing &amp; reorder upload</DialogTitle>
          <DialogDescription>
            Update unit cost, sale price, reorder point, and DOC for existing SKUs. Fill only the columns you need —
            other fields stay unchanged. Separate from Import SKUs and warehouse stock upload. DRR stays auto-calculated
            from orders.
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
              disabled={importing || downloading || parsing}
            >
              <Download className="size-3.5" />
              {downloading ? "Preparing…" : "Download template"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Columns: SKU Code (required), Unit Cost (₹), Sale Price (₹), Reorder Point, DOC
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-sku-metrics-file">Upload filled Excel (.xlsx)</Label>
            <Input
              id="import-sku-metrics-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
              disabled={importing || parsing}
            />
            {file ? (
              <p className="text-xs text-muted-foreground">
                Selected: <strong>{file.name}</strong>
                {parsing ? " — loading all SKUs and validating…" : null}
              </p>
            ) : null}
          </div>

          {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}

          {preview ? (
            <div className="space-y-3 rounded-md border p-4">
              <div className="space-y-1 text-sm">
                <p>
                  <strong>{preview.validCount.toLocaleString()}</strong> SKUs ready to update
                  {preview.invalidCount > 0 ? (
                    <>
                      {" "}
                      · <span className="text-destructive">{preview.invalidCount.toLocaleString()} skipped</span>
                    </>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {preview.costCount.toLocaleString()} unit cost
                  {preview.retailCount > 0 ? ` · ${preview.retailCount.toLocaleString()} sale price` : ""}
                  {preview.reorderCount > 0 ? ` · ${preview.reorderCount.toLocaleString()} reorder` : ""}
                  {preview.docCount > 0 ? ` · ${preview.docCount.toLocaleString()} DOC` : ""}
                  {preview.parseMeta?.duplicateMerged > 0
                    ? ` · ${preview.parseMeta.duplicateMerged.toLocaleString()} duplicate rows merged`
                    : ""}
                </p>
                {preview.invalidCount > 0 ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => downloadSkuMetricsSkipReport(preview.allRows)}
                  >
                    Download skipped rows CSV
                  </Button>
                ) : null}
              </div>
              <div className="max-h-64 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Sale price</TableHead>
                      <TableHead className="text-right">Reorder</TableHead>
                      <TableHead className="text-right">DOC</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((r) => (
                      <TableRow key={`${r.skuCode}-${r.error || "ok"}`}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{r.skuCode}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {r.error ? "—" : r.willUpdateCost ? formatMetric(r.unitCost) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {r.error ? "—" : r.willUpdateRetail ? formatMetric(r.salePrice) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {r.error ? "—" : r.willUpdateReorder ? formatMetric(r.reorderPoint) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {r.error ? "—" : r.willUpdateDoc ? formatMetric(r.doc) : "—"}
                        </TableCell>
                        <TableCell className="max-w-[12rem] text-xs text-muted-foreground">
                          {r.error || "Ready"}
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
          <Button type="button" className="gap-1.5" onClick={handleImport} disabled={importing || !preview?.records?.length}>
            <Upload className="size-3.5" />
            {importing ? "Uploading…" : `Update ${preview?.validCount?.toLocaleString() || 0} SKUs`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
