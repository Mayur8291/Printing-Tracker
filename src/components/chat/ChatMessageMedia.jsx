import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getChatAttachmentPublicUrl, isChatImageMime } from "@/teamChatUtils";

export function ChatMessageGif({ gifUrl }) {
  const url = (gifUrl ?? "").trim();
  if (!url) return null;

  return (
    <div className="mt-1">
      <img
        src={url}
        alt="GIF"
        loading="lazy"
        className="max-h-56 max-w-full rounded-md border object-cover"
      />
    </div>
  );
}

export function ChatMessageAttachment({ msg, inverted = false }) {
  const path = (msg.attachment_path ?? "").trim();
  if (!path) return null;

  const url = getChatAttachmentPublicUrl(path);
  const name = msg.attachment_name || "Download file";
  const mime = msg.attachment_mime ?? "";

  if (!url) return null;

  if (isChatImageMime(mime)) {
    return (
      <div className="mt-2 space-y-2">
        <a href={url} target="_blank" rel="noopener noreferrer" download={name}>
          <img
            src={url}
            alt={name}
            loading="lazy"
            className="max-h-56 max-w-full rounded-md border object-cover"
          />
        </a>
        <Button
          asChild
          variant="link"
          size="sm"
          className={cn("h-auto px-0", inverted && "text-primary-foreground")}
        >
          <a href={url} download={name} target="_blank" rel="noopener noreferrer">
            Download {name}
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border bg-background/50 px-2 py-1.5">
      <Paperclip className="size-4 shrink-0 opacity-70" aria-hidden />
      <Button asChild variant="link" size="sm" className="h-auto min-w-0 px-0">
        <a href={url} download={name} target="_blank" rel="noopener noreferrer">
          {name}
        </a>
      </Button>
    </div>
  );
}
