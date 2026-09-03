import { supabase } from "./supabaseClient";
import { generateNextAssetTag } from "./assetTagUtils";
import { profileDisplayName } from "./coordinatorSelectUtils";

export const HR_ASSET_SELECT =
  "id, tag, name, category, manufacturer, model, serial_number, purchase_date, location, status, assignee_user_id, assignee_name, notes, charger_included, created_by, created_at, updated_at";

function assigneeLabel(user) {
  return profileDisplayName(user) || user?.email || "User";
}

export function formatAssetSeen(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.round(diffMs / 60_000))}m ago`;
  if (diffMs < 86_400_000) return `${Math.max(1, Math.round(diffMs / 3_600_000))}h ago`;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function mapHrAssetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    cat: row.category,
    status: row.status,
    assignee: row.assignee_name || "—",
    assigneeUserId: row.assignee_user_id || null,
    location: row.location || "—",
    seen: formatAssetSeen(row.updated_at),
    serial: String(row.serial_number || "").trim() || "—",
    maker: String(row.manufacturer || "").trim() || "—",
    model: String(row.model || "").trim() || "—",
    purchaseDate: String(row.purchase_date || "").trim() || "—",
    notes: row.notes || "",
    chargerIncluded: Boolean(row.charger_included),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function summarizeHrAssetCategories(assets) {
  const counts = new Map();
  for (const asset of assets || []) {
    const name = asset.cat || "—";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const total = (assets || []).length;
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({
      name,
      count,
      pct: total ? `${Math.round((count / total) * 100)}%` : "0%"
    }));
}

export function summarizeHrAssetStatuses(assets) {
  const counts = {
    Available: 0,
    "Checked out": 0,
    Maintenance: 0,
    Retired: 0
  };
  for (const asset of assets || []) {
    if (Object.prototype.hasOwnProperty.call(counts, asset.status)) {
      counts[asset.status] += 1;
    }
  }
  const total = (assets || []).length;
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({
      label,
      count,
      pct: total ? `${Math.round((count / total) * 100)}%` : "0%"
    }));
}

export async function listHrAssets() {
  const { data, error } = await supabase
    .from("hr_assets")
    .select(HR_ASSET_SELECT)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[hr-assets] list failed", error);
    throw error;
  }
  return (data ?? []).map(mapHrAssetRow);
}

function isUniqueTagError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "23505" || message.includes("hr_assets_tag_unique") || message.includes("duplicate key");
}

export async function insertHrAsset({
  sessionUserId,
  form,
  charger = true,
  directoryUsers = [],
  existingTags = []
}) {
  if (!sessionUserId) {
    const error = new Error("Sign in to save an asset.");
    console.error("[hr-assets] insert blocked", error);
    throw error;
  }
  const name = String(form?.["Asset name"] || "").trim();
  if (!name) {
    const error = new Error("Asset name is required.");
    console.error("[hr-assets] insert blocked", error);
    throw error;
  }

  const assigneeUserId = String(form?.["Assigned to"] || "").trim();
  const user = directoryUsers.find((entry) => entry.id === assigneeUserId);
  const assigned = Boolean(assigneeUserId && user);
  const tags = [...existingTags];
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tag = generateNextAssetTag(tags);
    const payload = {
      tag,
      name,
      category: form?.Category || "Laptop",
      manufacturer: String(form?.Manufacturer || "").trim(),
      model: String(form?.Model || "").trim(),
      serial_number: String(form?.["Serial number"] || "").trim(),
      purchase_date: String(form?.["Purchase date"] || "").trim(),
      location: form?.Location || "Ground floor",
      status: assigned ? "Checked out" : "Available",
      assignee_user_id: assigned ? assigneeUserId : null,
      assignee_name: assigned ? assigneeLabel(user) : "—",
      notes: String(form?.Notes || "").trim(),
      charger_included: Boolean(charger),
      created_by: sessionUserId
    };
    const { data, error } = await supabase
      .from("hr_assets")
      .insert(payload)
      .select(HR_ASSET_SELECT)
      .single();
    if (!error) return mapHrAssetRow(data);
    lastError = error;
    if (isUniqueTagError(error)) {
      tags.push(tag);
      continue;
    }
    console.error("[hr-assets] insert failed", error);
    throw error;
  }

  console.error("[hr-assets] insert failed", lastError);
  throw lastError || new Error("Could not allocate an asset tag.");
}

export async function assignHrAsset(id, { userId, assigneeName }) {
  if (!id || !userId || !assigneeName) {
    const error = new Error("Pick a user to assign this asset.");
    console.error("[hr-assets] assign blocked", error);
    throw error;
  }
  const { data, error } = await supabase
    .from("hr_assets")
    .update({
      assignee_user_id: userId,
      assignee_name: assigneeName,
      status: "Checked out"
    })
    .eq("id", id)
    .select(HR_ASSET_SELECT)
    .single();
  if (error) {
    console.error("[hr-assets] assign failed", error);
    throw error;
  }
  return mapHrAssetRow(data);
}

export async function checkInHrAsset(id) {
  if (!id) {
    const error = new Error("Missing asset id.");
    console.error("[hr-assets] check-in blocked", error);
    throw error;
  }
  const { data, error } = await supabase
    .from("hr_assets")
    .update({
      assignee_user_id: null,
      assignee_name: "—",
      status: "Available"
    })
    .eq("id", id)
    .select(HR_ASSET_SELECT)
    .single();
  if (error) {
    console.error("[hr-assets] check-in failed", error);
    throw error;
  }
  return mapHrAssetRow(data);
}
