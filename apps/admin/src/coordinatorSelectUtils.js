import { viewerIsActive } from "./viewerUserListUtils";

/** Display name stored in orders.coordinator_name (matches admin-set full_name). */
export function profileDisplayName(profile) {
  if (!profile) return "";
  return String(profile.full_name ?? "").trim() || String(profile.email ?? "").trim();
}

/**
 * Coordinator dropdown options for create-order (and similar forms).
 * Admins: active viewer + admin profiles + coordinators master list (deduped by name).
 * Others: coordinators master + ensure current user appears if missing.
 */
export function createCoordinatorSelectOptions({
  coordinators = [],
  viewerProfiles = [],
  isAdmin = false,
  currentUserName = ""
}) {
  const byKey = new Map();

  const add = (name, id) => {
    const n = String(name ?? "").trim();
    if (!n) return;
    const key = n.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { id, name: n });
  };

  if (isAdmin) {
    for (const userProfile of viewerProfiles) {
      if (!viewerIsActive(userProfile)) continue;
      add(userProfile.full_name, `profile-${userProfile.id}`);
    }
  }

  for (const row of coordinators) {
    add(row?.name, `coord-${row.id}`);
  }

  add(currentUserName, "current-user");

  return Array.from(byKey.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export function buildProfileLookupList(...profileLists) {
  const byId = new Map();
  for (const list of profileLists) {
    for (const profile of list ?? []) {
      if (profile?.id) byId.set(profile.id, profile);
    }
  }
  return Array.from(byId.values());
}

/** Match orders.coordinator_name to profiles.full_name (case-insensitive trim). */
export function findProfileIdByCoordinatorName(coordinatorName, profiles) {
  const target = String(coordinatorName ?? "").trim().toLowerCase();
  if (!target) return null;
  for (const profile of profiles ?? []) {
    const name = String(profile?.full_name ?? "").trim().toLowerCase();
    if (name && name === target) return profile.id;
  }
  return null;
}
