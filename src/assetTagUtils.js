const TAG_PREFIX = "IT-";
const TAG_PAD = 5;

/** Next sequential asset tag from existing tags (e.g. IT-00001, IT-00002). */
export function generateNextAssetTag(tags = []) {
  let max = 0;
  for (const tag of tags) {
    const match = String(tag ?? "").trim().match(/^IT-(\d+)$/i);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `${TAG_PREFIX}${String(max + 1).padStart(TAG_PAD, "0")}`;
}

export function userDisplayInitials(name, email) {
  const source = String(name || email || "U").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
