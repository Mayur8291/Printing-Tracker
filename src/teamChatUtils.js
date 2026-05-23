import { supabase } from "./supabaseClient";

/** Common emojis for the in-app picker (no extra dependency). */
export const CHAT_EMOJI_PALETTE = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤔", "😅",
  "👍", "👎", "🙏", "👏", "🙌", "💪", "✅", "❌", "⚠️", "🔥",
  "⭐", "🎉", "📦", "🖨️", "🧵", "📋", "⏰", "📞", "💬", "❤️"
];

export const CHAT_ATTACHMENT_BUCKET = "team-chat-files";
export const CHAT_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export const CHAT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf"
]);

const UNNAMED_DISPLAY = "Unnamed";
const ADMIN_DISPLAY = "Admin";

export function isAdminProfile(profile) {
  return (profile?.role ?? "").trim().toLowerCase() === "admin";
}

/** Admin-set display name only (profiles.full_name). Never email. */
export function profileDisplayName(profile) {
  const name = (profile?.full_name ?? "").trim();
  return name || "";
}

function chatFallbackLabel(profile) {
  if (isAdminProfile(profile)) return ADMIN_DISPLAY;
  return UNNAMED_DISPLAY;
}

/** Label for chat UI and @mentions — display name or fallback. */
export function profileChatLabel(profile) {
  const name = profileDisplayName(profile);
  if (name) return name;
  return chatFallbackLabel(profile);
}

export function messageAuthorDisplayName(msg, authorProfile) {
  const fromProfile = profileDisplayName(authorProfile);
  if (fromProfile) return fromProfile;
  const stored = (msg?.author_label ?? "").trim();
  if (stored && !stored.includes("@")) return stored;
  return chatFallbackLabel(authorProfile ?? {});
}

export function authorLabelForInsert(profile) {
  const name = profileDisplayName(profile);
  if (name) return name;
  if (isAdminProfile(profile)) return ADMIN_DISPLAY;
  return null;
}

export function profileMentionable(profile) {
  return Boolean(profileDisplayName(profile) || isAdminProfile(profile));
}

export function orderChatToken(order) {
  const oid = (order?.order_id ?? "").trim();
  if (oid) return oid;
  return String(order?.id ?? "");
}

export function formatChatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function sanitizeChatFileName(name) {
  const base = (name ?? "file").replace(/[/\\?%*:|"<>]/g, "_").trim() || "file";
  return base.slice(0, 180);
}

export function getChatAttachmentPublicUrl(storagePath) {
  if (!storagePath?.trim()) return "";
  const { data } = supabase.storage.from(CHAT_ATTACHMENT_BUCKET).getPublicUrl(storagePath.trim());
  return data?.publicUrl ?? "";
}

export function isChatImageMime(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}

export function validateChatAttachmentFile(file) {
  if (!file) return "No file selected";
  if (!CHAT_ALLOWED_MIME_TYPES.has(file.type)) {
    return "Only images (JPEG, PNG, WebP, GIF) and PDF are allowed";
  }
  if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
    return "File must be 15 MB or smaller";
  }
  return null;
}

/** Detect active @ or # mention query at cursor. */
export function getActiveMentionQuery(text, cursorIndex) {
  const before = text.slice(0, cursorIndex);
  const at = before.lastIndexOf("@");
  const hash = before.lastIndexOf("#");
  const pick = (start, type) => {
    if (start < 0) return null;
    const fragment = before.slice(start + 1);
    if (fragment.includes("\n")) return null;
    if (type === "order" && fragment.includes(" ")) return null;
    if (type === "user" && /\s{2,}/.test(fragment)) return null;
    const wordStart = start === 0 || /\s/.test(before[start - 1]);
    if (!wordStart) return null;
    return { type, query: fragment, start, end: cursorIndex };
  };
  const atM = pick(at, "user");
  const hashM = pick(hash, "order");
  if (!atM && !hashM) return null;
  if (!atM) return hashM;
  if (!hashM) return atM;
  return atM.start > hashM.start ? atM : hashM;
}

export function filterMentionUsers(profiles, query, excludeUserId) {
  const q = (query ?? "").trim().toLowerCase();
  return (profiles ?? [])
    .filter((p) => p.id !== excludeUserId)
    .filter((p) => profileMentionable(p))
    .filter((p) => {
      if (!q) return true;
      return profileDisplayName(p).toLowerCase().includes(q);
    })
    .slice(0, 12);
}

export function filterMentionOrders(orders, query) {
  const q = (query ?? "").trim().toLowerCase();
  return (orders ?? [])
    .filter((o) => !o.is_complete)
    .filter((o) => {
      if (!q) return true;
      const oid = (o.order_id ?? "").toLowerCase();
      const idStr = String(o.id);
      const customer = (o.customer_name ?? "").toLowerCase();
      return oid.includes(q) || idStr.includes(q) || customer.includes(q);
    })
    .slice(0, 12);
}

export function extractMentionsFromBody(body, profiles, orders) {
  const mentionedUserIds = new Set();
  const mentionedOrderIds = new Set();
  const text = body ?? "";

  for (const profile of profiles ?? []) {
    const label = profileChatLabel(profile);
    if (label && label !== UNNAMED_DISPLAY && text.includes(`@${label}`)) {
      mentionedUserIds.add(profile.id);
    }
  }

  const hashRe = /#([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = hashRe.exec(text)) !== null) {
    const token = m[1];
    const byOrderId = (orders ?? []).find(
      (o) => (o.order_id ?? "").trim().toLowerCase() === token.toLowerCase()
    );
    if (byOrderId) {
      mentionedOrderIds.add(byOrderId.id);
      continue;
    }
    if (/^\d+$/.test(token)) {
      const byId = (orders ?? []).find((o) => String(o.id) === token);
      if (byId) mentionedOrderIds.add(byId.id);
    }
  }

  return {
    mentionedUserIds: [...mentionedUserIds],
    mentionedOrderIds: [...mentionedOrderIds]
  };
}

const TOKEN_RE = /(@[^\s#]+(?:\s+[^\s#]+)?|#[A-Za-z0-9_-]+)/g;

export function splitChatBodyTokens(body) {
  const parts = [];
  let last = 0;
  const text = body ?? "";
  for (const match of text.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) parts.push({ kind: "text", value: text.slice(last, idx) });
    parts.push({ kind: "token", value: match[0] });
    last = idx + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  if (!parts.length && text) parts.push({ kind: "text", value: text });
  return parts;
}
