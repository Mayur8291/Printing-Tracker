import { supabase } from "./supabaseClient";

export const ENQUIRY_ATTACHMENT_BUCKET = "enquiry-attachments";
export const ENQUIRY_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const ENQUIRY_ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export function enquiryAttachmentPublicUrl(storagePath) {
  if (!storagePath?.trim()) return "";
  const { data } = supabase.storage.from(ENQUIRY_ATTACHMENT_BUCKET).getPublicUrl(storagePath.trim());
  return data?.publicUrl ?? "";
}

export function sanitizeEnquiryFileName(name) {
  return (name ?? "photo").replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 120) || "photo";
}

export function validateEnquiryPhotoFile(file) {
  if (!file) return "No file selected";
  if (!ENQUIRY_ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    return "Photo must be JPEG, PNG, or WebP.";
  }
  if (file.size > ENQUIRY_MAX_ATTACHMENT_BYTES) {
    return "Photo must be 8 MB or smaller.";
  }
  return null;
}

export function normalizeEnquiryAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const path = String(item.path ?? "").trim();
      if (!path) return null;
      return {
        path,
        name: String(item.name ?? "photo").trim() || "photo",
        mime: String(item.mime ?? "image/jpeg"),
        size: Number(item.size) || 0,
        url: enquiryAttachmentPublicUrl(path)
      };
    })
    .filter(Boolean);
}

export async function uploadEnquiryPhotos({ userId, enquiryId, files }) {
  if (!userId || !enquiryId) throw new Error("Missing enquiry for photo upload.");
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  const uploaded = [];
  for (const file of list) {
    const err = validateEnquiryPhotoFile(file);
    if (err) throw new Error(err);
    const safeName = sanitizeEnquiryFileName(file.name);
    const path = `${userId}/${enquiryId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(ENQUIRY_ATTACHMENT_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;
    uploaded.push({
      path,
      name: safeName,
      mime: file.type,
      size: file.size,
      url: enquiryAttachmentPublicUrl(path)
    });
  }
  return uploaded;
}
