import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Paperclip, Send, Smile, UsersRound, X } from "lucide-react";
import { profileAvatarPublicUrl } from "@/avatarUtils";
import { supabase } from "./supabaseClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChatMessageBody } from "@/components/chat/ChatMessageBody";
import { ChatMessageAttachment, ChatMessageGif } from "@/components/chat/ChatMessageMedia";
import { CreateGroupDialog } from "@/components/chat/CreateGroupDialog";
import { GifPicker } from "@/components/chat/GifPicker";
import { NewDirectChatDialog } from "@/components/chat/NewDirectChatDialog";
import {
  conversationPreviewText,
  createGroupConversation,
  fetchConversationMessages,
  fetchMyConversations,
  getOrCreateDirectConversation,
  markConversationRead,
  conversationsWithRead,
  sendChatMessage,
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
  messageAuthorDisplayName,
  orderChatToken,
  profileChatLabel,
  profileMentionable,
  validateChatAttachmentFile
} from "./teamChatUtils";
import { setTeamChatViewState, sumConversationUnread } from "./teamChatNotificationUtils";

function insertAtCursor(text, start, end, insert) {
  return `${text.slice(0, start)}${insert}${text.slice(end)}`;
}

function ConversationListItem({ conversation, sessionUserId, teamProfiles, active, onSelect }) {
  const title = conversationDisplayTitle(conversation, sessionUserId, teamProfiles);
  const preview = conversationPreviewText(conversation.last_message);
  const isGroup = conversation.kind === "group";
  const unread = (conversation.unread_count ?? 0) > 0;
  const peerId = !isGroup
    ? (conversation.member_ids ?? []).find((id) => id !== sessionUserId)
    : null;
  const peer = peerId ? teamProfiles.find((p) => p.id === peerId) : null;
  const avatarUrl = peer ? profileAvatarPublicUrl(peer.avatar_path) : null;

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
      {isGroup ? (
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UsersRound className="size-5" />
        </div>
      ) : (
        <PersonAvatar
          name={peer?.full_name || title}
          email={peer?.email}
          imageUrl={avatarUrl}
          size="md"
          className="shrink-0"
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
  const [error, setError] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [composeDirectPeerId, setComposeDirectPeerId] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const composeDirectPeer = useMemo(
    () => (composeDirectPeerId ? teamProfiles.find((p) => p.id === composeDirectPeerId) ?? null : null),
    [teamProfiles, composeDirectPeerId]
  );

  const threadTitle = useMemo(() => {
    if (composeDirectPeer) return profileChatLabel(composeDirectPeer);
    return conversationDisplayTitle(activeConversation, sessionUserId, teamProfiles);
  }, [composeDirectPeer, activeConversation, sessionUserId, teamProfiles]);

  const showThread = Boolean(activeConversation || composeDirectPeerId);

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
    if (!activeConversationId && conversations.length > 0) {
      const general = conversations.find((c) => c.kind === "group" && c.title === "General");
      setActiveConversationId(general?.id ?? conversations[0].id);
    }
  }, [conversations, activeConversationId, composeDirectPeerId]);

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
        {
          event: "UPDATE",
          schema: "public",
          table: "team_chat_conversation_members",
          filter: `user_id=eq.${sessionUserId}`
        },
        () => loadConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, activeConversationId, loadConversations, loadMessages, markConversationAsRead]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  function selectConversation(id) {
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
    selectConversation(convId);
    return convId;
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
        gifUrl: pendingGifUrl || null
      });

      setDraft("");
      setCursor(0);
      setPendingFile(null);
      setPendingGifUrl("");
      setEmojiOpen(false);
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
    Boolean(draft.trim() || pendingFile || pendingGifUrl) &&
    !sending &&
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
              "flex w-full shrink-0 flex-col border-r md:w-80 lg:w-96",
              mobileShowThread && "hidden md:flex"
            )}
          >
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3">
              <h2 className="mr-auto text-base font-semibold">Chats</h2>
              <NewDirectChatDialog
                sessionUserId={sessionUserId}
                teamProfiles={teamProfiles}
                onStartChat={startDirectChat}
              />
              <CreateGroupDialog
                sessionUserId={sessionUserId}
                teamProfiles={teamProfiles}
                onCreate={handleCreateGroup}
              />
            </div>

            <ScrollArea className="min-h-0 flex-1">
              {loadingConversations ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Loading chats…</p>
              ) : conversations.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No chats yet. Start a direct message or create a group.
                </p>
              ) : (
                conversations.map((conv) => (
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
            </ScrollArea>
          </aside>

          {/* Thread */}
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
                    <h3 className="truncate font-semibold">{threadTitle}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {composeDirectPeerId
                        ? "New direct message — send to start chat"
                        : activeConversation?.kind === "group"
                          ? `${activeConversation.member_ids?.length ?? 0} members`
                          : "Direct message"}
                    </p>
                  </div>
                </header>

                <ScrollArea className="min-h-0 flex-1 bg-muted/20">
                  <div className="flex flex-col gap-4 p-4" aria-live="polite">
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

                        return (
                          <article
                            key={msg.id}
                            className={cn("flex gap-3", isOwn && "flex-row-reverse")}
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
                              {activeConversation?.kind === "group" ? (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">{authorName}</span>
                                  <time dateTime={msg.created_at}>{formatChatTime(msg.created_at)}</time>
                                </div>
                              ) : null}
                              {hasContent ? (
                                <div
                                  className={cn(
                                    "rounded-lg px-3 py-2 shadow-sm",
                                    isOwn
                                      ? "bg-primary text-primary-foreground"
                                      : "border bg-card text-card-foreground"
                                  )}
                                >
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
                                        onClick={() => onOpenOrder?.(o)}
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

                <form className="flex flex-col gap-3 p-3" onSubmit={handleSend}>
                  {pendingFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 truncate">
                        <Paperclip className="size-4 shrink-0" aria-hidden />
                        {pendingFile.name}
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

                  <div className="flex gap-2">
                    <div className="flex shrink-0 flex-col gap-1">
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

                      <GifPicker onPick={onPickGif} disabled={sending} />

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
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="size-4" />
                      </Button>
                    </div>

                    <div className="relative min-w-0 flex-1">
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
                        rows={2}
                        className="min-h-[72px] resize-none"
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

                    <Button
                      type="submit"
                      variant="success"
                      size="icon"
                      disabled={!canSend}
                      className="size-9 shrink-0 self-end"
                      aria-label="Send message"
                    >
                      <Send className="size-4" />
                    </Button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <p className="text-sm">Pick a chat from the list or start a new conversation.</p>
              </div>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
