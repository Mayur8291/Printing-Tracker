import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Download, ImagePlus, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { fetchPrintCalculatorSettings, savePrintCalculatorRate } from "./printCalculatorDb";
import {
  computePrintCost,
  downloadImageUrl,
  formatInrAmount,
  pixelsToInches
} from "./printCalculatorUtils";

function ArtworkCard({ artwork, ratePerSqIn, onChange, onRemove }) {
  const cost = computePrintCost(artwork.heightInches, artwork.widthInches, ratePerSqIn);

  const handleImageLoad = (e) => {
    const img = e.currentTarget;
    if (artwork.widthInches || artwork.heightInches) return;
    const w = pixelsToInches(img.naturalWidth);
    const h = pixelsToInches(img.naturalHeight);
    if (w && h) {
      onChange(artwork.id, { widthInches: w, heightInches: h });
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 items-center justify-center rounded-md border bg-muted/30 p-2 sm:w-40">
          <img
            src={artwork.previewUrl}
            alt={artwork.fileName || "Artwork preview"}
            className="max-h-36 max-w-full object-contain"
            onLoad={handleImageLoad}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="truncate text-sm font-medium">{artwork.fileName || "Artwork"}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`print-calc-w-${artwork.id}`}>Width (in)</Label>
              <Input
                id={`print-calc-w-${artwork.id}`}
                type="number"
                min="0.1"
                step="0.01"
                value={artwork.widthInches}
                onChange={(e) => onChange(artwork.id, { widthInches: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`print-calc-h-${artwork.id}`}>Height (in)</Label>
              <Input
                id={`print-calc-h-${artwork.id}`}
                type="number"
                min="0.1"
                step="0.01"
                value={artwork.heightInches}
                onChange={(e) => onChange(artwork.id, { heightInches: e.target.value })}
              />
            </div>
          </div>
          <p className="text-sm">
            Cost: <strong>{formatInrAmount(cost)}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const base = (artwork.fileName || "artwork").replace(/\.[^.]+$/, "");
                downloadImageUrl(artwork.previewUrl, `${base}.png`);
              }}
            >
              <Download className="size-3.5" />
              Download PNG
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => onRemove(artwork.id)}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrintCalculatorModal({ open, onClose, isAdmin, userId }) {
  const [artworks, setArtworks] = useState([]);
  const [ratePerSqIn, setRatePerSqIn] = useState(1);
  const [rateDraft, setRateDraft] = useState("1");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingRate, setSavingRate] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsError("");
    try {
      const settings = await fetchPrintCalculatorSettings();
      setRatePerSqIn(settings.ratePerSqIn);
      setRateDraft(String(settings.ratePerSqIn));
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
        prev.forEach((a) => {
          if (a.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl);
        });
        return [];
      });
      setDragOver(false);
    }
  }, [open]);

  const totalCost = useMemo(
    () =>
      artworks.reduce(
        (sum, a) => sum + computePrintCost(a.heightInches, a.widthInches, ratePerSqIn),
        0
      ),
    [artworks, ratePerSqIn]
  );

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
        heightInches: ""
      }))
    ]);
  }

  function updateArtwork(id, patch) {
    setArtworks((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeArtwork(id) {
    setArtworks((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  async function handleSaveRate() {
    if (!isAdmin) return;
    setSavingRate(true);
    setSettingsError("");
    try {
      const saved = await savePrintCalculatorRate(rateDraft, userId);
      setRatePerSqIn(saved.ratePerSqIn);
      setRateDraft(String(saved.ratePerSqIn));
    } catch (err) {
      setSettingsError(err?.message || "Could not save rate.");
    } finally {
      setSavingRate(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="size-5" />
            Print calculator
          </DialogTitle>
          <DialogDescription>
            Upload artwork, set print size in inches, and get DTF print cost. Formula: (Height + 1) × (Width + 1) ×
            rate per sq in.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6 pb-2">
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <Label htmlFor="print-calc-rate">Rate per square inch (₹)</Label>
                  <Input
                    id="print-calc-rate"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="max-w-[10rem]"
                    value={rateDraft}
                    onChange={(e) => setRateDraft(e.target.value)}
                    disabled={!isAdmin || loadingSettings || savingRate}
                  />
                  {!isAdmin ? (
                    <p className="text-xs text-muted-foreground">Only admins can change the base rate.</p>
                  ) : null}
                </div>
                {isAdmin ? (
                  <Button type="button" size="sm" onClick={() => void handleSaveRate()} disabled={savingRate || loadingSettings}>
                    {savingRate ? "Saving…" : "Save rate"}
                  </Button>
                ) : null}
              </div>
              {settingsError ? <p className="mt-2 text-sm text-destructive">{settingsError}</p> : null}
              {!loadingSettings ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Current rate: {formatInrAmount(ratePerSqIn)} per sq in · Auto size uses {150} DPI from image pixels.
                </p>
              ) : null}
            </div>

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
              <p className="text-sm font-medium">Drop images here or click to upload</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, WebP supported</p>
            </div>

            {artworks.length ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Artworks ({artworks.length})</h3>
                {artworks.map((artwork) => (
                  <ArtworkCard
                    key={artwork.id}
                    artwork={artwork}
                    ratePerSqIn={ratePerSqIn}
                    onChange={updateArtwork}
                    onRemove={removeArtwork}
                  />
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground">No artworks yet — upload to start calculating.</p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center justify-between border-t px-6 py-4 sm:justify-between">
          <div className="text-left">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total print cost</p>
            <p className="text-2xl font-semibold tabular-nums">{formatInrAmount(totalCost)}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
