import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Download, FileUp } from "lucide-react";
import {
  PARTY_CSV_HEADERS,
  SKU_CSV_HEADERS,
  buildPartyImportPreview,
  buildSkuImportPreview,
  csvToObjects,
  downloadCsvTemplate,
  importPreviewRows
} from "./mastersUtils";

const STATUS_BADGE = {
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  duplicate_existing: "bg-amber-50 text-amber-700 border-amber-200",
  duplicate_in_file: "bg-orange-50 text-orange-700 border-orange-200",
  invalid: "bg-red-50 text-red-700 border-red-200"
};

const STATUS_LABEL = {
  ready: "New",
  duplicate_existing: "Already in masters",
  duplicate_in_file: "Duplicate in file",
  invalid: "Invalid"
};

/**
 * CSV import for Parties / SKUs with a dedupe report (law 1): every row is
 * classified before import; only "New" rows are inserted.
 */
export default function MastersImportDialog({ open, onOpenChange, kind, existingRows, onImported }) {
  const isParty = kind === "party";
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const expectedHeaders = isParty ? PARTY_CSV_HEADERS : SKU_CSV_HEADERS;

  function reset() {
    setFileName("");
    setPreview(null);
    setParseError("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleOpenChange(next) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    setResult(null);
    setPreview(null);
    setParseError("");
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const { headers, objects } = csvToObjects(text);
      if (objects.length === 0) {
        setParseError("File has no data rows under the header.");
        return;
      }
      const requiredHeader = isParty ? "legal_name" : "sku_code";
      if (!headers.includes(requiredHeader)) {
        setParseError(`Header "${requiredHeader}" not found. Download the template to see the expected columns.`);
        return;
      }
      const rows = isParty
        ? buildPartyImportPreview(objects, existingRows)
        : buildSkuImportPreview(objects, existingRows);
      setPreview(rows);
    } catch (e) {
      setParseError(e.message || "Could not read the file.");
    }
  }

  const counts = useMemo(() => {
    const c = { ready: 0, duplicate_existing: 0, duplicate_in_file: 0, invalid: 0 };
    for (const row of preview ?? []) c[row.status] += 1;
    return c;
  }, [preview]);

  async function handleImport() {
    if (!preview || counts.ready === 0) return;
    setImporting(true);
    try {
      const outcome = await importPreviewRows(isParty ? "crm_party" : "cat_sku", preview);
      setResult(outcome);
      if (outcome.inserted > 0) onImported?.();
    } catch (e) {
      setResult({ inserted: 0, failed: [{ rowNumber: "-", message: e.message || "Import failed." }] });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {isParty ? "parties" : "SKUs"} from CSV</DialogTitle>
          <DialogDescription>
            Columns: {expectedHeaders.join(", ")}. Rows are checked for duplicates before anything is
            written — only rows marked <strong>New</strong> are imported.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => downloadCsvTemplate(kind)}>
            <Download className="mr-1 h-4 w-4" aria-hidden />
            Template
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <FileUp className="mr-1 h-4 w-4" aria-hidden />
            Choose CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void handleFile(e)}
          />
          {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
        </div>

        {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}

        {preview ? (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <Badge key={key} variant="outline" className={cn(STATUS_BADGE[key])}>
                  {label}: {counts[key]}
                </Badge>
              ))}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead>{isParty ? "Legal name" : "SKU code"}</TableHead>
                    <TableHead>{isParty ? "Kind" : "Size"}</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                      <TableCell className="font-medium">
                        {isParty ? row.payload.legal_name || "—" : row.payload.sku_code || "—"}
                      </TableCell>
                      <TableCell>{isParty ? row.payload.kind : row.payload.size_label || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(STATUS_BADGE[row.status])}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}

        {result ? (
          <div className="space-y-1 text-sm">
            <p>
              Imported <strong>{result.inserted}</strong> row{result.inserted === 1 ? "" : "s"}.
              {result.failed.length > 0 ? ` ${result.failed.length} failed:` : ""}
            </p>
            {result.failed.map((f) => (
              <p key={`${f.rowNumber}-${f.message}`} className="text-destructive">
                Row {f.rowNumber}: {f.message}
              </p>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            disabled={!preview || counts.ready === 0 || importing || result != null}
            onClick={() => void handleImport()}
          >
            {importing ? "Importing…" : `Import ${counts.ready} new row${counts.ready === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
