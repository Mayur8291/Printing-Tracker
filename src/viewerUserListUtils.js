export function viewerIsActive(profile) {
  return profile?.is_active !== false;
}

export function filterViewerProfiles(viewers, searchQuery, statusFilter) {
  const list = Array.isArray(viewers) ? viewers : [];
  const q = String(searchQuery ?? "").trim().toLowerCase();
  return list.filter((viewer) => {
    if (statusFilter === "active" && !viewerIsActive(viewer)) return false;
    if (statusFilter === "inactive" && viewerIsActive(viewer)) return false;
    if (!q) return true;
    const haystack = [
      viewer?.full_name,
      viewer?.email,
      viewer?.employee_id,
      viewer?.department,
      viewer?.job_role
    ]
      .map((v) => String(v ?? "").toLowerCase())
      .join(" ");
    return haystack.includes(q);
  });
}
