import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Copy, Download, Eraser, ImagePlus, Settings2, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { removeArtworkBackground } from "./printCalculatorBackgroundRemoval";
import { fetchPrintCalculatorSettings, savePrintCalculatorRates } from "./printCalculatorDb";
import {
  PRINT_AUDIENCES,
  PRINT_BLEED_INCHES,
  PRINT_CALCULATOR_DPI,
  PRINT_PRICE_SLABS,
  audienceLabel,
  buildPrintQuoteText,
  downloadImageUrl,
  emptyPriceLists,
  formatInches,
  formatInrAmount,
  formatRateAmount,
  formatSqIn,
  pixelsToInches,
  priceDraftDirty,
  priceListsToDraft,
  printLineQuote,
  rateForCopies,
  slabForCopies,
  summarizePrintQuotes
} from "./printCalculatorUtils";

function revokePreviewUrl(url) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function ArtworkCard({ artwork, quote, onChange, onRemove, onRemoveBackground }) {
  const handleImageLoad = (e) => {
    const img = e.currentTarget;
    if (artwork.backgroundRemoved) return;
    if (artwork.widthInches || artwork.heightInches) return;
    const w = pixelsToInches(img.naturalWidth);
    const h = pixelsToInches(img.naturalHeight);
    if (w && h) {
      onChange(artwork.id, { widthInches: w, heightInches: h });
    }
  };

  return (
    <Card className={cn(artwork.backgroundRemoved && "ring-1 ring-primary/30")}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4">
        <CardTitle className="min-w-0 truncate text-sm">{artwork.fileName || "Artwork"}</CardTitle>
        {artwork.backgroundRemoved ? (
          <Badge variant="secondary">Background removed</Badge>
        ) : !quote.ready ? (
          <Badge variant="outline">Needs size</Badge>
        ) : (
          <Badge variant="outline">{formatInrAmount(quote.cost)}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4 pt-0 sm:flex-row">
        <div
          className={cn(
            "relative flex shrink-0 items-center justify-center rounded-md border p-2 sm:w-40",
            artwork.backgroundRemoved
              ? "bg-[linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%,#ccc),linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%,#ccc)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]"
              : "bg-muted/30"
          )}
        >
          {artwork.removingBg ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/70">
              <Spinner className="size-6" />
            </div>
          ) : null}
          <img
            src={artwork.previewUrl}
            alt={artwork.fileName || "Artwork preview"}
            className="max-h-36 max-w-full object-contain"
            onLoad={handleImageLoad}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <FieldGroup className="gap-3 sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`print-calc-w-${artwork.id}`}>Width (in)</FieldLabel>
              <Input
                id={`print-calc-w-${artwork.id}`}
                type="number"
                min="0.1"
                step="0.01"
                value={artwork.widthInches}
                onChange={(e) => onChange(artwork.id, { widthInches: e.target.value })}
                disabled={artwork.removingBg}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`print-calc-h-${artwork.id}`}>Height (in)</FieldLabel>
              <Input
                id={`print-calc-h-${artwork.id}`}
                type="number"
                min="0.1"
                step="0.01"
                value={artwork.heightInches}
                onChange={(e) => onChange(artwork.id, { heightInches: e.target.value })}
                disabled={artwork.removingBg}
              />
            </Field>
          </FieldGroup>
          {quote.ready ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Artwork</dt>
              <dd className="text-right tabular-nums">
                {formatInches(quote.widthInches)} × {formatInches(quote.heightInches)} in
              </dd>
              <dt className="text-muted-foreground">Billed (+{PRINT_BLEED_INCHES} in)</dt>
              <dd className="text-right tabular-nums">
                {formatInches(quote.billedWidth)} × {formatInches(quote.billedHeight)} in
              </dd>
              <dt className="text-muted-foreground">Qty slab</dt>
              <dd className="text-right">
                {quote.slab?.label} qty
                {quote.aboveMax ? " (above 1000 uses this rate)" : ""}
              </dd>
              <dt className="text-muted-foreground">Area × rate × quantity</dt>
              <dd className="text-right tabular-nums">
                {formatSqIn(quote.areaSqIn)} × {formatRateAmount(quote.rate)} × {quote.copies}
              </dd>
              <dt className="font-medium">Line cost</dt>
              <dd className="text-right font-semibold tabular-nums">{formatInrAmount(quote.cost)}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter width and height. Quantity at the top multiplies this print and every other print.
            </p>
          )}
          {artwork.bgStatus ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {artwork.bgStatus}
            </p>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 p-4 pt-0">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={artwork.removingBg || artwork.backgroundRemoved}
          onClick={() => onRemoveBackground(artwork.id)}
        >
          <Eraser className="size-3.5" />
          {artwork.removingBg ? "Removing…" : "Remove background"}
        </Button>
        {artwork.backgroundRemoved ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const base = (artwork.fileName || "artwork").replace(/\.[^.]+$/, "");
              downloadImageUrl(artwork.previewUrl, `${base}_nobg.png`);
            }}
          >
            <Download className="size-3.5" />
            Download PNG
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={() => onRemove(artwork.id)}
          disabled={artwork.removingBg}
        >
          <Trash2 className="size-3.5" />
          Remove artwork
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function PrintCalculatorModal({ open, onClose, isAdmin, userId }) {
  const [artworks, setArtworks] = useState([]);
  const [audience, setAudience] = useState("customer");
  const [quantity, setQuantity] = useState("1");
  const [priceLists, setPriceLists] = useState(() => emptyPriceLists());
  const [rateDraft, setRateDraft] = useState(() => emptyPriceLists());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingRate, setSavingRate] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [quoteNotice, setQuoteNotice] = useState("");
  const fileInputRef = useRef(null);
  const quoteNoticeTimer = useRef(null);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsError("");
    try {
      const settings = await fetchPrintCalculatorSettings();
      setPriceLists(settings.priceLists);
      setRateDraft(priceListsToDraft(settings.priceLists));
    } catch (err) {
      setSettingsError(err?.message || "Could not load calculator settings.");
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadSettings();
  }, [open, loadSettings]);

  useEffect(() => {
    if (!open) {
      setArtworks((prev) => {
        prev.forEach((a) => revokePreviewUrl(a.previewUrl));
        return [];
      });
      setDragOver(false);
      setQuantity("1");
      setQuoteNotice("");
      window.clearTimeout(quoteNoticeTimer.current);
    }
  }, [open]);

  const quotedRows = useMemo(
    () =>
      artworks.map((artwork) => {
        const picked = rateForCopies(priceLists, audience, quantity);
        return {
          fileName: artwork.fileName,
          quote: printLineQuote(
            artwork.heightInches,
            artwork.widthInches,
            picked.rate,
            quantity
          )
        };
      }),
    [artworks, audience, priceLists, quantity]
  );

  const quantitySlab = slabForCopies(quantity);

  const summary = useMemo(
    () => summarizePrintQuotes(quotedRows.map((row) => row.quote)),
    [quotedRows]
  );

  const rateDirty = isAdmin && priceDraftDirty(rateDraft, priceLists);

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setArtworks((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `a${Date.now()}_${Math.random().toString(36).slice(2)}`,
        file,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        widthInches: "",
        heightInches: "",
        backgroundRemoved: false,
        removingBg: false,
        bgStatus: ""
      }))
    ]);
  }

  function updateArtwork(id, patch) {
    setArtworks((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeArtwork(id) {
    setArtworks((prev) => {
      const target = prev.find((a) => a.id === id);
      revokePreviewUrl(target?.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  async function handleRemoveBackground(id) {
    const artwork = artworks.find((a) => a.id === id);
    if (!artwork || artwork.removingBg) return;

    updateArtwork(id, { removingBg: true, bgStatus: "Starting…" });
    try {
      const result = await removeArtworkBackground(artwork, (msg) => {
        updateArtwork(id, { bgStatus: msg });
      });
      setArtworks((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          revokePreviewUrl(a.previewUrl);
          return {
            ...a,
            originalPreviewUrl: a.originalPreviewUrl || a.previewUrl,
            previewUrl: result.dataUrl,
            widthInches: result.widthInches,
            heightInches: result.heightInches,
            widthPx: result.widthPx,
            heightPx: result.heightPx,
            backgroundRemoved: true,
            removingBg: false,
            bgStatus: `Background removed · ${result.widthPx}×${result.heightPx}px`
          };
        })
      );
    } catch (err) {
      const msg = err?.message || String(err);
      const hint =
        msg.includes("fetch") || msg.includes("Failed to fetch")
          ? " First run downloads the model (~40MB). Check your network and try again."
          : "";
      updateArtwork(id, { removingBg: false, bgStatus: "" });
      window.alert(`Background removal failed: ${msg}${hint}`);
    }
  }

  async function handleSaveRate() {
    if (!isAdmin) return;
    setSavingRate(true);
    setSettingsError("");
    try {
      const saved = await savePrintCalculatorRates(rateDraft, userId);
      setPriceLists(saved.priceLists);
      setRateDraft(priceListsToDraft(saved.priceLists));
    } catch (err) {
      setSettingsError(err?.message || "Could not save rate.");
    } finally {
      setSavingRate(false);
    }
  }

  async function handleCopyQuote() {
    const text = buildPrintQuoteText(quotedRows, audience);
    try {
      await navigator.clipboard.writeText(text);
      setQuoteNotice("Quote copied.");
    } catch {
      setQuoteNotice("Could not copy. Select the total and copy it by hand.");
    }
    window.clearTimeout(quoteNoticeTimer.current);
    quoteNoticeTimer.current = window.setTimeout(() => setQuoteNotice(""), 2500);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="size-5" />
            Print cost calculator
          </DialogTitle>
          <DialogDescription>
            Square inches × ₹ per sq in × quantity. One quantity multiplies every print.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <div className="flex flex-col gap-4 pb-2">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 p-4">
                <CardTitle className="text-sm">Price list</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={audience}
                    onValueChange={(value) => {
                      if (value) setAudience(value);
                    }}
                    aria-label="Price list"
                  >
                    {PRINT_AUDIENCES.map((item) => (
                      <ToggleGroupItem key={item.id} value={item.id} className="px-3">
                        {item.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setSettingsOpen((openNow) => !openNow)}
                    >
                      <Settings2 className="size-3.5" />
                      Pricing settings
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4 pt-0">
                <Field className="max-w-[12rem]">
                  <FieldLabel htmlFor="print-calc-quantity">Quantity</FieldLabel>
                  <Input
                    id="print-calc-quantity"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  <FieldDescription>
                    Multiplies every print below.
                    {quantitySlab ? ` Slab ${quantitySlab.label}.` : " Enter at least 1."}
                  </FieldDescription>
                </Field>
                <p className="text-sm text-muted-foreground">
                  {audienceLabel(audience)} rates are ₹ per square inch. This quantity picks the slab for every print.
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {PRINT_PRICE_SLABS.map((slab) => (
                    <Fragment key={slab.id}>
                      <dt className="text-muted-foreground">{slab.label} qty</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {formatRateAmount(priceLists?.[audience]?.[slab.id])} / sq in
                        {quantitySlab?.id === slab.id ? " · this quote" : ""}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
                <FieldDescription>
                  1–10 uses 0–10. 11–200 uses 10–200. 201–1000 uses 200–1000. Above 1000 keeps the 200–1000 rate.
                  Size is still entered in inches. Guessed size uses {PRINT_CALCULATOR_DPI} DPI.
                </FieldDescription>
                {isAdmin && settingsOpen ? (
                  <div className="flex flex-col gap-3 rounded-lg border p-3">
                    <p className="text-sm font-medium">Set ₹ per square inch</p>
                    <div className="grid grid-cols-[minmax(0,6rem)_1fr_1fr] gap-2 text-xs text-muted-foreground">
                      <span>Qty</span>
                      <span>Internal team</span>
                      <span>Customer</span>
                    </div>
                    {PRINT_PRICE_SLABS.map((slab) => (
                      <div key={slab.id} className="grid grid-cols-[minmax(0,6rem)_1fr_1fr] items-center gap-2">
                        <span className="text-sm">{slab.label}</span>
                        {PRINT_AUDIENCES.map((item) => (
                          <Input
                            key={item.id}
                            id={`print-rate-${item.id}-${slab.id}`}
                            aria-label={`${item.label} ${slab.label} rupees per square inch`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={rateDraft?.[item.id]?.[slab.id] ?? ""}
                            disabled={loadingSettings || savingRate}
                            onChange={(e) =>
                              setRateDraft((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], [slab.id]: e.target.value }
                              }))
                            }
                          />
                        ))}
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleSaveRate()}
                        disabled={savingRate || loadingSettings}
                      >
                        {savingRate ? "Saving…" : "Save pricing"}
                      </Button>
                      {rateDirty ? (
                        <Badge variant="outline">Not saved — totals use the saved rates</Badge>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {settingsError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Pricing not saved</AlertTitle>
                    <AlertDescription>{settingsError}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            <div
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/50"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <ImagePlus className="mb-2 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Drop one or many prints, or click to upload</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, WebP. Add more anytime. Quantity above applies to all of them.</p>
            </div>

            {artworks.length ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Prints ({artworks.length})</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="size-3.5" />
                    Add more prints
                  </Button>
                </div>
                {artworks.map((artwork, index) => (
                  <ArtworkCard
                    key={artwork.id}
                    artwork={artwork}
                    quote={quotedRows[index].quote}
                    onChange={updateArtwork}
                    onRemove={removeArtwork}
                    onRemoveBackground={handleRemoveBackground}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-4 border-t bg-background px-6 py-4 sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1 text-left">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Prints <strong className="text-foreground tabular-nums">{artworks.length}</strong>
              </span>
              <Separator orientation="vertical" className="hidden h-3 sm:block" />
              <span>
                Quantity <strong className="text-foreground tabular-nums">{quantitySlab ? parseInt(quantity, 10) : 0}</strong>
              </span>
              <Separator orientation="vertical" className="hidden h-3 sm:block" />
              <span>
                Billed area{" "}
                <strong className="text-foreground tabular-nums">{formatSqIn(summary.areaSqIn)}</strong>
              </span>
              <Separator orientation="vertical" className="hidden h-3 sm:block" />
              <span>
                List <strong className="text-foreground">{audienceLabel(audience)}</strong>
              </span>
            </div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total print cost</p>
            <p className="text-2xl font-semibold tabular-nums">{formatInrAmount(summary.cost)}</p>
            {quoteNotice ? <p className="text-xs text-muted-foreground">{quoteNotice}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => void handleCopyQuote()}>
              <Copy className="size-3.5" />
              Copy quote
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
