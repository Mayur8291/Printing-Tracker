import { supabase } from "./supabaseClient";
import {
  CHAT_ATTACHMENT_BUCKET,
  authorLabelForInsert,
  sanitizeChatFileName,
  validateChatAttachmentFile
} from "./teamChatUtils";

const MESSAGE_SELECT =
  "id, conversation_id, body, author_id, mentioned_user_ids, mentioned_order_ids, created_at, author_label, attachment_path, attachment_name, attachment_mime, attachment_size, gif_url, reply_to_message_id, forwarded_from_message_id, deleted_at, pinned_at";

const CONVERSATION_SELECT = "id, kind, title, created_by, last_message_at, created_at";

export async function fetchMyConversations(userId) {
  if (!userId) return [];

  const { data: memberships, error: memErr } = await supabase
    .from("team_chat_conversation_members")
    .select(`conversation_id, last_read_at, conversation:team_chat_conversations(${CONVERSATION_SELECT})`)
    .eq("user_id", userId);

  if (memErr) throw new Error(memErr.message);

  const convIds = [...new Set((memberships ?? []).map((m) => m.conversation_id).filter(Boolean))];
  if (!convIds.length) return [];

  const [{ data: members, error: membersErr }, { data: lastMessages, error: msgErr }] = await Promise.all([
    supabase
      .from("team_chat_conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", convIds),
    supabase
      .from("team_chat_messages")
      .select("id, conversation_id, body, author_id, created_at, attachment_path, gif_url, deleted_at")
      .in("conversation_id", convIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
  ]);

  if (membersErr) throw new Error(membersErr.message);
  if (msgErr) throw new Error(msgErr.message);

  const membersByConv = new Map();
  for (const row of members ?? []) {
    const list = membersByConv.get(row.conversation_id) ?? [];
    list.push(row.user_id);
    membersByConv.set(row.conversation_id, list);
  }

  const lastByConv = new Map();
  const unreadByConv = new Map();
  for (const msg of lastMessages ?? []) {
    if (!lastByConv.has(msg.conversation_id)) {
      lastByConv.set(msg.conversation_id, msg);
    }
  }

  const readMap = new Map((memberships ?? []).map((m) => [m.conversation_id, m.last_read_at]));

  for (const msg of lastMessages ?? []) {
    const lastRead = readMap.get(msg.conversation_id);
    if (!isUnopenedTextMessage(msg, userId, lastRead)) continue;
    unreadByConv.set(msg.conversation_id, (unreadByConv.get(msg.conversation_id) ?? 0) + 1);
  }

  return convIds
    .map((id) => {
      const conv = memberships.find((m) => m.conversation_id === id)?.conversation;
      if (!conv) return null;
      const last = lastByConv.get(id) ?? null;
      return {
        ...conv,
        member_ids: membersByConv.get(id) ?? [],
        last_message: last,
        unread_count: unreadByConv.get(id) ?? 0
      };
    })
    .filter(Boolean)
    .filter((conv) => {
      if (conv.kind !== "direct") return true;
      if (conv.last_message) return true;
      return false;
    })
    .sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
}

export async function getOrCreateDirectConversation(otherUserId) {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_other_user_id: otherUserId
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function createGroupConversation(title, memberIds) {
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_title: title,
    p_member_ids: memberIds ?? []
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchConversationMessages(conversationId, limit = 200) {
  const { data, error } = await supabase
    .from("team_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  if (!ids.length) return rows;

  const { data: reactions, error: reactErr } = await supabase
    .from("team_chat_message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", ids);
  if (reactErr) throw new Error(reactErr.message);

  const byMessage = new Map();
  for (const row of reactions ?? []) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }

  return rows.map((row) => ({
    ...row,
    reactions: summarizeReactions(byMessage.get(row.id) ?? [])
  }));
}

export function summarizeReactions(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const userIds = map.get(row.emoji) ?? [];
    userIds.push(row.user_id);
    map.set(row.emoji, userIds);
  }
  return [...map.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId
  });
  if (error) throw new Error(error.message);
}

export function conversationsWithRead(conversations, conversationId) {
  if (!conversationId) return conversations ?? [];
  return (conversations ?? []).map((row) =>
    row.id === conversationId ? { ...row, unread_count: 0 } : row
  );
}

export async function uploadChatAttachment(sessionUserId, file) {
  const validationError = validateChatAttachmentFile(file);
  if (validationError) throw new Error(validationError);

  const uploadId = crypto.randomUUID();
  const safeName = sanitizeChatFileName(file.name);
  const storagePath = `${sessionUserId}/${uploadId}/${safeName}`;
  const { error: uploadErr } = await supabase.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined
    });
  if (uploadErr) throw new Error(uploadErr.message);

  return {
    attachment_path: storagePath,
    attachment_name: safeName,
    attachment_mime: file.type || null,
    attachment_size: file.size
  };
}

