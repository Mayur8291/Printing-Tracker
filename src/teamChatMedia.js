import { getChatAttachmentPublicUrl, isChatAudioMime, isChatImageMime } from "./teamChatUtils";

const LINK_RE = /https?:\/\/[^\s<>"'`]+/gi;

export function isChatVideoMime(mime) {
  return typeof mime === "string" && mime.startsWith("video/");
}

export function isChatDocumentMime(mime) {
  const value = String(mime ?? "").toLowerCase();
  if (!value) return false;
  if (isChatImageMime(value) || isChatVideoMime(value)) return false;
  return (
    value.includes("pdf") ||
    value.includes("excel") ||
    value.includes("spreadsheet") ||
    value.includes("msword") ||
    value.includes("wordprocessing") ||
    value.includes("presentation") ||
    value.includes("csv") ||
    value.includes("text/") ||
    isChatAudioMime(value) ||
    value.startsWith("application/")
  );
}

export function extractChatLinks(body) {
  const text = String(body ?? "");
  const found = text.match(LINK_RE) ?? [];
  return [...new Set(found.map((url) => url.replace(/[),.;]+$/, "")))];
}

export function classifyConversationMedia(messages) {
  const photos = [];
  const documents = [];
  const links = [];

  for (const msg of messages ?? []) {
    if (!msg || msg.deleted_at) continue;
    const createdAt = msg.created_at;
    const gifUrl = (msg.gif_url ?? "").trim();
    if (gifUrl) {
      photos.push({
        id: `gif-${msg.id}`,
        messageId: msg.id,
        kind: "gif",
        url: gifUrl,
        name: "GIF",
        createdAt
      });
    }

    const path = (msg.attachment_path ?? "").trim();
    const mime = msg.attachment_mime ?? "";
    const url = path ? getChatAttachmentPublicUrl(path) : "";
    if (path && url) {
      const item = {
        id: `file-${msg.id}`,
        messageId: msg.id,
        url,
        name: msg.attachment_name || "File",
        mime,
        createdAt
      };
      if (isChatImageMime(mime) || isChatVideoMime(mime)) {
        photos.push({ ...item, kind: isChatVideoMime(mime) ? "video" : "photo" });
      } else {
        documents.push({ ...item, kind: "document" });
      }
    }

    for (const href of extractChatLinks(msg.body)) {
      links.push({
        id: `link-${msg.id}-${href}`,
        messageId: msg.id,
        kind: "link",
        url: href,
        name: href,
        createdAt
      });
    }
  }

  return { photos, documents, links };
}
