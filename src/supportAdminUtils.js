import { supabase } from "./supabaseClient";

export function isMissingSupportAdminsTable(error) {
  const msg = String(error?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("support_admins");
}

export async function fetchSupportAdminIds() {
  const { data, error } = await supabase.from("support_admins").select("user_id");
  if (error) {
    if (isMissingSupportAdminsTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => r.user_id).filter(Boolean);
}

/** Platform admin only (RLS). Writes an audit row for grant/revoke. */
export async function setSupportAdminMember({ userId, member, grantedBy }) {
  if (!userId) throw new Error("User is required.");
  if (member) {
    const { error } = await supabase
      .from("support_admins")
      .upsert({ user_id: userId, granted_by: grantedBy ?? null, granted_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    const { error: auditErr } = await supabase.from("support_admin_audit").insert({
      user_id: userId,
      action: "granted",
      actor_id: grantedBy ?? null
    });
    if (auditErr) console.warn("support admin audit:", auditErr.message);
    return;
  }
  const { error } = await supabase.from("support_admins").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
  const { error: auditErr } = await supabase.from("support_admin_audit").insert({
    user_id: userId,
    action: "revoked",
    actor_id: grantedBy ?? null
  });
  if (auditErr) console.warn("support admin audit:", auditErr.message);
}
