import { supabase } from "./supabaseClient";
import { PRESET_AVATAR_BY_ID, PRESET_AVATAR_PREFIX } from "./presetAvatars";

export { PRESET_AVATAR_PREFIX } from "./presetAvatars";
export { parsePresetAvatarId, presetAvatarPublicUrl, isPresetAvatarPath } from "./presetAvatars";

export const PROFILE_AVATAR_BUCKET = "profile-avatars";
export const GROUP_AVATAR_BUCKET = "team-chat-group-avatars";
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const AVATAR_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

export function personDisplayInitials(name, email) {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function profileAvatarPublicUrl(avatarPath) {
  if (!avatarPath?.trim()) return "";
  const trimmed = avatarPath.trim();
  if (trimmed.startsWith(PRESET_AVATAR_PREFIX)) {
    const presetId = trimmed.slice(PRESET_AVATAR_PREFIX.length);
    return PRESET_AVATAR_BY_ID[presetId]?.url ?? "";
  }
  const { data } = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(trimmed);
  return data?.publicUrl ?? "";
}

export function groupAvatarPublicUrl(avatarPath) {
  if (!avatarPath?.trim()) return "";
  const { data } = supabase.storage.from(GROUP_AVATAR_BUCKET).getPublicUrl(avatarPath.trim());
  return data?.publicUrl ?? "";
}

export function sanitizeAvatarFileName(name) {
  return (name ?? "avatar").replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 120) || "avatar";
}

export function validateAvatarPhotoFile(file) {
  if (!file) return null;
  if (!AVATAR_ALLOWED_TYPES.has(file.type)) {
    return "Photo must be JPEG, PNG, WebP, or GIF";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return "Photo must be 5 MB or smaller";
  }
  return null;
}

async function fetchProfileAvatarPath(userId) {
  const { data, error } = await supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.avatar_path ?? null;
}

async function removeStoredAvatarIfNeeded(avatarPath) {
  if (!avatarPath?.trim() || avatarPath.trim().startsWith(PRESET_AVATAR_PREFIX)) return;
  try {
    await removeProfileAvatar(avatarPath);
  } catch {
    /* old upload may already be gone */
  }
}

export async function setProfilePresetAvatar(userId, presetId) {
  if (!userId || !presetId) throw new Error("Avatar selection required");
  if (!PRESET_AVATAR_BY_ID[presetId]) throw new Error("Invalid avatar selection");

  const previousPath = await fetchProfileAvatarPath(userId);
  const nextPath = `${PRESET_AVATAR_PREFIX}${presetId}`;

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ avatar_path: nextPath })
    .eq("id", userId);
  if (updateErr) throw new Error(updateErr.message);

  if (previousPath && previousPath !== nextPath) {
    await removeStoredAvatarIfNeeded(previousPath);
  }

  return nextPath;
}

export async function uploadProfileAvatar(userId, file) {
  if (!userId || !file) return null;
  const validationError = validateAvatarPhotoFile(file);
  if (validationError) throw new Error(validationError);

  const previousPath = await fetchProfileAvatarPath(userId);
  const safeName = sanitizeAvatarFileName(file.name);
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadErr } = await supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (uploadErr) throw new Error(uploadErr.message);

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", userId);
  if (updateErr) throw new Error(updateErr.message);

  if (previousPath && previousPath !== path) {
    await removeStoredAvatarIfNeeded(previousPath);
  }

  return path;
}

export async function removeProfileAvatar(avatarPath) {
  if (!avatarPath?.trim()) return;
  if (avatarPath.trim().startsWith(PRESET_AVATAR_PREFIX)) return;
  const { error } = await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([avatarPath.trim()]);
  if (error) throw new Error(error.message);
}