export async function sendChatMessage({
  conversationId,
  sessionUserId,
  currentUserProfile,
  body,
  mentionedUserIds,
  mentionedOrderIds,
  attachmentFields = {},
  gifUrl = null,
  replyToMessageId = null,
  forwardedFromMessageId = null
}) {
  const payload = {
    conversation_id: conversationId,
    author_id: sessionUserId,
    body: body || "",
    mentioned_user_ids: mentionedUserIds ?? [],
    mentioned_order_ids: mentionedOrderIds ?? [],
    author_label: authorLabelForInsert(currentUserProfile ?? {}),
    gif_url: gifUrl || null,
    reply_to_message_id: replyToMessageId || null,
    forwarded_from_message_id: forwardedFromMessageId || null,
    ...attachmentFields
  };

  const { error: insertErr } = await supabase.from("team_chat_messages").insert(payload);
  if (insertErr) throw new Error(insertErr.message);

  await supabase
    .from("team_chat_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  await markConversationRead(conversationId);
}

export async function softDeleteChatMessages(messageIds) {
  const ids = (messageIds ?? []).filter((id) => id != null);
  if (!ids.length) return 0;
  const { data, error } = await supabase.rpc("soft_delete_team_chat_messages", { p_ids: ids });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

export async function toggleChatMessagePin(messageId) {
  const { data, error } = await supabase.rpc("toggle_team_chat_message_pin", { p_id: messageId });
  if (error) throw new Error(error.message);
  return data;
}

export async function setChatMessageReaction(messageId, emoji) {
  const { data, error } = await supabase.rpc("set_team_chat_message_reaction", {
    p_id: messageId,
    p_emoji: emoji
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function forwardChatMessages({
  conversationId,
  sessionUserId,
  currentUserProfile,
  messages
}) {
  const live = (messages ?? []).filter((msg) => !msg.deleted_at);
  if (!conversationId || !live.length) return;

  for (const msg of live) {
    const attachmentFields =
      msg.attachment_path
        ? {
            attachment_path: msg.attachment_path,
            attachment_name: msg.attachment_name,
            attachment_mime: msg.attachment_mime,
            attachment_size: msg.attachment_size
          }
        : {};
    await sendChatMessage({
      conversationId,
      sessionUserId,
      currentUserProfile,
      body: msg.body || "",
      mentionedUserIds: msg.mentioned_user_ids ?? [],
      mentionedOrderIds: msg.mentioned_order_ids ?? [],
      attachmentFields,
      gifUrl: msg.gif_url || null,
      forwardedFromMessageId: msg.id
    });
  }
}

export function isUnopenedTextMessage(msg, userId, lastReadAt) {
  if (!msg || msg.deleted_at) return false;
  if (msg.author_id === userId) return false;
  if (!String(msg.body ?? "").trim()) return false;
  if (lastReadAt && new Date(msg.created_at) <= new Date(lastReadAt)) return false;
  return true;
}

export function unreadTextCountByInboxTab(conversations) {
  let chats = 0;
  let groups = 0;
  for (const row of conversations ?? []) {
    const n = Number(row.unread_count) || 0;
    if (row.kind === "direct") chats += n;
    else if (row.kind === "group") groups += n;
  }
  return { chats, groups, channels: 0 };
}

export function conversationPreviewText(message) {
  if (!message) return "No messages yet";
  if (message.gif_url) return "GIF";
  if (message.attachment_path) {
    const mime = message.attachment_mime ?? "";
    if (mime.startsWith("image/")) return "Photo";
    return "Attachment";
  }
  const body = String(message.body ?? "").trim();
  return body.length > 60 ? `${body.slice(0, 60)}…` : body || "Message";
}
