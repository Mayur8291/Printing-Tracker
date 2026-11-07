export const ORDER_CUSTOMER_ASSETS_BUCKET = "order-customer-assets";

export const CUSTOMER_ASSET_RETENTION_HOURS = 48;

export function downloadLocalFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name || "download";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function customerAssetExpiresAt(uploadedAtIso) {
  if (!uploadedAtIso) return null;
  const uploaded = new Date(uploadedAtIso);
  if (Number.isNaN(uploaded.getTime())) return null;
  return new Date(uploaded.getTime() + CUSTOMER_ASSET_RETENTION_HOURS * 60 * 60 * 1000);
}

export function formatCustomerAssetExpiry(uploadedAtIso) {
  const expires = customerAssetExpiresAt(uploadedAtIso);
  if (!expires) return "";
  return expires.toLocaleString();
}

export async function fetchOrderCustomerAssets(supabase, orderId) {
  const { data, error } = await supabase
    .from("order_customer_assets")
    .select("id, file_name, storage_path, mime_type, file_size, uploaded_at")
    .eq("order_id", orderId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

const CUSTOMER_ASSET_SIGNED_URL_TTL_SEC = 60 * 60;

export function customerAssetIsPreviewable(mimeType, fileName) {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (mime === "application/pdf") return true;
  const name = (fileName || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?|pdf)$/i.test(name);
}

export async function customerAssetSignedUrl(supabase, storagePath, opts = {}) {
  if (!storagePath) return null;
  const { download = false } = opts;
  const { data, error } = await supabase.storage
    .from(ORDER_CUSTOMER_ASSETS_BUCKET)
    .createSignedUrl(storagePath, CUSTOMER_ASSET_SIGNED_URL_TTL_SEC, { download });
  if (error) {
    console.warn("customer asset signed url failed", storagePath, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Fetch rows and attach view/download signed URLs (works for private or public bucket). */
export async function fetchOrderCustomerAssetsWithUrls(supabase, orderId) {
  const rows = await fetchOrderCustomerAssets(supabase, orderId);
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const [viewUrl, downloadUrl] = await Promise.all([
        customerAssetSignedUrl(supabase, row.storage_path, { download: false }),
        customerAssetSignedUrl(supabase, row.storage_path, {
          download: row.file_name || true
        })
      ]);
      return { ...row, viewUrl, downloadUrl };
    })
  );
  return enriched;
}

export function customerAssetPublicUrl(supabase, storagePath) {
  const { data } = supabase.storage.from(ORDER_CUSTOMER_ASSETS_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl ?? "";
}

export async function uploadOrderCustomerAssets(supabase, orderId, files, uploadedBy) {
  if (!orderId || !files?.length) return [];
  const saved = [];
  for (const file of files) {
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/\s+/g, "-")}`;
    const storagePath = `${orderId}/${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(ORDER_CUSTOMER_ASSETS_BUCKET)
      .upload(storagePath, file, { upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: row, error: rowError } = await supabase
      .from("order_customer_assets")
      .insert({
        order_id: orderId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size ?? null,
        uploaded_by: uploadedBy ?? null
      })
      .select("id, file_name, storage_path, uploaded_at")
      .single();
    if (rowError) throw new Error(rowError.message);
    saved.push(row);
  }
  return saved;
}
