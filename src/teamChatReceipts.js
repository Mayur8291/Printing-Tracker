import { profileChatLabel } from "./teamChatUtils";

function sameUserId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export function memberHasSeenMessage(lastReadAt, createdAt) {
  if (!lastReadAt || !createdAt) return false;
  const read = new Date(lastReadAt).getTime();
  const sent = new Date(createdAt).getTime();
  if (Number.isNaN(read) || Number.isNaN(sent)) return false;
  return read >= sent;
}

export function isDashboardActivePresence(status) {
  return status === "online";
}

function otherMemberReads(memberReads, sessionUserId) {
  return (memberReads ?? []).filter(
    (row) => row?.user_id && !sameUserId(row.user_id, sessionUserId)
  );
}

export function outgoingReceiptStatus({
  kind,
  createdAt,
  authorId,
  sessionUserId,
  memberReads,
  presenceByUserId
}) {
  if (!createdAt || !sameUserId(authorId, sessionUserId)) return null;
  if (kind !== "direct" && kind !== "group") return null;

  const others = otherMemberReads(memberReads, sessionUserId);
  if (!others.length) return "sent";

  const allSeen = others.every((row) => memberHasSeenMessage(row.last_read_at, createdAt));
  if (allSeen) return "read";

  if (kind === "group") {
    const anySeen = others.some((row) => memberHasSeenMessage(row.last_read_at, createdAt));
    if (anySeen) return "delivered";
  }

  const anyDashboardOn = others.some((row) =>
    isDashboardActivePresence(presenceByUserId?.[row.user_id] ?? presenceByUserId?.[String(row.user_id)] ?? "offline")
  );
  return anyDashboardOn ? "delivered" : "sent";
}

export function groupMessageViewerLists({
  createdAt,
  authorId,
  memberReads,
  teamProfiles
}) {
  const others = otherMemberReads(memberReads, authorId);
  const seen = [];
  const unseen = [];

  for (const row of others) {
    const profile = (teamProfiles ?? []).find((p) => sameUserId(p.id, row.user_id));
    const entry = {
      userId: row.user_id,
      label: profileChatLabel(profile),
      lastReadAt: row.last_read_at ?? null
    };
    if (memberHasSeenMessage(row.last_read_at, createdAt)) seen.push(entry);
    else unseen.push(entry);
  }

  seen.sort((a, b) => a.label.localeCompare(b.label));
  unseen.sort((a, b) => a.label.localeCompare(b.label));
  return { seen, unseen };
}
