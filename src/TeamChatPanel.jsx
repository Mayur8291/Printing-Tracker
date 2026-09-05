import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ClipboardPaste, Forward, Hash, Paperclip, Pin, Send, Smile, UsersRound, X } from "lucide-react";
import { groupAvatarPublicUrl, profileAvatarPublicUrl } from "@/avatarUtils";
import { supabase } from "./supabaseClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChatMessageBody } from "@/components/chat/ChatMessageBody";
import { ChatMessageAttachment, ChatMessageGif } from "@/components/chat/ChatMessageMedia";
import { ChatForwardDialog } from "@/components/chat/ChatForwardDialog";
import { ChatGroupDetailsSheet } from "@/components/chat/ChatGroupDetailsSheet";
import { ChatGroupViewersDialog } from "@/components/chat/ChatGroupViewersDialog";
import { ChatSharedMediaSheet } from "@/components/chat/ChatSharedMediaSheet";
import { ChatMessageActionBar } from "@/components/chat/ChatMessageActionBar";
import { ChatMessageTicks } from "@/components/chat/ChatMessageTicks";
import { ChatVoiceControls } from "@/components/chat/ChatVoiceControls";
import { CreateChannelDialog } from "@/components/chat/CreateChannelDialog";
import { CreateGroupDialog } from "@/components/chat/CreateGroupDialog";
import { GifPicker } from "@/components/chat/GifPicker";
import { NewDirectChatDialog } from "@/components/chat/NewDirectChatDialog";
import {
  clipboardTextForMessages,
  conversationPreviewText,
  createChannelConversation,
  createGroupConversation,
  fetchConversationMessages,
  fetchMyConversations,
  getOrCreateDirectConversation,
  markConversationRead,
  conversationsWithRead,
  applyMemberReads,
  fetchConversationMemberReads,
  mergeMemberRead,
  forwardChatMessages,
  sendChatMessage,
  setChatMessageReaction,
  softDeleteChatMessages,
  toggleChatMessagePin,
  unreadTextCountByInboxTab,
  uploadChatAttachment
} from "./teamChatService";
import {
  CHAT_EMOJI_PALETTE,
  conversationDisplayTitle,
  extractMentionsFromBody,
  filterMentionOrders,
  filterMentionUsers,
  formatChatTime,
  getActiveMentionQuery,
  isAdminProfile,
  isConversationGroupAdmin,
  isChatAudioMime,
  messageAuthorDisplayName,
  orderChatToken,
  profileChatLabel,
  profileMentionable,
  validateChatAttachmentFile
} from "./teamChatUtils";
import { setTeamChatViewState, sumConversationUnread } from "./teamChatNotificationUtils";
import { groupMessageViewerLists, outgoingReceiptStatus } from "./teamChatReceipts";
import { presenceLabel, usePresenceByUserId } from "./dashboardPresence";

const CHAT_INBOX_TABS = [
  { id: "chats", label: "Chats" },
  { id: "groups", label: "Groups" },
  { id: "channels", label: "Channels" }
];

const INBOX_PANE_CLASS =
  "mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col";

const COMPOSER_MAX_LINES = 5;

function fitComposerTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  const styles = window.getComputedStyle(el);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
  const paddingY =
    Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const maxHeight = lineHeight * COMPOSER_MAX_LINES + paddingY;
  const next = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${Math.max(next, lineHeight + paddingY)}px`;
}

function InboxPane({ title, action, children }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-3">
        <h2 className="mr-auto text-base font-semibold">{title}</h2>
        {action}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col">{children}</div>
      </ScrollArea>
    </div>
  );
}

function ConversationListItem({ conversation, sessionUserId, teamProfiles, active, onSelect, presence }) {
  const title = conversationDisplayTitle(conversation, sessionUserId, teamProfiles);
  const preview = conversationPreviewText(conversation.last_message);
  const isGroup = conversation.kind === "group";
  const isChannel = conversation.kind === "channel";
  const isNamedRoom = isGroup || isChannel;
  const unread = (conversation.unread_count ?? 0) > 0;
  const peerId = !isNamedRoom
    ? (conversation.member_ids ?? []).find((id) => id !== sessionUserId)
    : null;
  const peer = peerId ? teamProfiles.find((p) => p.id === peerId) : null;
  const avatarUrl = isGroup
    ? groupAvatarPublicUrl(conversation.avatar_path)
    : peer
      ? profileAvatarPublicUrl(peer.avatar_path)
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={cn(
        "flex w-full items-start gap-3 border-b px-3 py-3 text-left transition hover:bg-accent/60",
        active && "bg-accent",
        unread &&
          !active &&
          "border-l-[3px] border-l-primary bg-primary/10 hover:bg-primary/15",
        unread && "shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]"
      )}
    >
      {isNamedRoom ? (
        isGroup && avatarUrl ? (
          <PersonAvatar name={title} imageUrl={avatarUrl} size="md" className="shrink-0" />
        ) : (
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {isChannel ? <Hash className="size-5" /> : <UsersRound className="size-5" />}
          </div>
        )
      ) : (
        <PersonAvatar
          name={peer?.full_name || title}
          email={peer?.email}
          imageUrl={avatarUrl}
          size="md"
          className="shrink-0"
          presence={presence ?? "offline"}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate", unread ? "font-semibold text-foreground" : "font-medium")}>
            {title}
          </span>
          {conversation.last_message?.created_at ? (
            <time
              className={cn(
                "shrink-0 text-[11px]",
                unread ? "font-semibold text-primary" : "text-muted-foreground"
              )}
              dateTime={conversation.last_message.created_at}
            >
              {formatChatTime(conversation.last_message.created_at)}
            </time>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-xs",
              unread ? "font-medium text-foreground/90" : "text-muted-foreground"
            )}
          >
            {preview}
          </span>
          {unread ? (
            <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
              {conversation.unread_count}
            </Badge>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function insertAtCursor(text, start, end, insert) {
  return `${text.slice(0, start)}${insert}${text.slice(end)}`;
}

export default function TeamChatPanel({
  sessionUserId,
  currentUserProfile,
  teamProfiles,
  orders,
  onOpenOrder,
  onUnreadTotalChange
}) {
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingGifUrl, setPendingGifUrl] = useState("");
  const [pendingAudioUrl, setPendingAudioUrl] = useState("");
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [error, setError] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [composeDirectPeerId, setComposeDirectPeerId] = useState(null);
  const [inboxTab, setInboxTab] = useState("chats");
  const [selectedMessageIds, setSelectedMessageIds] = useState(() => new Set());
  const [replyTo, setReplyTo] = useState(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const presenceByUserId = usePresenceByUserId();

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const directConversations = useMemo(
    () => conversations.filter((c) => c.kind === "direct"),
    [conversations]
  );

  const groupConversations = useMemo(
    () => conversations.filter((c) => c.kind === "group"),
    [conversations]
  );

  const channelConversations = useMemo(
    () => conversations.filter((c) => c.kind === "channel"),
    [conversations]
  );

  const isChatAdmin = isAdminProfile(currentUserProfile);
  const isChannelThread = activeConversation?.kind === "channel";
  const channelReadOnly = isChannelThread && !isChatAdmin;

  const inboxTabUnread = useMemo(
    () => unreadTextCountByInboxTab(conversations),
    [conversations]
  );

  const composeDirectPeer = useMemo(
    () => (composeDirectPeerId ? teamProfiles.find((p) => p.id === composeDirectPeerId) ?? null : null),
    [teamProfiles, composeDirectPeerId]
  );

  const threadPeerId = useMemo(() => {
    if (composeDirectPeerId) return composeDirectPeerId;
    if (activeConversation?.kind !== "direct") return null;
    return (activeConversation.member_ids ?? []).find((id) => id !== sessionUserId) ?? null;
  }, [composeDirectPeerId, activeConversation, sessionUserId]);

  const threadPresence = threadPeerId ? (presenceByUserId[threadPeerId] ?? "offline") : null;

  const threadTitle = useMemo(() => {
    if (composeDirectPeer) return profileChatLabel(composeDirectPeer);
    return conversationDisplayTitle(activeConversation, sessionUserId, teamProfiles);
  }, [composeDirectPeer, activeConversation, sessionUserId, teamProfiles]);

  const showThread =
    inboxTab === "chats"
      ? Boolean(composeDirectPeerId || activeConversation?.kind === "direct")
      : inboxTab === "groups"
        ? Boolean(activeConversation?.kind === "group") && !composeDirectPeerId
        : inboxTab === "channels"
          ? Boolean(isChannelThread) && !composeDirectPeerId
          : false;

  const canCompose = showThread && !channelReadOnly;
  const isActiveGroupAdmin = isConversationGroupAdmin(activeConversation, sessionUserId);
  const canOpenThreadDetails =
    activeConversation?.kind === "group" ||
    activeConversation?.kind === "direct" ||
    Boolean(composeDirectPeerId);
  const canOpenSharedMedia =
    Boolean(activeConversationId) &&
    (activeConversation?.kind === "group" || activeConversation?.kind === "direct");

  const selectedMessages = useMemo(
    () => messages.filter((msg) => selectedMessageIds.has(msg.id) && !msg.deleted_at),
    [messages, selectedMessageIds]
  );

  const selectedSingle = selectedMessages.length === 1 ? selectedMessages[0] : null;
  const showGroupViewers =
    Boolean(selectedSingle) &&
    selectedSingle.author_id === sessionUserId &&
    activeConversation?.kind === "group";
  const groupViewerLists = useMemo(
    () =>
      selectedSingle && activeConversation?.kind === "group"
        ? groupMessageViewerLists({
            createdAt: selectedSingle.created_at,
            authorId: selectedSingle.author_id,
            memberReads: activeConversation.member_reads,
            teamProfiles
          })
        : { seen: [], unseen: [] },
    [selectedSingle, activeConversation, teamProfiles]
  );
  const canDeleteSelected = isChannelThread && isChatAdmin
    ? selectedMessages.length > 0
    : selectedMessages.some((msg) => msg.author_id === sessionUserId);

  const messageById = useMemo(() => {
    const map = new Map();
    for (const msg of messages) map.set(msg.id, msg);
    return map;
  }, [messages]);

  const activeMention = useMemo(() => getActiveMentionQuery(draft, cursor), [draft, cursor]);

  const mentionUsers = useMemo(() => {
    if (!activeMention || activeMention.type !== "user") return [];
    return filterMentionUsers(teamProfiles, activeMention.query, sessionUserId);
  }, [activeMention, teamProfiles, sessionUserId]);

  const mentionOrders = useMemo(() => {
    if (!activeMention || activeMention.type !== "order") return [];
    return filterMentionOrders(orders, activeMention.query);
  }, [activeMention, orders]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, []);

  const loadConversations = useCallback(async () => {
    if (!sessionUserId) return [];
    try {
      const rows = await fetchMyConversations(sessionUserId);
      setConversations(rows);
      onUnreadTotalChange?.(sumConversationUnread(rows));
      setError("");
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoadingConversations(false);
    }
  }, [sessionUserId, onUnreadTotalChange]);

  const markConversationAsRead = useCallback(
    async (conversationId) => {
      if (!conversationId) return;
      await markConversationRead(conversationId);
      setConversations((prev) => {
        const next = conversationsWithRead(prev, conversationId);
        onUnreadTotalChange?.(sumConversationUnread(next));
        return next;
      });
    },
    [onUnreadTotalChange]
  );

  const loadMessages = useCallback(
    async (conversationId) => {
      if (!conversationId) {
        setMessages([]);
        return;
      }
      setLoadingMessages(true);
      try {
        const rows = await fetchConversationMessages(conversationId);
        const profileMap = new Map((teamProfiles ?? []).map((p) => [p.id, p]));
        const enriched = rows.map((row) => ({
          ...row,
          author: profileMap.get(row.author_id) ?? {
            id: row.author_id,
            full_name: null,
            email: null
          }
        }));
        setMessages(enriched);
        await markConversationAsRead(conversationId);
        setError("");
        requestAnimationFrame(scrollToBottom);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingMessages(false);
      }
    },
    [scrollToBottom, teamProfiles, markConversationAsRead]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (composeDirectPeerId) return;
    if (activeConversationId) return;
    const firstDirect = conversations.find((c) => c.kind === "direct");
    if (firstDirect) setActiveConversationId(firstDirect.id);
  }, [conversations, activeConversationId, composeDirectPeerId]);

  useEffect(() => {
    setSelectedMessageIds(new Set());
    setReplyTo(null);
    setReactOpen(false);
    setForwardOpen(false);
    setViewersOpen(false);
    setGroupDetailsOpen(false);
    setMediaOpen(false);
  }, [activeConversationId, inboxTab]);

  useEffect(() => {
    if (composeDirectPeerId) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }
    if (activeConversationId) {
      loadMessages(activeConversationId);
    }
  }, [activeConversationId, composeDirectPeerId, loadMessages]);

  useEffect(() => {
    setTeamChatViewState({ panelVisible: true, conversationId: activeConversationId });
    return () => setTeamChatViewState({ panelVisible: false, conversationId: null });
  }, [activeConversationId]);

  useEffect(() => {
    if (!sessionUserId) return undefined;

    const channel = supabase
      .channel(`team-chat-${sessionUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_chat_messages" },
        async (payload) => {
          const convId = payload.new?.conversation_id ?? payload.old?.conversation_id;
          const newMsg = payload.new;
          if (
            payload.eventType === "INSERT" &&
            convId &&
            convId === activeConversationId &&
            newMsg?.author_id &&
            newMsg.author_id !== sessionUserId
          ) {
            await markConversationAsRead(convId);
          }
          await loadConversations();
          if (convId && convId === activeConversationId) {
            await loadMessages(convId);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_chat_conversations" },
        () => loadConversations()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_chat_message_reactions" },
        async () => {
          if (activeConversationId) await loadMessages(activeConversationId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_chat_conversation_members"
        },
        (payload) => {
          const row = payload.new ?? payload.old;
          if (payload.eventType === "DELETE") {
            void loadConversations();
            if (
              row?.user_id &&
              sessionUserId &&
              String(row.user_id) === String(sessionUserId) &&
              row.conversation_id === activeConversationId
            ) {
              setGroupDetailsOpen(false);
              setActiveConversationId(null);
            }
            return;
          }
          if (row?.conversation_id && row?.user_id) {
            setConversations((prev) => mergeMemberRead(prev, row));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, activeConversationId, loadConversations, loadMessages, markConversationAsRead]);

  useEffect(() => {
    const kind = activeConversation?.kind;
    if (!activeConversationId || (kind !== "direct" && kind !== "group")) return undefined;

    let cancelled = false;

    async function refreshReads() {
      try {
        const reads = await fetchConversationMemberReads(activeConversationId);
        if (cancelled) return;
        setConversations((prev) => applyMemberReads(prev, activeConversationId, reads));
      } catch (err) {
        console.warn("team chat member reads refresh failed", err);
      }
    }

    void refreshReads();
    const timer = window.setInterval(() => {
      void refreshReads();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeConversationId, activeConversation?.kind]);

  useEffect(() => {
    if (!activeConversationId || composeDirectPeerId) return undefined;

    void markConversationRead(activeConversationId).catch((err) => {
      console.warn("team chat mark read heartbeat failed", err);
    });
    const timer = window.setInterval(() => {
      void markConversationRead(activeConversationId).catch((err) => {
        console.warn("team chat mark read heartbeat failed", err);
      });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [activeConversationId, composeDirectPeerId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (!pendingFile || !isChatAudioMime(pendingFile.type)) {
      setPendingAudioUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  useLayoutEffect(() => {
    fitComposerTextarea(textareaRef.current);
  }, [draft]);

  function selectConversation(id) {
    const conv = conversations.find((c) => c.id === id);
    if (conv?.kind === "group") setInboxTab("groups");
    else if (conv?.kind === "channel") setInboxTab("channels");
    else if (conv?.kind === "direct") setInboxTab("chats");
    setComposeDirectPeerId(null);
    setConversations((prev) => {
      const next = conversationsWithRead(prev, id);
      onUnreadTotalChange?.(sumConversationUnread(next));
      return next;
    });
    setActiveConversationId(id);
    setMobileShowThread(true);
    setDraft("");
    setPendingFile(null);
    setPendingGifUrl("");
  }

  function startDirectChat(otherUserId) {
    setInboxTab("chats");
    setComposeDirectPeerId(otherUserId);
    setActiveConversationId(null);
    setMessages([]);
    setMobileShowThread(true);
    setDraft("");
    setPendingFile(null);
    setPendingGifUrl("");
    setError("");
  }

  function exitThreadView() {
    setMobileShowThread(false);
    setComposeDirectPeerId(null);
  }

  async function handleCreateGroup(title, memberIds) {
    const convId = await createGroupConversation(title, memberIds);
    await loadConversations();
    setInboxTab("groups");
    selectConversation(convId);
    return convId;
  }

  async function handleCreateChannel(title) {
    const convId = await createChannelConversation(title);
    await loadConversations();
    setInboxTab("channels");
    selectConversation(convId);
    return convId;
  }

  function clearMessageSelection() {
    setSelectedMessageIds(new Set());
    setReactOpen(false);
    setViewersOpen(false);
  }

  function toggleMessageSelected(message) {
    if (!message?.id || message.deleted_at) return;
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  }

  function handleReplySelected() {
    if (!selectedSingle) return;
    setReplyTo(selectedSingle);
    clearMessageSelection();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleCopySelected() {
    const text = clipboardTextForMessages(selectedMessages);
    if (!text) {
      setError("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy. Allow clipboard access.");
    }
  }

  async function handlePasteIntoComposer() {
    if (sending || voiceRecording) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const el = textareaRef.current;
      const start = el?.selectionStart ?? cursor;
      const end = el?.selectionEnd ?? start;
      const next = insertAtCursor(draft, start, end, text);
      setDraft(next);
      const pos = start + text.length;
      setCursor(pos);
      setError("");
      requestAnimationFrame(() => {
        const box = textareaRef.current;
        if (!box) return;
        box.focus();
        box.setSelectionRange(pos, pos);
        fitComposerTextarea(box);
      });
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Allow clipboard to paste, or use Ctrl+V"
          : "Could not paste. Use Ctrl+V"
      );
    }
  }

  async function handleReactToMessage(messageId, emoji) {
    try {
      await setChatMessageReaction(messageId, emoji);
      setReactOpen(false);
      if (activeConversationId) await loadMessages(activeConversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteSelected() {
    const ownIds = selectedMessages
      .filter((msg) => msg.author_id === sessionUserId)
      .map((msg) => msg.id);
    if (!ownIds.length) return;
    try {
      await softDeleteChatMessages(ownIds);
      clearMessageSelection();
      if (replyTo && ownIds.includes(replyTo.id)) setReplyTo(null);
      if (activeConversationId) {
        await loadMessages(activeConversationId);
        await loadConversations();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePinSelected() {
    if (!selectedSingle) return;
    try {
      await toggleChatMessagePin(selectedSingle.id);
      if (activeConversationId) await loadMessages(activeConversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleForwardTo(conversationId) {
    try {
      await forwardChatMessages({
        conversationId,
        sessionUserId,
        currentUserProfile,
        messages: selectedMessages
      });
      setForwardOpen(false);
      clearMessageSelection();
      await loadConversations();
      if (conversationId === activeConversationId) await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function syncCursorFromTextarea() {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart ?? draft.length);
  }

  function applyMentionInsert(insertText) {
    if (!activeMention) return;
    const next = insertAtCursor(draft, activeMention.start, activeMention.end, insertText);
    setDraft(next);
    const pos = activeMention.start + insertText.length;
    setCursor(pos);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function pickUser(profile) {
    applyMentionInsert(`@${profileChatLabel(profile)} `);
  }

  function pickOrder(order) {
    applyMentionInsert(`#${orderChatToken(order)} `);
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAtCursor(draft, start, end, emoji);
    setDraft(next);
    setEmojiOpen(false);
    el?.focus();
  }

  function onPickAttachment(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const validationError = validateChatAttachmentFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setPendingFile(file);
    setPendingGifUrl("");
  }

  function onPickGif(url) {
    setPendingGifUrl(url);
    setPendingFile(null);
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!canCompose) return;
    const body = draft.trim();
    const hasContent = Boolean(body || pendingFile || pendingGifUrl);
    if (!hasContent || sending) return;
    if (!activeConversationId && !composeDirectPeerId) return;

    const { mentionedUserIds, mentionedOrderIds } = extractMentionsFromBody(
      body,
      teamProfiles,
      orders
    );

    setSending(true);
    setError("");

    try {
      let conversationId = activeConversationId;
      if (!conversationId && composeDirectPeerId) {
        conversationId = await getOrCreateDirectConversation(composeDirectPeerId);
        setComposeDirectPeerId(null);
        setActiveConversationId(conversationId);
      }

      let attachmentFields = {};
      if (pendingFile) {
        attachmentFields = await uploadChatAttachment(sessionUserId, pendingFile);
      }

      await sendChatMessage({
        conversationId,
        sessionUserId,
        currentUserProfile,
        body,
        mentionedUserIds,
        mentionedOrderIds,
        attachmentFields,
        gifUrl: pendingGifUrl || null,
        replyToMessageId: replyTo?.id ?? null
      });

      setDraft("");
      setCursor(0);
      setPendingFile(null);
      setPendingGifUrl("");
      setEmojiOpen(false);
      setReplyTo(null);
      setSelectedMessageIds(new Set());
      await loadConversations();
      await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const showUserMenu = activeMention?.type === "user";
  const showOrderMenu = activeMention?.type === "order";
  const canSend =
    canCompose &&
    Boolean(draft.trim() || pendingFile || pendingGifUrl) &&
    !sending &&
    !voiceRecording &&
    Boolean(activeConversationId || composeDirectPeerId);

  function handleComposerKeyDown(e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (canSend) {
      void handleSend(e);
    }
  }

  const migrationHint =
    error.includes("conversation_id") ||
    error.includes("team_chat_conversations") ||
    error.includes("get_or_create_direct_conversation");

  return (
    <Card className="team-chat-shadcn flex min-h-[min(78vh,760px)] flex-col overflow-hidden border shadow-sm">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
        {error ? (
          <Alert variant="destructive" className="m-3 mb-0 shrink-0">
            <AlertDescription>
              {error}
              {migrationHint ? (
                <span className="mt-1 block text-xs opacity-90">
                  Run migration 20260709180000_team_chat_conversations.sql on Supabase.
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex min-h-0 flex-1">
          {/* Inbox sidebar */}
          <aside
            className={cn(
              "flex min-h-0 w-full shrink-0 flex-col border-r md:w-80 lg:w-96",
              mobileShowThread && "hidden md:flex"
            )}
          >
            <Tabs
              value={inboxTab}
              onValueChange={setInboxTab}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsContent value="chats" className={INBOX_PANE_CLASS}>
                <InboxPane
                  title="Chats"
                  action={
                    <NewDirectChatDialog
                      sessionUserId={sessionUserId}
                      teamProfiles={teamProfiles}
                      onStartChat={startDirectChat}
                    />
                  }
                >
                  {loadingConversations ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">Loading chats…</p>
                  ) : directConversations.length === 0 ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      No chats yet. Start a direct message.
                    </p>
                  ) : (
                    directConversations.map((conv) => {
                      const peerId = (conv.member_ids ?? []).find((id) => id !== sessionUserId);
                      return (
                        <ConversationListItem
                          key={conv.id}
                          conversation={conv}
                          sessionUserId={sessionUserId}
                          teamProfiles={teamProfiles}
                          active={conv.id === activeConversationId}
                          onSelect={selectConversation}
                          presence={peerId ? (presenceByUserId[peerId] ?? "offline") : "offline"}
                        />
                      );
                    })
                  )}
                </InboxPane>
              </TabsContent>
              <TabsContent value="groups" className={INBOX_PANE_CLASS}>
                <InboxPane
                  title="Groups"
                  action={
                    <CreateGroupDialog
                      sessionUserId={sessionUserId}
                      teamProfiles={teamProfiles}
                      onCreate={handleCreateGroup}
                    />
                  }
                >
                  {loadingConversations ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">Loading groups…</p>
                  ) : groupConversations.length === 0 ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">No groups yet.</p>
                  ) : (
                    groupConversations.map((conv) => (
                      <ConversationListItem
                        key={conv.id}
                        conversation={conv}
                        sessionUserId={sessionUserId}
                        teamProfiles={teamProfiles}
                        active={conv.id === activeConversationId}
                        onSelect={selectConversation}
                      />
                    ))
                  )}
                </InboxPane>
              </TabsContent>
              <TabsContent value="channels" className={INBOX_PANE_CLASS}>
                <InboxPane
                  title="Channels"
                  action={
                    isChatAdmin ? (
                      <CreateChannelDialog onCreate={handleCreateChannel} />
                    ) : null
                  }
                >
                  {loadingConversations ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">Loading channels…</p>
                  ) : channelConversations.length === 0 ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      {isChatAdmin ? "No channels yet. Create one for the whole team." : "No channels yet."}
                    </p>
                  ) : (
                    channelConversations.map((conv) => (
                      <ConversationListItem
                        key={conv.id}
                        conversation={conv}
                        sessionUserId={sessionUserId}
                        teamProfiles={teamProfiles}
                        active={conv.id === activeConversationId}
                        onSelect={selectConversation}
                      />
                    ))
                  )}
                </InboxPane>
              </TabsContent>
              <TabsList className="grid h-12 w-full shrink-0 grid-cols-3 rounded-none border-t bg-muted/40 p-1">
                {CHAT_INBOX_TABS.map((tab) => {
                  const count = inboxTabUnread[tab.id] ?? 0;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="gap-1.5 text-xs sm:text-sm"
                    >
                      {tab.label}
                      {count > 0 ? (
                        <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
                          {count > 99 ? "99+" : count}
                        </Badge>
                      ) : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </aside>

          <section
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              !mobileShowThread && !activeConversationId && "hidden md:flex",
              !mobileShowThread && activeConversationId && "hidden md:flex",
              mobileShowThread && "flex"
            )}
          >
            {showThread ? (
              <>
                <header className="flex items-center gap-2 border-b px-3 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 md:hidden"
                    aria-label="Back to chats"
                    onClick={exitThreadView}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    {selectedMessages.length > 0 ? (
                      <ChatMessageActionBar
                        count={selectedMessages.length}
                        canDelete={canDeleteSelected}
                        pinned={Boolean(selectedSingle?.pinned_at)}
                        reactOpen={reactOpen}
                        onReactOpenChange={setReactOpen}
                        onReply={handleReplySelected}
                        onReact={(emoji) => void handleReactToMessage(selectedSingle?.id, emoji)}
                        onDelete={() => void handleDeleteSelected()}
                        onForward={() => setForwardOpen(true)}
                        onPin={() => void handlePinSelected()}
                        onCopy={() => void handleCopySelected()}
                        onClear={clearMessageSelection}
                        channelReadOnly={channelReadOnly}
                        showViewers={showGroupViewers}
                        onViewers={() => setViewersOpen(true)}
                      />
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={cn("min-w-0 flex-1", canOpenThreadDetails && "cursor-pointer")}
                          onClick={() => {
                            if (canOpenThreadDetails) setGroupDetailsOpen(true);
                          }}
                          onKeyDown={(e) => {
                            if (!canOpenThreadDetails) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setGroupDetailsOpen(true);
                            }
                          }}
                          role={canOpenThreadDetails ? "button" : undefined}
                          tabIndex={canOpenThreadDetails ? 0 : undefined}
                        >
                          <h3 className="truncate font-semibold">{threadTitle}</h3>
                          <p className="truncate text-xs text-muted-foreground">
                            {composeDirectPeerId
                              ? presenceLabel(threadPresence ?? "offline")
                              : activeConversation?.kind === "group"
                                ? `${activeConversation.member_ids?.length ?? 0} members`
                                : activeConversation?.kind === "channel"
                                  ? "Channel · everyone"
                                  : presenceLabel(threadPresence ?? "offline")}
                          </p>
                        </div>
                        {canOpenSharedMedia ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMediaOpen(true);
                            }}
                          >
                            Media
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </header>

                <ScrollArea className="min-h-0 min-w-0 flex-1 bg-muted/20 [&_[data-radix-scroll-area-viewport]>div]:max-w-full [&_[data-radix-scroll-area-viewport]>div]:min-w-0">
                  <div className="flex w-full min-w-0 max-w-full flex-col gap-4 p-4" aria-live="polite">
                    {loadingMessages ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">Loading messages…</p>
                    ) : messages.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {composeDirectPeerId
                          ? "No messages yet. Send the first message to start this chat."
                          : "No messages yet. Say hello!"}
                      </p>
                    ) : (
                      messages.map((msg) => {
                        const author = msg.author ?? {};
                        const isOwn = msg.author_id === sessionUserId;
                        const authorName = messageAuthorDisplayName(msg, author);
                        const avatarUrl = profileAvatarPublicUrl(author.avatar_path);
                        const hasContent =
                          (msg.body ?? "").trim() || msg.attachment_path || msg.gif_url;

                        const replyParent = msg.reply_to_message_id
                          ? messageById.get(msg.reply_to_message_id)
                          : null;
                        const selected = selectedMessageIds.has(msg.id);
                        const receiptStatus = outgoingReceiptStatus({
                          kind: activeConversation?.kind,
                          createdAt: msg.created_at,
                          authorId: msg.author_id,
                          sessionUserId,
                          memberReads: activeConversation?.member_reads,
                          presenceByUserId
                        });

                        return (
                          <article
                            key={msg.id}
                            className={cn(
                              "flex w-full min-w-0 gap-3",
                              isOwn && "flex-row-reverse",
                              selected && "-mx-4 bg-sky-100 px-4 py-2"
                            )}
                          >
                            <PersonAvatar
                              name={author.full_name || authorName}
                              email={author.email}
                              imageUrl={avatarUrl}
                              size="sm"
                              className="mt-1 shrink-0"
                            />
                            <div
                              className={cn(
                                "flex min-w-0 max-w-[85%] flex-col gap-1",
                                isOwn && "items-end"
                              )}
                            >
                              {activeConversation?.kind === "group" || activeConversation?.kind === "channel" ? (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">{authorName}</span>
                                  <time dateTime={msg.created_at}>{formatChatTime(msg.created_at)}</time>
                                </div>
                              ) : null}
                              {hasContent || msg.deleted_at || receiptStatus ? (
                                <div
                                  role="button"
                                  tabIndex={msg.deleted_at ? -1 : 0}
                                  onClick={() => {
                                    if (msg.deleted_at) return;
                                    toggleMessageSelected(msg);
                                  }}
                                  onKeyDown={(e) => {
                                    if (msg.deleted_at) return;
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      toggleMessageSelected(msg);
                                    }
                                  }}
                                  className={cn(
                                    "min-w-0 w-full max-w-full whitespace-normal rounded-lg px-3 py-2 text-left shadow-sm",
                                    isOwn
                                      ? "bg-primary text-primary-foreground"
                                      : "border bg-card text-card-foreground",
                                    msg.deleted_at && "cursor-default opacity-70"
                                  )}
                                >
                                  {msg.deleted_at ? (
                                    <p className="text-sm italic">Message deleted</p>
                                  ) : (
                                    <>
                                      {msg.pinned_at ? (
                                        <Pin className="mb-1 size-3 opacity-80" aria-hidden />
                                      ) : null}
                                      {msg.forwarded_from_message_id ? (
                                        <Forward className="mb-1 size-3 opacity-80" aria-hidden />
                                      ) : null}
                                      {replyParent || msg.reply_to_message_id ? (
                                        <p className="mb-1 truncate text-[11px] opacity-80">
                                          {replyParent?.deleted_at
                                            ? "Message deleted"
                                            : conversationPreviewText(replyParent)}
                                        </p>
                                      ) : null}
                                      {activeConversation?.kind === "direct" && !isOwn ? (
                                        <time
                                          className="mb-1 block text-[10px] opacity-70"
                                          dateTime={msg.created_at}
                                        >
                                          {formatChatTime(msg.created_at)}
                                        </time>
                                      ) : null}
                                      <ChatMessageBody
                                        body={msg.body}
                                        profiles={teamProfiles}
                                        orders={orders}
                                        onOpenOrder={onOpenOrder}
                                        inverted={isOwn}
                                      />
                                      <ChatMessageGif gifUrl={msg.gif_url} />
                                      <ChatMessageAttachment msg={msg} inverted={isOwn} />
                                      {receiptStatus ? (
                                        <span className="mt-1 flex justify-end">
                                          <ChatMessageTicks status={receiptStatus} inverted />
                                        </span>
                                      ) : null}
                                    </>
                                  )}
                                </div>
                              ) : null}
                              {!msg.deleted_at && msg.reactions?.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {msg.reactions.map((reaction) => (
                                    <Button
                                      key={`${msg.id}-${reaction.emoji}`}
                                      type="button"
                                      variant={
                                        reaction.userIds.includes(sessionUserId)
                                          ? "secondary"
                                          : "outline"
                                      }
                                      size="sm"
                                      className="h-6 gap-1 px-2"
                                      aria-label={`${reaction.emoji} ${reaction.userIds.length}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleReactToMessage(msg.id, reaction.emoji);
                                      }}
                                    >
                                      {reaction.emoji}
                                      <span className="tabular-nums">{reaction.userIds.length}</span>
                                    </Button>
                                  ))}
                                </div>
                              ) : null}
                              {(msg.mentioned_user_ids?.length > 0 ||
                                msg.mentioned_order_ids?.length > 0) && (
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {(msg.mentioned_user_ids ?? []).map((uid) => {
                                    const p = teamProfiles.find((x) => x.id === uid);
                                    if (!p) return null;
                                    return (
                                      <Badge key={`u-${uid}`} variant="secondary" className="text-xs">
                                        @{profileChatLabel(p)}
                                      </Badge>
                                    );
                                  })}
                                  {(msg.mentioned_order_ids ?? []).map((oid) => {
                                    const o = orders.find((x) => String(x.id) === String(oid));
                                    if (!o) return null;
                                    return (
                                      <Button
                                        key={`o-${oid}`}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOpenOrder?.(o);
                                        }}
                                      >
                                        #{orderChatToken(o)}
                                      </Button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })
                    )}
                    <div ref={bottomRef} aria-hidden />
                  </div>
                </ScrollArea>

                <Separator />

                {channelReadOnly ? (
                  <p className="p-3 text-center text-sm text-muted-foreground">
                    Only admins can post. You can react, copy, or forward.
                  </p>
                ) : null}

                {canCompose ? (
                <form className="flex flex-col gap-3 p-3" onSubmit={handleSend}>
                  {replyTo ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {replyTo.deleted_at ? "Message deleted" : conversationPreviewText(replyTo)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label="Cancel reply"
                        onClick={() => setReplyTo(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : null}
                  {voiceRecording ? (
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      Recording…
                    </div>
                  ) : null}
                  {pendingFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      <span className="flex min-w-0 flex-1 flex-col gap-2">
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <Paperclip className="size-4 shrink-0" aria-hidden />
                          {pendingFile.name}
                        </span>
                        {pendingAudioUrl ? (
                          <audio controls preload="metadata" src={pendingAudioUrl} className="w-full max-w-xs">
                            <track kind="captions" />
                          </audio>
                        ) : null}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label="Remove attachment"
                        onClick={() => setPendingFile(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : null}

                  {pendingGifUrl ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
                      <img src={pendingGifUrl} alt="Selected GIF" className="h-14 rounded object-cover" />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label="Remove GIF"
                        onClick={() => setPendingGifUrl("")}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : null}

                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="relative min-w-0 w-full">
                      {(showUserMenu || showOrderMenu) && (
                        <ul
                          className="absolute bottom-full z-20 mb-2 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
                          role="listbox"
                        >
                          {showUserMenu && mentionUsers.length === 0 ? (
                            <li className="px-3 py-2 text-xs text-muted-foreground">
                              {teamProfiles.filter((p) => profileMentionable(p)).length < 1
                                ? "No display names yet — admin sets names in Edit Users"
                                : "No matching names"}
                            </li>
                          ) : null}
                          {showUserMenu &&
                            mentionUsers.map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  className="flex w-full flex-col rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                                  onClick={() => pickUser(p)}
                                >
                                  <span className="font-medium">@{profileChatLabel(p)}</span>
                                  {p.department?.trim() ? (
                                    <span className="text-xs text-muted-foreground">
                                      {p.department.trim()}
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                          {showOrderMenu && mentionOrders.length === 0 ? (
                            <li className="px-3 py-2 text-xs text-muted-foreground">No matching orders</li>
                          ) : null}
                          {showOrderMenu &&
                            mentionOrders.map((o) => (
                              <li key={o.id}>
                                <button
                                  type="button"
                                  className="flex w-full flex-col rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                                  onClick={() => pickOrder(o)}
                                >
                                  <span className="font-medium">#{orderChatToken(o)}</span>
                                  <span className="text-xs text-muted-foreground">{o.customer_name}</span>
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}

                      <Textarea
                        ref={textareaRef}
                        rows={1}
                        className="min-h-9 w-full resize-none overflow-y-auto"
                        placeholder="Message… Enter to send, Shift+Enter for new line"
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          setCursor(e.target.selectionStart ?? e.target.value.length);
                        }}
                        onKeyDown={handleComposerKeyDown}
                        onClick={syncCursorFromTextarea}
                        onKeyUp={syncCursorFromTextarea}
                        onSelect={syncCursorFromTextarea}
                        disabled={sending}
                      />
                    </div>

                    <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-9"
                              aria-label="Insert emoji"
                            >
                              <Smile className="size-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-2" align="start">
                            <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="Emoji picker">
                              {CHAT_EMOJI_PALETTE.map((emoji) => (
                                <Button
                                  key={emoji}
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-base"
                                  onClick={() => insertEmoji(emoji)}
                                >
                                  {emoji}
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>

                        <GifPicker onPick={onPickGif} disabled={sending || voiceRecording} />

                        <input
                          ref={fileInputRef}
                          type="file"
                          className="sr-only"
                          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                          onChange={onPickAttachment}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-9"
                          aria-label="Attach image or PDF"
                          disabled={sending || voiceRecording}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="size-4" />
                        </Button>
                        <ChatVoiceControls
                          key={`${activeConversationId ?? "new"}-${composeDirectPeerId ?? "none"}`}
                          disabled={sending}
                          onRecordingChange={setVoiceRecording}
                          onError={setError}
                          onVoiceReady={(file) => {
                            const validationError = validateChatAttachmentFile(file);
                            if (validationError) {
                              setError(validationError);
                              return;
                            }
                            setError("");
                            setPendingFile(file);
                            setPendingGifUrl("");
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-9"
                          aria-label="Paste"
                          disabled={sending || voiceRecording}
                          onClick={() => void handlePasteIntoComposer()}
                        >
                          <ClipboardPaste />
                        </Button>
                      </div>

                      <Button
                        type="submit"
                        variant="success"
                        size="icon"
                        disabled={!canSend}
                        className="size-9 shrink-0"
                        aria-label="Send message"
                      >
                        <Send className="size-4" />
                      </Button>
                    </div>
                  </div>
                </form>
                ) : null}
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <p className="text-sm">Pick a chat from the list or start a new conversation.</p>
              </div>
            )}
          </section>
        </div>
        <ChatGroupDetailsSheet
          open={groupDetailsOpen}
          onOpenChange={setGroupDetailsOpen}
          conversation={activeConversation}
          sessionUserId={sessionUserId}
          teamProfiles={teamProfiles}
          composePeer={composeDirectPeer}
          isGroupAdmin={isActiveGroupAdmin}
          onChanged={loadConversations}
        />
        <ChatSharedMediaSheet
          open={mediaOpen}
          onOpenChange={setMediaOpen}
          conversationId={activeConversationId}
          title={threadTitle}
        />
        <ChatGroupViewersDialog
          open={viewersOpen}
          onOpenChange={setViewersOpen}
          seen={groupViewerLists.seen}
          unseen={groupViewerLists.unseen}
        />
        <ChatForwardDialog
          open={forwardOpen}
          onOpenChange={setForwardOpen}
          conversations={conversations}
          currentConversationId={activeConversationId}
          sessionUserId={sessionUserId}
          teamProfiles={teamProfiles}
          sending={sending}
          canPostToChannel={isChatAdmin}
          onForward={handleForwardTo}
        />
      </CardContent>
    </Card>
  );
}
