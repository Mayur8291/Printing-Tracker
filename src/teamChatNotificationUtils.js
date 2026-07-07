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
  if (!message || message.author_id === userId) return false;
  if (chatPanelVisible && activeConversationId === message.conversation_id) return false;
  return true;
}

export function sumConversationUnread(conversations) {
  return (conversations ?? []).reduce((total, row) => total + (row.unread_count ?? 0), 0);
}
