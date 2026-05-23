import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
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
  profileDisplayName,
  profileMentionable,
  sanitizeChatFileName,
  splitChatBodyTokens,
  validateChatAttachmentFile
} from "./teamChatUtils";

function insertAtCursor(text, start, end, insert) {
  return `${text.slice(0, start)}${insert}${text.slice(end)}`;
}

function ChatMessageBody({ body, profiles, orders, onOpenOrder }) {
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

  return (
    <p className="team-chat-msg-text">
      {parts.map((part, i) => {
        if (part.kind === "text") {
          return <span key={i}>{part.value}</span>;
        }
        const user = profileByLabel.get(part.value);
        if (user) {
          return (
            <span key={i} className="team-chat-token team-chat-token--user">
              {part.value}
            </span>
          );
        }
        const order = orderByToken.get(part.value);
        if (order && onOpenOrder) {
          return (
            <button
              key={i}
              type="button"
              className="team-chat-token team-chat-token--order"
              onClick={() => onOpenOrder(order)}
            >
              {part.value}
            </button>
          );
        }
        if (part.value.startsWith("#")) {
          return (
            <span key={i} className="team-chat-token team-chat-token--order">
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}

function ChatMessageAttachment({ msg }) {
  const path = (msg.attachment_path ?? "").trim();
  if (!path) return null;

  const url = getChatAttachmentPublicUrl(path);
  const name = msg.attachment_name || "Download file";
  const mime = msg.attachment_mime ?? "";

  if (!url) return null;

  if (isChatImageMime(mime)) {
    return (
      <div className="team-chat-attachment team-chat-attachment--image">
        <a href={url} target="_blank" rel="noopener noreferrer" download={name}>
          <img src={url} alt={name} loading="lazy" />
        </a>
        <a className="team-chat-attachment-dl" href={url} download={name} target="_blank" rel="noopener noreferrer">
          Download {name}
        </a>
      </div>
    );
  }

  return (
    <div className="team-chat-attachment team-chat-attachment--file">
      <span className="team-chat-attachment-icon" aria-hidden>
        📎
      </span>
      <a className="team-chat-attachment-dl" href={url} download={name} target="_blank" rel="noopener noreferrer">
        {name}
      </a>
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

  const listRef = useRef(null);
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
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
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
    <section className="panel team-chat-panel dashboard-card">
      <header className="dashboard-panel-head team-chat-head">
        <div>
          <h2 className="dashboard-section-title">Chat</h2>
          <p className="dashboard-section-lead">
            Message text is kept in the database. Images and PDFs are removed automatically after 24 hours.
            Use <strong>@</strong> display name, <strong>#</strong> order id.
          </p>
        </div>
      </header>

      {error ? (
        <p className="team-chat-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="team-chat-body">
        <div className="team-chat-messages" ref={listRef} aria-live="polite">
          {loading ? (
            <p className="team-chat-empty">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="team-chat-empty">No messages yet. Say hello to the team.</p>
          ) : (
            messages.map((msg) => {
              const author = msg.author ?? {};
              const isOwn = msg.author_id === sessionUserId;
              const authorName = messageAuthorDisplayName(msg, author);
              return (
                <article
                  key={msg.id}
                  className={isOwn ? "team-chat-msg team-chat-msg--own" : "team-chat-msg"}
                >
                  <div className="team-chat-msg-meta">
                    <span className="team-chat-msg-author">{authorName}</span>
                    <time className="team-chat-msg-time" dateTime={msg.created_at}>
                      {formatChatTime(msg.created_at)}
                    </time>
                  </div>
                  <ChatMessageBody
                    body={msg.body}
                    profiles={teamProfiles}
                    orders={orders}
                    onOpenOrder={onOpenOrder}
                  />
                  <ChatMessageAttachment msg={msg} />
                  {(msg.mentioned_user_ids?.length > 0 || msg.mentioned_order_ids?.length > 0) && (
                    <div className="team-chat-msg-chips">
                      {(msg.mentioned_user_ids ?? []).map((uid) => {
                        const p = teamProfiles.find((x) => x.id === uid);
                        if (!p) return null;
                        return (
                          <span key={`u-${uid}`} className="team-chat-chip team-chat-chip--user">
                            @{profileChatLabel(p)}
                          </span>
                        );
                      })}
                      {(msg.mentioned_order_ids ?? []).map((oid) => {
                        const o = orders.find((x) => String(x.id) === String(oid));
                        if (!o) return null;
                        return (
                          <button
                            key={`o-${oid}`}
                            type="button"
                            className="team-chat-chip team-chat-chip--order"
                            onClick={() => onOpenOrder?.(o)}
                          >
                            #{orderChatToken(o)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        <form className="team-chat-composer" onSubmit={handleSend}>
          {pendingFile ? (
            <div className="team-chat-pending-file">
              <span>📎 {pendingFile.name}</span>
              <button type="button" className="team-chat-pending-remove" onClick={() => setPendingFile(null)}>
                Remove
              </button>
            </div>
          ) : null}

          <div className="team-chat-composer-main">
            <div className="team-chat-toolbar-group">
              <div className="team-chat-tool-wrap">
                <button
                  type="button"
                  className="team-chat-tool-btn"
                  aria-expanded={emojiOpen}
                  aria-label="Insert emoji"
                  onClick={() => setEmojiOpen((v) => !v)}
                >
                  😀
                </button>
                {emojiOpen ? (
                  <div className="team-chat-emoji-popover" role="listbox" aria-label="Emoji picker">
                    {CHAT_EMOJI_PALETTE.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="team-chat-emoji-item"
                        onClick={() => insertEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                className="team-chat-file-input"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                onChange={onPickAttachment}
              />
              <button
                type="button"
                className="team-chat-tool-btn"
                aria-label="Attach image or PDF"
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
            </div>

            <div className="team-chat-input-wrap">
              {(showUserMenu || showOrderMenu) && (
                <ul className="team-chat-mention-menu" role="listbox">
                  {showUserMenu && mentionUsers.length === 0 ? (
                    <li className="team-chat-mention-empty">
                      {teamProfiles.filter((p) => profileMentionable(p)).length < 1
                        ? "No display names yet — admin sets names in Edit Users"
                        : "No matching names"}
                    </li>
                  ) : null}
                  {showUserMenu &&
                    mentionUsers.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => pickUser(p)}>
                          <span className="team-chat-mention-label">@{profileChatLabel(p)}</span>
                          {p.department?.trim() ? (
                            <span className="team-chat-mention-sub">{p.department.trim()}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  {showOrderMenu && mentionOrders.length === 0 ? (
                    <li className="team-chat-mention-empty">No matching orders</li>
                  ) : null}
                  {showOrderMenu &&
                    mentionOrders.map((o) => (
                      <li key={o.id}>
                        <button type="button" onClick={() => pickOrder(o)}>
                          <span className="team-chat-mention-label">#{orderChatToken(o)}</span>
                          <span className="team-chat-mention-sub">{o.customer_name}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}

              <textarea
                ref={textareaRef}
                className="team-chat-textarea"
                rows={3}
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

          <button type="submit" className="team-chat-send-btn" disabled={!canSend}>
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}
