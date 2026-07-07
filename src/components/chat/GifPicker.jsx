import { useCallback, useEffect, useState } from "react";
import { ImagePlay, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchGiphyTrending, searchGiphyGifs } from "@/giphyGifApi";
import { CHAT_GIF_PRESETS } from "@/teamChatUtils";

export function GifPicker({ onPick, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const runSearch = useCallback(async (q) => {
    setSearching(true);
    setSearchError("");
    try {
      const trimmed = String(q ?? "").trim();
      const rows = trimmed
        ? await searchGiphyGifs(trimmed, { limit: 20 })
        : await fetchGiphyTrending({ limit: 20 });
      setResults(rows);
      if (!rows.length && trimmed) {
        setSearchError("No GIFs found for that search.");
      }
    } catch (err) {
      setResults([]);
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => runSearch(query), 350);
    return () => clearTimeout(timer);
  }, [open, query, runSearch]);

  function handlePick(url) {
    onPick(url);
    setOpen(false);
    setQuery("");
    setSearchError("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Send GIF"
          disabled={disabled}
        >
          <ImagePlay className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <Tabs defaultValue="presets">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="presets">Quick GIFs</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="mt-2">
            <ScrollArea className="h-52">
              <div className="grid grid-cols-2 gap-2 p-1">
                {CHAT_GIF_PRESETS.map((gif) => (
                  <button
                    key={gif.url}
                    type="button"
                    className="overflow-hidden rounded-md border bg-muted/30 transition hover:ring-2 hover:ring-primary/40"
                    title={gif.label}
                    onClick={() => handlePick(gif.url)}
                  >
                    <img src={gif.url} alt={gif.label} className="aspect-video w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="search" className="mt-2 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search GIFs…"
                className="pl-9"
              />
            </div>

            {searchError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                {searchError}
              </p>
            ) : null}

            {searching ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (
              <ScrollArea className="h-44">
                {results.length === 0 && !searchError ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    {query.trim() ? "No results." : "Trending GIFs load here. Type to search."}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 p-1">
                    {results.map((gif) => (
                      <button
                        key={gif.id || gif.url}
                        type="button"
                        className="overflow-hidden rounded-md border bg-muted/30 transition hover:ring-2 hover:ring-primary/40"
                        onClick={() => handlePick(gif.url)}
                      >
                        <img
                          src={gif.preview || gif.url}
                          alt=""
                          className="aspect-video w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
