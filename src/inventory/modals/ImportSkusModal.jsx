import { useState } from "react";
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
import { parseApparelSkuWorkbook } from "../inventorySkuImportUtils";

export default function ImportSkusModal({ onClose, onImport, existingSkuCodes = [] }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");

  async function handleFileChange(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    setFile(picked || null);
    setPreview(null);
    setParseError("");
    if (!picked) return;

    try {
      const records = await parseApparelSkuWorkbook(picked);
      const existing = new Set(existingSkuCodes);
      const newRows = records.filter((r) => !existing.has(r.id));
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
        onProgress: (done, total) => setProgress(`Imported ${done} of ${total}…`)
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
            Upload Excel with columns: SKU, Size, Class Name, Color, Brand, Category. Supplier left blank.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-skus-file">Excel file (.xlsx)</Label>
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
          <Button type="button" onClick={handleImport} disabled={importing || !preview?.records?.length}>
            {importing ? "Importing…" : `Import ${preview?.newCount?.toLocaleString() || 0} SKUs`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
