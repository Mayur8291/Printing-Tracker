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
import { downloadApparelSkuTemplate, parseApparelSkuWorkbook } from "../inventorySkuImportUtils";

export default function ImportSkusModal({ onClose, onImport, existingSkuCodes = [] }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState("");

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await downloadApparelSkuTemplate();
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
      const records = await parseApparelSkuWorkbook(picked);
      const existing = new Set(existingSkuCodes.map((c) => String(c).trim().toLowerCase()));
      const newRows = records.filter((r) => !existing.has(String(r.id).trim().toLowerCase()));
      const duplicateRows = records.length - newRows.length;
      setPreview({
        total: records.length,
        newCount: newRows.length,
        duplicateCount: duplicateRows,
        sample: records.slice(0, 5),
        records: newRows
      });
    } catch (err) {
      setParseError(err?.message || "Could not read the Excel file.");
    }
  }

  async function handleImport() {
    if (!preview?.records?.length) return;
    setImporting(true);
    setProgress("Importing…");
    try {
      await onImport(preview.records, {
        onProgress: (done, total) => setProgress(`Imported ${done.toLocaleString()} of ${total.toLocaleString()}…`)
      });
      onClose();
    } catch (err) {
      setParseError(err?.message || "Import failed.");
    } finally {
      setImporting(false);
      setProgress("");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import apparel SKUs</DialogTitle>
          <DialogDescription>
            Download the template, fill SKU rows, then upload. Columns: SKU, Size, Class Name, Color, Brand,
            Category. Supplier is set later in the dashboard.
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
              Required columns: SKU, Size, Class Name, Color, Brand, Category
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-skus-file">Upload filled Excel (.xlsx)</Label>
            <Input
              id="import-skus-file"
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
                <strong>{preview.newCount.toLocaleString()}</strong> new SKUs ready to import
                {preview.duplicateCount > 0
                  ? ` · ${preview.duplicateCount.toLocaleString()} already in inventory (skipped)`
                  : ""}
              </p>
              <div className="max-h-64 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Color</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.id}</TableCell>
                        <TableCell>{r.sizeLabel || "—"}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>{r.color}</TableCell>
                        <TableCell>{r.category}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.total > 5 ? (
                <p className="text-xs text-muted-foreground">Showing 5 of {preview.total.toLocaleString()} rows.</p>
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
            {importing ? "Importing…" : `Import ${preview?.newCount?.toLocaleString() || 0} SKUs`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
