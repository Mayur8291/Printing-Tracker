import { useMemo, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ENQUIRY_CSV_HEADERS,
  buildEnquiryXlsxTemplate,
  downloadBinaryFile,
  importEnquiryRows,
  parseEnquiryFile
} from "./enquiryBulkUploadUtils";
import { stateForCity } from "./indianCities";

function shortDate(iso) {
  if (!iso) return "today";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "today" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Bulk CSV upload for the Enquiry desk. Missing cells allowed; preview shows what will land.
 */
export default function EnquiryBulkUploadDialog({ open, onOpenChange, tags = [], sessionUserId, onImported }) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const tagNameById = useMemo(() => Object.fromEntries((tags ?? []).map((t) => [t.id, t.name])), [tags]);
  const importable = useMemo(() => (parsed?.rows ?? []).filter((r) => !r.skip), [parsed]);
  const skipped = useMemo(() => (parsed?.rows ?? []).filter((r) => r.skip), [parsed]);
  const warnCount = useMemo(() => importable.filter((r) => r.warnings.length).length, [importable]);

  function reset() {
    setFileName("");
    setParsed(null);
    setParseError("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
  }

  function handleClose(next) {
    if (importing) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleTemplate() {
    setTemplateBusy(true);
    setParseError("");
    try {
      const buffer = await buildEnquiryXlsxTemplate(tags);
      downloadBinaryFile(
        "enquiries-template.xlsx",
        buffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    } catch (err) {
      setParseError(err?.message || "Could not build the template.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setResult(null);
    setParseError("");
    setParsed(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const out = await parseEnquiryFile(file, { tags });
      if (!out.rows.length) {
        setParseError("No data rows found under the header.");
        return;
      }
      setParsed(out);
    } catch (err) {
      setParseError(err?.message || "Could not read this file.");
    }
  }

  async function handleImport() {
    if (!importable.length || !sessionUserId) return;
    setImporting(true);
    setProgress({ done: 0, total: importable.length });
    try {
      const out = await importEnquiryRows({
        rows: importable,
        createdBy: sessionUserId,
        onProgress: (done, total) => setProgress({ done, total })
      });
      setResult(out);
      if (out.created.length) onImported?.(out.created);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk upload enquiries</DialogTitle>
          <DialogDescription>
            Excel template has dropdowns for Source, Tag and City. Columns: {ENQUIRY_CSV_HEADERS.join(", ")}.
            Blank cells are fine. Date reads dd/mm/yyyy; blank date = today. Upload .xlsx or .csv.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="enquiry-bulk-file">Excel or CSV file</Label>
            <Input
              id="enquiry-bulk-file"
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFile}
              disabled={importing}
              className="max-w-xs"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleTemplate} disabled={importing || templateBusy}>
            <Download className="mr-1 h-4 w-4" aria-hidden />
            {templateBusy ? "Building…" : "Download Excel template"}
          </Button>
          {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
        </div>

        {parseError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Could not read file</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        ) : null}

        {parsed?.missingHeaders?.length ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Headers not found: {parsed.missingHeaders.join(", ")}</AlertTitle>
            <AlertDescription>Those columns will import blank. Use the template headers to fill them.</AlertDescription>
          </Alert>
        ) : null}

        {parsed && !result ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{importable.length} to import</Badge>
              {warnCount ? <Badge variant="outline">{warnCount} with notes</Badge> : null}
              {skipped.length ? <Badge variant="destructive">{skipped.length} skipped</Badge> : null}
            </div>
            <ScrollArea className="h-[40vh] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Concerns</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Tag</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>City / State</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.rows.map((r) => (
                    <TableRow key={r.line} className={r.skip ? "opacity-60" : undefined}>
                      <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                      {r.skip ? (
                        <TableCell colSpan={7} className="text-xs text-muted-foreground">
                          Skipped — {r.skipReason}
                        </TableCell>
                      ) : (
                        <>
                          <TableCell className="max-w-[10rem] truncate">{r.form.customer_name}</TableCell>
                          <TableCell className="max-w-[14rem] truncate text-xs">{r.form.product_details || "—"}</TableCell>
                          <TableCell className="text-xs">{r.form.source || "—"}</TableCell>
                          <TableCell className="text-xs">{r.form.tag_id ? tagNameById[r.form.tag_id] : "—"}</TableCell>
                          <TableCell className="text-xs">{shortDate(r.form.created_at)}</TableCell>
                          <TableCell className="text-xs">{r.form.customer_phone || "—"}</TableCell>
                          <TableCell className="text-xs">
                            {r.form.customer_city
                              ? [r.form.customer_city, stateForCity(r.form.customer_city)].filter(Boolean).join(", ")
                              : "—"}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="max-w-[14rem] text-xs text-muted-foreground">
                        {r.warnings.length ? r.warnings.join("; ") : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        ) : null}

        {result ? (
          <Alert variant={result.failed.length ? "destructive" : "default"}>
            <AlertTitle>
              Imported {result.created.length}
              {result.failed.length ? ` · ${result.failed.length} failed` : ""}
            </AlertTitle>
            {result.failed.length ? (
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {result.failed.slice(0, 20).map((f) => (
                    <li key={f.line}>
                      Row {f.line}: {f.error}
                    </li>
                  ))}
                  {result.failed.length > 20 ? <li>…and {result.failed.length - 20} more</li> : null}
                </ul>
              </AlertDescription>
            ) : (
              <AlertDescription>All rows are on the Enquiry desk now.</AlertDescription>
            )}
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={importing}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result ? (
            <Button type="button" onClick={handleImport} disabled={importing || !importable.length}>
              <Upload className="mr-1 h-4 w-4" aria-hidden />
              {importing ? `Importing ${progress.done}/${progress.total}…` : `Import ${importable.length}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
