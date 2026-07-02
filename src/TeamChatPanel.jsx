import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send, Smile, X } from "lucide-react";
import { profileAvatarPublicUrl } from "@/avatarUtils";
import { supabase } from "./supabaseClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CHAT_ATTACHMENT_BUCKET,
  CHAT_EMOJI_PALETTE,
  authorLabelForInsert,
  extractMentionsFromBody,
  filterMentionOrders,
  filterMentionUsers,
  formatChatTime,
  getActiveMentionQuery,
  getChatAttachmentPublicUrl,
  isChatImageMime,
  messageAuthorDisplayName,
  orderChatToken,
  profileChatLabel,
  profileMentionable,
  sanitizeChatFileName,
  splitChatBodyTokens,
  validateChatAttachmentFile
} from "./teamChatUtils";

function insertAtCursor(text, start, end, insert) {
  return `${text.slice(0, start)}${insert}${text.slice(end)}`;
}

function ChatMessageBody({ body, profiles, orders, onOpenOrder, inverted = false }) {
  if (!(body ?? "").trim()) return null;

  const profileByLabel = useMemo(() => {
    const map = new Map();
    for (const p of profiles ?? []) {
      const label = profileChatLabel(p);
      if (label) map.set(`@${label}`, p);
    }
    return map;
  }, [profiles]);

  const orderByToken = useMemo(() => {
    const map = new Map();
    for (const o of orders ?? []) {
      const token = orderChatToken(o);
      if (token) map.set(`#${token}`, o);
    }
    return map;
  }, [orders]);

  const parts = splitChatBodyTokens(body);
  const tokenClass = inverted
    ? "bg-primary-foreground/15 text-primary-foreground"
    : "bg-background/80 text-foreground";

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.kind === "text") {
          return <span key={i}>{part.value}</span>;
        }
        const user = profileByLabel.get(part.value);
        if (user) {
          return (
            <Badge key={i} variant="secondary" className={cn("mx-0.5 align-baseline text-xs", tokenClass)}>
              {part.value}
            </Badge>
          );
        }
        const order = orderByToken.get(part.value);
        if (order && onOpenOrder) {
          return (
            <Button
              key={i}
              type="button"
              variant="link"
              className={cn(
                "h-auto px-1 py-0 text-xs font-semibold underline-offset-2",
                inverted ? "text-primary-foreground" : "text-primary"
              )}
              onClick={() => onOpenOrder(order)}
            >
              {part.value}
            </Button>
          );
        }
        if (part.value.startsWith("#")) {
          return (
            <Badge key={i} variant="outline" className="mx-0.5 align-baseline text-xs">
              {part.value}
            </Badge>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}

function ChatMessageAttachment({ msg, inverted = false }) {
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

export default function TeamChatPanel({
  sessionUserId,
  currentUserProfile,
  teamProfiles,
  orders,
  onOpenOrder
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [error, setError] = useState("");

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const activeMention = useMemo(
    () => getActiveMentionQuery(draft, cursor),
    [draft, cursor]
  );

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

  const loadMessages = useCallback(async () => {
    const baseSelect =
      "id, body, author_id, mentioned_user_ids, mentioned_order_ids, created_at, author_label, attachment_path, attachment_name, attachment_mime, attachment_size";
    let result = await supabase
      .from("team_chat_messages")
      .select(baseSelect)
      .order("created_at", { ascending: true })
      .limit(300);

    if (result.error?.message?.includes("attachment_path")) {
      result = await supabase
        .from("team_chat_messages")
        .select(
          "id, body, author_id, mentioned_user_ids, mentioned_order_ids, created_at, author_label"
        )
        .order("created_at", { ascending: true })
        .limit(300);
    } else if (result.error?.message?.includes("author_label")) {
      result = await supabase
        .from("team_chat_messages")
        .select("id, body, author_id, mentioned_user_ids, mentioned_order_ids, created_at")
        .order("created_at", { ascending: true })
        .limit(300);
    }

    const { data, error: fetchErr } = result;

    if (fetchErr) {
      setError(fetchErr.message);
      setLoading(false);
      return;
    }
    const profileMap = new Map((teamProfiles ?? []).map((p) => [p.id, p]));
    const enriched = (data ?? []).map((row) => {
      const base = profileMap.get(row.author_id) ?? {
        id: row.author_id,
        full_name: null,
        email: null
      };
      return { ...row, author: base };
    });
    setError("");
    setMessages(enriched);
    setLoading(false);
    requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom, teamProfiles]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!sessionUserId) return undefined;

    const channel = supabase
      .channel("team-chat-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_chat_messages" },
        async () => {
          await loadMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionUserId, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

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
  }

  async function uploadChatAttachment(file) {
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

  async function handleSend(e) {
    e.preventDefault();
    const body = draft.trim();
    if ((!body && !pendingFile) || sending) return;

    const { mentionedUserIds, mentionedOrderIds } = extractMentionsFromBody(
      body,
      teamProfiles,
      orders
    );

    setSending(true);
    setError("");

    try {
      let attachmentFields = {};
      if (pendingFile) {
        attachmentFields = await uploadChatAttachment(pendingFile);
      }

      const payload = {
        author_id: sessionUserId,
        body: body || "",
        mentioned_user_ids: mentionedUserIds,
        mentioned_order_ids: mentionedOrderIds,
        author_label: authorLabelForInsert(currentUserProfile ?? {}),
        ...attachmentFields
      };

      let { error: insertErr } = await supabase.from("team_chat_messages").insert(payload);

      if (insertErr?.message?.includes("attachment_path")) {
        const {
          attachment_path: _p,
          attachment_name: _n,
          attachment_mime: _m,
          attachment_size: _s,
          ...withoutAttach
        } = payload;
        ({ error: insertErr } = await supabase.from("team_chat_messages").insert(withoutAttach));
        if (!insertErr && pendingFile) {
          throw new Error("Run chat attachments migration in Supabase to send files.");
        }
      }

      if (insertErr?.message?.includes("author_label")) {
        const { author_label: _a, ...withoutLabel } = payload;
        ({ error: insertErr } = await supabase.from("team_chat_messages").insert(withoutLabel));
      }

      if (insertErr) throw new Error(insertErr.message);

      setDraft("");
      setCursor(0);
      setPendingFile(null);
      setEmojiOpen(false);
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const showUserMenu = activeMention?.type === "user";
  const showOrderMenu = activeMention?.type === "order";
  const canSend = Boolean(draft.trim() || pendingFile) && !sending;

  return (
    <Card className="team-chat-shadcn flex min-h-[min(72vh,720px)] flex-col border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Chat</CardTitle>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pb-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <ScrollArea className="h-[min(52vh,520px)] min-h-[280px] rounded-lg border bg-muted/30">
          <div className="flex flex-col gap-4 p-4" aria-live="polite">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading messages…</p>
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              messages.map((msg) => {
                const author = msg.author ?? {};
                const isOwn = msg.author_id === sessionUserId;
                const authorName = messageAuthorDisplayName(msg, author);
                const avatarUrl = profileAvatarPublicUrl(author.avatar_path);

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
                    <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-1", isOwn && "items-end")}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{authorName}</span>
                        <time dateTime={msg.created_at}>{formatChatTime(msg.created_at)}</time>
                      </div>
                      {(msg.body ?? "").trim() || msg.attachment_path ? (
                        <div
                          className={cn(
                            "rounded-lg px-3 py-2 shadow-sm",
                            isOwn
                              ? "bg-primary text-primary-foreground"
                              : "border bg-card text-card-foreground"
                          )}
                        >
                          <ChatMessageBody
                            body={msg.body}
                            profiles={teamProfiles}
                            orders={orders}
                            onOpenOrder={onOpenOrder}
                            inverted={isOwn}
                          />
                          <ChatMessageAttachment msg={msg} inverted={isOwn} />
                        </div>
                      ) : null}
                      {(msg.mentioned_user_ids?.length > 0 || msg.mentioned_order_ids?.length > 0) && (
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

        <form className="flex flex-col gap-3" onSubmit={handleSend}>
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

          <div className="flex gap-2">
            <div className="flex shrink-0 flex-col gap-1">
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="icon" className="size-9" aria-label="Insert emoji">
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
                            <span className="text-xs text-muted-foreground">{p.department.trim()}</span>
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
                rows={3}
                className="min-h-[88px] resize-none"
                placeholder="Message… @ name, # order, or attach file"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setCursor(e.target.selectionStart ?? e.target.value.length);
                }}
                onClick={syncCursorFromTextarea}
                onKeyUp={syncCursorFromTextarea}
                onSelect={syncCursorFromTextarea}
                disabled={sending}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="success" disabled={!canSend} className="min-w-[7rem]">
              <Send className="size-4" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
