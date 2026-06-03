import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const CATEGORIES = [
  { id: "sharepoint", label: "SharePoint / OneDrive" },
  { id: "excel", label: "Excel / Sheets" },
  { id: "other", label: "Other" }
];

const EMPTY_FORM = {
  title: "",
  url: "",
  description: "",
  category: "sharepoint",
  sort_order: "0"
};

function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

function normalizeUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function isValidUrl(raw) {
  const s = normalizeUrl(raw);
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function hostFromUrl(raw) {
  try {
    return new URL(normalizeUrl(raw)).host;
  } catch {
    return "";
  }
}

export default function SharedLinksPanel({ isAdmin, canEdit = false }) {
  const mayEdit = isAdmin || canEdit;
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const loadLinks = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchErr } = await supabase
      .from("shared_resource_links")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });

    if (fetchErr) {
      setError(fetchErr.message);
      setLinks([]);
    } else {
      setError("");
      setLinks(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const visibleLinks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return links.filter((row) => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [
        row.title,
        row.description,
        row.url,
        categoryLabel(row.category)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [links, searchQuery, categoryFilter]);

  function openCreateForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEditForm(row) {
    setEditingId(row.id);
    setForm({
      title: row.title ?? "",
      url: row.url ?? "",
      description: row.description ?? "",
      category: row.category ?? "other",
      sort_order: String(row.sort_order ?? 0)
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  async function handleSave(e) {
    e.preventDefault();
    const title = form.title.trim();
    const url = normalizeUrl(form.url);
    const description = form.description.trim() || null;
    const sortOrder = Number.parseInt(form.sort_order, 10);
    if (!title) {
      alert("Give the link a title.");
      return;
    }
    if (!isValidUrl(url)) {
      alert("Enter a valid link (must start with http:// or https://).");
      return;
    }
    const payload = {
      title,
      url,
      description,
      category: form.category || "other",
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0
    };
    setSaving(true);
    try {
      if (editingId) {
        const { error: updErr } = await supabase
          .from("shared_resource_links")
          .update(payload)
          .eq("id", editingId);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await supabase.from("shared_resource_links").insert(payload);
        if (insErr) throw new Error(insErr.message);
      }
      await loadLinks();
      closeForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row) {
    if (!row?.id) return;
    if (!window.confirm(`Delete link "${row.title}"?`)) return;
    try {
      const { error: delErr } = await supabase
        .from("shared_resource_links")
        .delete()
        .eq("id", row.id);
      if (delErr) throw new Error(delErr.message);
      await loadLinks();
      if (editingId === row.id) closeForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel table-panel dashboard-card shared-links-panel">
      <header className="dashboard-panel-head shared-links-head">
        <div>
          <h2 className="dashboard-section-title">Shared Links</h2>
        </div>
        {mayEdit ? (
          <button type="button" className="shared-links-add-btn" onClick={openCreateForm}>
            + Add link
          </button>
        ) : null}
      </header>

      <div className="shared-links-toolbar">
        <label className="shared-links-search">
          Search
          <input
            type="search"
            placeholder="Title, description, URL…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        <label>
          Category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="shared-links-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p>Loading links…</p>
      ) : visibleLinks.length === 0 ? (
        <p className="shared-links-empty">
          {links.length === 0 ? "No shared links yet." : "No links match your search."}
        </p>
      ) : (
        <ul className="shared-links-grid">
          {visibleLinks.map((row) => {
            const href = normalizeUrl(row.url);
            const host = hostFromUrl(row.url);
            return (
              <li key={row.id} className="shared-links-card">
                <a
                  className="shared-links-card-open"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${row.title}`}
                >
                  <span className={`shared-links-card-badge shared-links-card-badge--${row.category}`}>
                    {categoryLabel(row.category)}
                  </span>
                  <span className="shared-links-card-title">{row.title}</span>
                  {row.description ? (
                    <span className="shared-links-card-desc">{row.description}</span>
                  ) : null}
                  <span className="shared-links-card-url">{host || row.url}</span>
                  <span className="shared-links-card-cta">Open link ↗</span>
                </a>
                {mayEdit ? (
                  <div className="shared-links-card-admin">
                    <button type="button" onClick={() => openEditForm(row)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="shared-links-card-delete"
                      onClick={() => handleDelete(row)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {showForm && mayEdit ? (
        <div className="shared-links-form-backdrop" onClick={closeForm}>
          <form
            className="shared-links-form"
            onSubmit={handleSave}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shared-links-form-head">
              <h3>{editingId ? "Edit link" : "Add link"}</h3>
              <button type="button" className="order-detail-close" aria-label="Close" onClick={closeForm}>
                ×
              </button>
            </div>
            <label>
              Title
              <input
                type="text"
                required
                maxLength={200}
                placeholder="e.g. Production Excel tracker"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </label>
            <label>
              URL
              <input
                type="url"
                required
                placeholder="https://…"
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              />
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description <span className="shared-links-optional">(optional)</span>
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Short note about what this link is for"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </label>
            <label>
              Sort order
              <input
                type="number"
                min="0"
                step="1"
                value={form.sort_order}
                onChange={(e) => setForm((prev) => ({ ...prev, sort_order: e.target.value }))}
              />
            </label>
            <div className="shared-links-form-actions">
              <button type="button" onClick={closeForm} disabled={saving}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Update link" : "Save link"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
