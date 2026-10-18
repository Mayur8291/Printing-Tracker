/** Tracks open chat thread so tones skip when user already viewing that conversation. */
let chatPanelVisible = false;
let activeConversationId = null;

export function setTeamChatViewState({ panelVisible, conversationId } = {}) {
  if (typeof panelVisible === "boolean") {
    chatPanelVisible = panelVisible;
  }
  if (conversationId !== undefined) {
    activeConversationId = conversationId || null;
  }
}

export function shouldPlayChatMessageTone(message, userId) {
  return shouldNotifyIncomingChatMessage(message, userId);
}

export function shouldNotifyIncomingChatMessage(message, userId) {
  if (!message || !userId) return false;
  if (String(message.author_id) === String(userId)) return false;
  if (message.deleted_at) return false;
  return true;
}

export function sumConversationUnread(conversations) {
  return (conversations ?? []).reduce((total, row) => total + (row.unread_count ?? 0), 0);
}
