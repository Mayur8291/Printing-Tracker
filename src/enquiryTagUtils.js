import { supabase } from "./supabaseClient";

/**
 * Enquiry tags (Pets, HR, Corporate Giftings, ...). Admin manages the list and
 * which users hold each tag. A tagged enquiry is visible to admins and tag holders.
 * Tables: enquiry_tags, enquiry_tag_members (migration 20261005062316_enquiry_tags.sql).
 */

const TAG_SELECT = "id, name, sort_order, is_active, created_at";

export function isMissingEnquiryTagsTable(error) {
  const msg = String(error?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("enquiry_tags");
}

export async function fetchEnquiryTags() {
  const { data, error } = await supabase
    .from("enquiry_tags")
    .select(TAG_SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createEnquiryTag({ name, createdBy, sortOrder }) {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("Tag name is required.");
  const { data, error } = await supabase
    .from("enquiry_tags")
    .insert({ name: clean, created_by: createdBy ?? null, sort_order: Number(sortOrder) || 0 })
    .select(TAG_SELECT)
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`Tag "${clean}" already exists.`);
    throw new Error(error.message);
  }
  return data;
}

export async function setEnquiryTagActive(tagId, isActive) {
  const { data, error } = await supabase
    .from("enquiry_tags")
    .update({ is_active: Boolean(isActive) })
    .eq("id", tagId)
    .select(TAG_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Admin sees every row; a normal user only sees their own memberships (RLS). */
export async function fetchEnquiryTagMembers() {
  const { data, error } = await supabase.from("enquiry_tag_members").select("tag_id, user_id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setEnquiryTagMember({ tagId, userId, member }) {
  if (!tagId || !userId) throw new Error("Tag and user are required.");
  if (member) {
    const { error } = await supabase
      .from("enquiry_tag_members")
      .upsert({ tag_id: tagId, user_id: userId }, { onConflict: "tag_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("enquiry_tag_members")
    .delete()
    .eq("tag_id", tagId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export function activeEnquiryTags(tags) {
  return (Array.isArray(tags) ? tags : []).filter((t) => t?.is_active !== false);
}

export function enquiryTagNameById(tags) {
  const map = {};
  for (const t of Array.isArray(tags) ? tags : []) {
    if (t?.id) map[t.id] = t.name;
  }
  return map;
}

/** Tag ids the given user holds, from a members list. */
export function enquiryTagIdsForUser(members, userId) {
  const set = new Set();
  for (const m of Array.isArray(members) ? members : []) {
    if (m?.user_id === userId && m?.tag_id) set.add(m.tag_id);
  }
  return set;
}
