import { useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  downloadChatFile,
  getChatAttachmentPublicUrl,
  isChatImageMime,
  isChatVoiceNoteAttachment
} from "@/teamChatUtils";

export function ChatFileDownloadButton({ url, name, inverted = false, className }) {
  const [busy, setBusy] = useState(false);
  const href = String(url ?? "").trim();
  const fileName = String(name ?? "").trim() || "download";
  if (!href) return null;

  async function handleDownload(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await downloadChatFile(href, fileName);
    } catch (err) {
      console.warn("chat file download failed", err);
      window.open(href, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0", inverted && "text-primary-foreground", className)}
      aria-label={`Download ${fileName}`}
      disabled={busy}
      onClick={handleDownload}
    >
      <Download />
    </Button>
  );
}

export function ChatMessageGif({ gifUrl }) {
  const url = (gifUrl ?? "").trim();
  if (!url) return null;

  return (
    <div className="mt-1 flex items-start gap-1" onClick={(e) => e.stopPropagation()}>
      <img
        src={url}
        alt="GIF"
        loading="lazy"
        className="max-h-56 max-w-full rounded-md border object-cover"
      />
      <ChatFileDownloadButton url={url} name="gif.gif" />
    </div>
  );
}

export function ChatMessageAttachment({ msg, inverted = false }) {
  const path = (msg.attachment_path ?? "").trim();
  if (!path) return null;

  const url = getChatAttachmentPublicUrl(path);
  const name = msg.attachment_name || "file";
  const mime = msg.attachment_mime ?? "";

  if (!url) return null;

  if (isChatVoiceNoteAttachment(mime, name)) {
    return (
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <audio
          controls
          preload="metadata"
          src={url}
          className="h-10 w-full min-w-[16rem] max-w-xs"
        >
          <track kind="captions" />
        </audio>
        <ChatFileDownloadButton
          url={url}
          name={name}
          inverted={inverted}
          className="self-end"
        />
      </div>
    );
  }

  if (isChatImageMime(mime)) {
    return (
      <div className="mt-2 flex items-start gap-1" onClick={(e) => e.stopPropagation()}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={name}
            loading="lazy"
            className="max-h-56 max-w-full rounded-md border object-cover"
          />
        </a>
        <ChatFileDownloadButton url={url} name={name} inverted={inverted} />
      </div>
    );
  }

  return (
    <div
      className="mt-2 flex items-center gap-2 rounded-md border bg-background/50 px-2 py-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Paperclip className="size-4 shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <ChatFileDownloadButton url={url} name={name} inverted={inverted} />
    </div>
  );
}
