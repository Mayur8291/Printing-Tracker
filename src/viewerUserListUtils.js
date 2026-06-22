export function viewerIsActive(profile) {
  return profile?.is_active !== false;
}

export function profileAccessRole(profile) {
  return String(profile?.role ?? "viewer").trim().toLowerCase() === "admin" ? "admin" : "viewer";
}

export function formatProfileAccessLabel(profile) {
  return profileAccessRole(profile) === "admin" ? "Admin" : "Viewer";
}

export function filterViewerProfiles(viewers, searchQuery, statusFilter, accessFilter = "all") {
  const list = Array.isArray(viewers) ? viewers : [];
  const q = String(searchQuery ?? "").trim().toLowerCase();
  return list.filter((viewer) => {
    if (statusFilter === "active" && !viewerIsActive(viewer)) return false;
    if (statusFilter === "inactive" && viewerIsActive(viewer)) return false;
    if (accessFilter === "admin" && profileAccessRole(viewer) !== "admin") return false;
    if (accessFilter === "viewer" && profileAccessRole(viewer) !== "viewer") return false;
    if (!q) return true;
    const haystack = [
      viewer?.full_name,
      viewer?.email,
      viewer?.employee_id,
      viewer?.department,
      viewer?.job_role,
      formatProfileAccessLabel(viewer)
    ]
      .map((v) => String(v ?? "").toLowerCase())
      .join(" ");
    return haystack.includes(q);
  });
}
