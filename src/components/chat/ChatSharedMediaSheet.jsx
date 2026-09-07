import { useEffect, useMemo, useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatFileDownloadButton } from "@/components/chat/ChatMessageMedia";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { classifyConversationMedia } from "@/teamChatMedia";
import { fetchConversationSharedMedia } from "@/teamChatService";
import { formatChatTime, isChatAudioMime } from "@/teamChatUtils";

function EmptyMedia({ text }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

export function ChatSharedMediaSheet({ open, onOpenChange, conversationId, title }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!open || !conversationId) {
      setRows([]);
      setError("");
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchConversationSharedMedia(conversationId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  const media = useMemo(() => classifyConversationMedia(rows), [rows]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-hidden sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Media</SheetTitle>
          <SheetDescription>{title || "Shared in this chat"}</SheetDescription>
        </SheetHeader>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Tabs defaultValue="photos" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="photos">Photos/Videos</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
          </TabsList>

          <TabsContent value="photos" className="min-h-0 flex-1">
            <ScrollArea className="h-[min(60vh,28rem)]">
              {loading ? (
                <EmptyMedia text="Loading…" />
              ) : media.photos.length === 0 ? (
                <EmptyMedia text="No photos or videos yet." />
              ) : (
                <div className="grid grid-cols-3 gap-2 p-1">
                  {media.photos.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1">
                      {item.kind === "video" ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block overflow-hidden rounded-md border bg-muted"
                        >
                          <video src={item.url} className="aspect-square w-full object-cover" muted />
                        </a>
                      ) : (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block overflow-hidden rounded-md border"
                        >
                          <img
                            src={item.url}
                            alt={item.name}
                            loading="lazy"
                            className="aspect-square w-full object-cover"
                          />
                        </a>
                      )}
                      <ChatFileDownloadButton url={item.url} name={item.name} className="self-end" />
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="documents" className="min-h-0 flex-1">
            <ScrollArea className="h-[min(60vh,28rem)]">
              {loading ? (
                <EmptyMedia text="Loading…" />
              ) : media.documents.length === 0 ? (
                <EmptyMedia text="No documents yet." />
              ) : (
                <ul className="flex flex-col gap-2 p-1">
                  {media.documents.map((item) => (
                    <li key={item.id} className="flex items-center gap-1">
                      <Button variant="outline" className="h-auto min-w-0 flex-1 justify-start gap-2 py-2" asChild>
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <FileText />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {isChatAudioMime(item.mime) ? `Voice note · ${item.name}` : item.name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatChatTime(item.createdAt)}
                          </span>
                        </a>
                      </Button>
                      <ChatFileDownloadButton url={item.url} name={item.name} />
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="links" className="min-h-0 flex-1">
            <ScrollArea className="h-[min(60vh,28rem)]">
              {loading ? (
                <EmptyMedia text="Loading…" />
              ) : media.links.length === 0 ? (
                <EmptyMedia text="No links yet." />
              ) : (
                <ul className="flex flex-col gap-2 p-1">
                  {media.links.map((item) => (
                    <li key={item.id}>
                      <Button asChild variant="outline" className="h-auto w-full justify-start gap-2 py-2">
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <Link2 />
                          <span className="min-w-0 flex-1 truncate text-left">{item.url}</span>
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
