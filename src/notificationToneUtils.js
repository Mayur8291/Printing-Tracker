import { supabase } from "./supabaseClient";

export const NOTIFICATION_TONE_BUCKET = "notification-tones";
export const NOTIFICATION_TONE_MAX_BYTES = 2 * 1024 * 1024;

export const NOTIFICATION_TONE_ALLOWED_TYPES = new Set(["audio/mpeg", "audio/mp3"]);

export function profileNotificationTonePublicUrl(tonePath) {
  if (!tonePath?.trim()) return "";
  const { data } = supabase.storage.from(NOTIFICATION_TONE_BUCKET).getPublicUrl(tonePath.trim());
  return data?.publicUrl ?? "";
}

export function sanitizeNotificationToneFileName(name) {
  const base = (name ?? "notification-tone")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim()
    .slice(0, 120);
  if (!base) return "notification-tone.mp3";
  return base.toLowerCase().endsWith(".mp3") ? base : `${base}.mp3`;
}

export function validateNotificationToneFile(file) {
  if (!file) return null;
  const type = String(file.type ?? "").toLowerCase();
  const name = String(file.name ?? "").toLowerCase();
  const isMp3 =
    NOTIFICATION_TONE_ALLOWED_TYPES.has(type) || type === "audio/mpeg" || name.endsWith(".mp3");
  if (!isMp3) {
    return "Tone must be an MP3 file.";
  }
  if (file.size > NOTIFICATION_TONE_MAX_BYTES) {
    return "Tone must be 2 MB or smaller.";
  }
  return null;
}

export async function uploadProfileNotificationTone(userId, file) {
  if (!userId || !file) return null;
  const validationError = validateNotificationToneFile(file);
  if (validationError) throw new Error(validationError);

  const safeName = sanitizeNotificationToneFileName(file.name);
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
  const contentType = file.type || "audio/mpeg";

  const { error: uploadErr } = await supabase.storage
    .from(NOTIFICATION_TONE_BUCKET)
    .upload(path, file, { upsert: true, contentType });
  if (uploadErr) throw new Error(uploadErr.message);

  const { data: existing } = await supabase
    .from("profiles")
    .select("notification_tone_path")
    .eq("id", userId)
    .maybeSingle();

  const previousPath = existing?.notification_tone_path?.trim();
  if (previousPath && previousPath !== path) {
    await removeProfileNotificationToneFile(previousPath);
  }

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ notification_tone_path: path })
    .eq("id", userId);
  if (updateErr) throw new Error(updateErr.message);

  return path;
}

export async function removeProfileNotificationToneFile(tonePath) {
  if (!tonePath?.trim()) return;
  const { error } = await supabase.storage
    .from(NOTIFICATION_TONE_BUCKET)
    .remove([tonePath.trim()]);
  if (error) throw new Error(error.message);
}

export async function clearProfileNotificationTone(userId) {
  if (!userId) return;
  const { data: existing } = await supabase
    .from("profiles")
    .select("notification_tone_path")
    .eq("id", userId)
    .maybeSingle();

  const previousPath = existing?.notification_tone_path?.trim();
  if (previousPath) {
    await removeProfileNotificationToneFile(previousPath);
  }

  const { error } = await supabase
    .from("profiles")
    .update({ notification_tone_path: null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
