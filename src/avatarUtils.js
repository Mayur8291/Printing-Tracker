import { supabase } from "./supabaseClient";

export const PROFILE_AVATAR_BUCKET = "profile-avatars";
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
  const { data } = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(avatarPath.trim());
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

export async function uploadProfileAvatar(userId, file) {
  if (!userId || !file) return null;
  const validationError = validateAvatarPhotoFile(file);
  if (validationError) throw new Error(validationError);

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

  return path;
}

export async function removeProfileAvatar(avatarPath) {
  if (!avatarPath?.trim()) return;
  const { error } = await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([avatarPath.trim()]);
  if (error) throw new Error(error.message);
}
