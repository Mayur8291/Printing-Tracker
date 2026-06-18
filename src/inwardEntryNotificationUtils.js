/**
 * Notify tagged users when an inward entry is created.
 */
export async function insertInwardEntryTagNotifications(
  supabase,
  {
    inwardEntryId,
    taggedUserIds = [],
    taggedByUserId,
    productMaterial = "",
    department = "",
    grnNo = ""
  }
) {
  const assignerId = taggedByUserId;
  const entryId = inwardEntryId;
  if (!assignerId || !entryId) return { ok: true, skipped: true };

  const uniqueIds = [
    ...new Set(
      (Array.isArray(taggedUserIds) ? taggedUserIds : [])
        .map((id) => String(id ?? "").trim())
        .filter((id) => id && id !== assignerId)
    )
  ];

  if (!uniqueIds.length) return { ok: true, skipped: true };

  const tagRows = uniqueIds.map((tagged_user_id) => ({
    inward_entry_id: entryId,
    tagged_user_id,
    tagged_by_user_id: assignerId
  }));

  const notificationRows = uniqueIds.map((recipient_user_id) => ({
    recipient_user_id,
    inward_entry_id: entryId,
    product_material: String(productMaterial ?? "").trim(),
    department: String(department ?? "").trim(),
    grn_no: String(grnNo ?? "").trim(),
    tagged_by_user_id: assignerId
  }));

  const { error: tagError } = await supabase.from("inward_entry_tags").insert(tagRows);
  if (tagError) {
    if (tagError.message?.includes("Could not find the table")) {
      console.warn(
        "inward_entry_tags table missing — run migration 20260623120000_add_inward_entry_tags_notifications.sql"
      );
      return { ok: false, skipped: true, error: tagError };
    }
    console.error("Inward entry tags:", tagError.message);
    return { ok: false, error: tagError };
  }

  const { error: notifError } = await supabase.from("inward_entry_notifications").insert(notificationRows);
  if (notifError) {
    if (notifError.message?.includes("Could not find the table")) {
      console.warn(
        "inward_entry_notifications table missing — run migration 20260623120000_add_inward_entry_tags_notifications.sql"
      );
      return { ok: false, skipped: true, error: notifError };
    }
    console.error("Inward entry notifications:", notifError.message);
    return { ok: false, error: notifError };
  }

  return { ok: true };
}
