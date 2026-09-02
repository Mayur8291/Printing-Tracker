import { supabase } from "./supabaseClient";

export const INTERNAL_SUPPORT_ISSUE_OPTIONS = [
  "Internet",
  "Power Cut",
  "Water Issue",
  "Machinery",
  "Food",
  "Issue with Asset",
  "Lift not working",
  "Issue with Biometric",
  "Floor Hygeine",
  "Lost Personnal Belongings"
];

export const INTERNAL_SUPPORT_FLOOR_OPTIONS = [
  "Ground Floor",
  "1st Floor",
  "2nd Floor",
  "3rd Floor",
  "4th Floor",
  "5th Floor"
];

export const INTERNAL_SUPPORT_FLOOR_OPTIONAL_ISSUES = [
  "Food",
  "Issue with Asset",
  "Issue with Biometric",
  "Lost Personnal Belongings"
];

export const INTERNAL_SUPPORT_STATUSES = ["Open", "In Progress", "Resolved", "Closed"];

export const INTERNAL_SUPPORT_RESOLVED_STATUS = "Resolved";

export function isInternalSupportResolved(status) {
  return String(status || "").trim() === INTERNAL_SUPPORT_RESOLVED_STATUS;
}

export function partitionInternalSupportIssues(rows) {
  const open = [];
  const resolved = [];
  for (const row of rows || []) {
    if (isInternalSupportResolved(row.status)) resolved.push(row);
    else open.push(row);
  }
  return { open, resolved };
}

export function internalSupportNeedsFloor(selectedIssues) {
  return selectedIssues.some(
    (issue) => !INTERNAL_SUPPORT_FLOOR_OPTIONAL_ISSUES.includes(issue)
  );
}

export function formatInternalSupportIssueDate(raw) {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatInternalSupportIssueTypes(issueTypes) {
  if (!Array.isArray(issueTypes) || issueTypes.length === 0) return "—";
  return issueTypes.join(", ");
}

export function internalSupportIssueDateKey(row) {
  const date = new Date(row?.created_at);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function uniqueInternalSupportHistoryNames(rows) {
  const names = new Set();
  for (const row of rows || []) {
    const name = String(row?.raised_by_name || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function filterInternalSupportHistoryRows(
  rows,
  { dateFrom, dateTo, searchQuery, nameFilter } = {}
) {
  const from = String(dateFrom || "").trim();
  const to = String(dateTo || "").trim();
  const query = String(searchQuery || "").trim().toLowerCase();
  const wantedName = String(nameFilter || "").trim();

  return (rows || []).filter((row) => {
    const key = internalSupportIssueDateKey(row);
    if (from && (!key || key < from)) return false;
    if (to && (!key || key > to)) return false;
    if (wantedName && wantedName !== "all" && String(row?.raised_by_name || "").trim() !== wantedName) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      formatInternalSupportIssueTypes(row.issue_types),
      row.raised_by_name,
      row.floor,
      row.comment,
      row.status
    ]
      .map((part) => String(part || "").toLowerCase())
      .join(" ");
    return haystack.includes(query);
  });
}

export async function listInternalSupportIssues({
  sessionUserId = "",
  isAdmin = false
} = {}) {
  if (!isAdmin && !sessionUserId) {
    console.info("[internal-support] list skipped: no session");
    return [];
  }
  let query = supabase
    .from("internal_support_issues")
    .select(
      "id, raised_by, raised_by_name, issue_types, floor, comment, status, created_at"
    )
    .order("created_at", { ascending: false });
  if (!isAdmin) {
    query = query.eq("raised_by", sessionUserId);
  }
  const { data, error } = await query;
  if (error) {
    console.error("[internal-support] list failed", error);
    throw error;
  }
  return data ?? [];
}

export async function insertInternalSupportIssue({
  raisedBy,
  raisedByName,
  issueTypes,
  floor,
  comment
}) {
  const payload = {
    raised_by: raisedBy,
    raised_by_name: raisedByName,
    issue_types: issueTypes,
    floor: floor || null,
    comment,
    status: "Open"
  };
  const { data, error } = await supabase
    .from("internal_support_issues")
    .insert(payload)
    .select(
      "id, raised_by, raised_by_name, issue_types, floor, comment, status, created_at"
    )
    .single();
  if (error) {
    console.error("[internal-support] insert failed", error);
    throw error;
  }
  return data;
}

export async function updateInternalSupportIssueStatus(
  id,
  status,
  { isAdmin = false, currentStatus } = {}
) {
  if (!isAdmin) {
    const error = new Error("Only an admin can change status.");
    console.error("[internal-support] status update blocked", error);
    throw error;
  }
  if (isInternalSupportResolved(currentStatus)) {
    const error = new Error("Resolved issues cannot change status.");
    console.error("[internal-support] status update blocked", error);
    throw error;
  }
  const { data, error } = await supabase
    .from("internal_support_issues")
    .update({ status })
    .eq("id", id)
    .select(
      "id, raised_by, raised_by_name, issue_types, floor, comment, status, created_at"
    )
    .single();
  if (error) {
    console.error("[internal-support] status update failed", error);
    throw error;
  }
  return data;
}
