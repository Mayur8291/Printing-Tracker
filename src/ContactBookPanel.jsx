import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  CONTACT_PHOTO_BUCKET,
  EMPTY_CONTACT_FORM,
  contactPhotoPublicUrl,
  contactToForm,
  displayContactValue,
  filterAndSortContacts,
  formToContactPayload,
  formatContactDob,
  sanitizeContactPhotoName,
  uniqueContactDepartments,
  validateContactPhotoFile
} from "./contactBookUtils";

function ContactDetailRow({ label, value, href }) {
  const text = displayContactValue(value);
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {href && text !== "—" ? (
          <a href={href}>{text}</a>
        ) : (
          <span className="contact-book-card-value">{text}</span>
        )}
      </dd>
    </>
  );
}

export default function ContactBookPanel({ isAdmin, canEdit = false, sessionUserId }) {
  const mayEdit = isAdmin || canEdit;
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_CONTACT_FORM });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");

  const photoInputRef = useRef(null);

  const departmentOptions = useMemo(() => uniqueContactDepartments(contacts), [contacts]);

  const visibleContacts = useMemo(
    () => filterAndSortContacts(contacts, { searchQuery, departmentFilter, sortBy }),
    [contacts, searchQuery, departmentFilter, sortBy]
  );

  const loadContacts = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchErr } = await supabase
      .from("contact_book_entries")
      .select("*")
      .order("name", { ascending: true });

    if (fetchErr) {
      setError(fetchErr.message);
      setContacts([]);
    } else {
      setError("");
      setContacts(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  function openCreateForm() {
    setEditingId(null);
    setForm({ ...EMPTY_CONTACT_FORM });
    setPhotoFile(null);
    setPhotoPreview("");
    setShowForm(true);
    setError("");
  }

  function openEditForm(entry) {
    setEditingId(entry.id);
    setForm(contactToForm(entry));
    setPhotoFile(null);
    setPhotoPreview(contactPhotoPublicUrl(entry.photo_path));
    setShowForm(true);
    setError("");
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setPhotoFile(null);
    setPhotoPreview("");
  }

  function onPhotoPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const validationError = validateContactPhotoFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function uploadContactPhoto(contactId, file) {
    const safeName = sanitizeContactPhotoName(file.name);
    const path = `${contactId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadErr } = await supabase.storage
      .from(CONTACT_PHOTO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (uploadErr) throw new Error(uploadErr.message);
    return path;
  }

  async function removeStoragePhoto(path) {
    if (!path?.trim()) return;
    await supabase.storage.from(CONTACT_PHOTO_BUCKET).remove([path.trim()]);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!mayEdit) return;
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = formToContactPayload(form);

      if (editingId) {
        let photoPath = contacts.find((c) => c.id === editingId)?.photo_path ?? null;
        if (photoFile) {
          if (photoPath) await removeStoragePhoto(photoPath);
          photoPath = await uploadContactPhoto(editingId, photoFile);
        }
        const { error: updateErr } = await supabase
          .from("contact_book_entries")
          .update({
            ...payload,
            photo_path: photoPath,
            updated_at: new Date().toISOString()
          })
          .eq("id", editingId);
        if (updateErr) throw new Error(updateErr.message);
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("contact_book_entries")
          .insert({
            ...payload,
            created_by: sessionUserId,
            photo_path: null
          })
          .select("id")
          .single();
        if (insertErr) throw new Error(insertErr.message);

        let photoPath = null;
        if (photoFile && inserted?.id) {
          photoPath = await uploadContactPhoto(inserted.id, photoFile);
          const { error: photoUpdateErr } = await supabase
            .from("contact_book_entries")
            .update({ photo_path: photoPath })
            .eq("id", inserted.id);
          if (photoUpdateErr) throw new Error(photoUpdateErr.message);
        }
      }

      closeForm();
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry) {
    if (!mayEdit || !entry?.id) return;
    if (!window.confirm(`Delete ${entry.name} from Contact Book? This cannot be undone.`)) return;

    setSaving(true);
    setError("");
    try {
      if (entry.photo_path) await removeStoragePhoto(entry.photo_path);
      const { error: delErr } = await supabase.from("contact_book_entries").delete().eq("id", entry.id);
      if (delErr) throw new Error(delErr.message);
      if (editingId === entry.id) closeForm();
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const editingEntry = editingId ? contacts.find((c) => c.id === editingId) : null;

  return (
    <section className="panel contact-book-panel dashboard-card">
      <header className="contact-book-head">
        <div className="contact-book-head-text">
          <h2 className="dashboard-section-title">Contact Book</h2>
          <p className="dashboard-section-lead">
            Team contacts with photo and details. {mayEdit ? "You can add, edit, and delete entries." : "View only."}
          </p>
        </div>
        {mayEdit && !showForm ? (
          <button type="button" className="contact-book-add-btn" onClick={openCreateForm}>
            + Add contact
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="contact-book-error" role="alert">
          {error}
        </p>
      ) : null}

      {showForm && mayEdit ? (
        <form className="contact-book-form" onSubmit={handleSave}>
          <div className="contact-book-form-header">
            <h3>{editingId ? "Edit contact" : "New contact"}</h3>
            <button type="button" className="contact-book-form-close" onClick={closeForm} disabled={saving}>
              ✕
            </button>
          </div>

          <div className="contact-book-photo-row">
            <span className="contact-book-field-label">Photo</span>
            <button
              type="button"
              className="contact-book-photo-tap"
              onClick={() => photoInputRef.current?.click()}
              aria-label="Upload or change photo"
            >
              {photoPreview ? (
                <img src={photoPreview} alt="" />
              ) : (
                <span className="contact-book-photo-tap-hint">
                  <span className="contact-book-photo-tap-icon" aria-hidden>
                    📷
                  </span>
                  Tap to add photo
                </span>
              )}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              className="contact-book-photo-input"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onPhotoPick}
              tabIndex={-1}
              aria-hidden
            />
          </div>

          <div className="contact-book-fields">
            <label className="contact-book-field">
              <span className="contact-book-field-label">
                Name <span className="contact-book-required">*</span>
              </span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label className="contact-book-field">
              <span className="contact-book-field-label">Designation</span>
              <input
                type="text"
                value={form.designation}
                onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
              />
            </label>
            <label className="contact-book-field">
              <span className="contact-book-field-label">Department</span>
              <input
                type="text"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                placeholder="e.g. Sales, Printing"
              />
            </label>
            <label className="contact-book-field">
              <span className="contact-book-field-label">Contact number</span>
              <input
                type="tel"
                value={form.contact_number}
                onChange={(e) => setForm((f) => ({ ...f, contact_number: e.target.value }))}
              />
            </label>
            <label className="contact-book-field">
              <span className="contact-book-field-label">Alternate contact number</span>
              <input
                type="tel"
                value={form.alternate_contact_number}
                onChange={(e) => setForm((f) => ({ ...f, alternate_contact_number: e.target.value }))}
              />
            </label>
            <label className="contact-book-field">
              <span className="contact-book-field-label">Date of birth</span>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))}
              />
            </label>
            <label className="contact-book-field">
              <span className="contact-book-field-label">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="contact-book-field contact-book-field--full">
              <span className="contact-book-field-label">Address</span>
              <textarea
                rows={3}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </label>
          </div>

          <div className="contact-book-form-actions">
            {editingEntry ? (
              <button
                type="button"
                className="contact-book-delete-btn contact-book-delete-btn--form"
                onClick={() => handleDelete(editingEntry)}
                disabled={saving}
              >
                Delete contact
              </button>
            ) : (
              <span />
            )}
            <div className="contact-book-form-actions-right">
              <button type="button" className="contact-book-cancel-btn" onClick={closeForm} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="contact-book-save-btn" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <div className="contact-book-list-wrap">
        {loading ? (
          <p className="contact-book-empty">Loading contacts…</p>
        ) : contacts.length === 0 ? (
          <p className="contact-book-empty">
            {mayEdit ? "No contacts yet. Click Add contact to create one." : "No contacts in the book yet."}
          </p>
        ) : (
          <>
            <div className="contact-book-toolbar">
              <label className="contact-book-toolbar-field">
                <span className="contact-book-field-label">Search</span>
                <input
                  type="search"
                  placeholder="Name, department, phone, email…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
              <label className="contact-book-toolbar-field">
                <span className="contact-book-field-label">Department</span>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <option value="">All departments</option>
                  {departmentOptions.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                  <option value="__none__">No department</option>
                </select>
              </label>
              <label className="contact-book-toolbar-field">
                <span className="contact-book-field-label">Sort by</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="name">Name (A–Z)</option>
                  <option value="department">Department, then name</option>
                </select>
              </label>
            </div>

            {visibleContacts.length === 0 ? (
              <p className="contact-book-empty">No contacts match your search or filter.</p>
            ) : (
              <div className="contact-book-grid">
                {visibleContacts.map((entry) => {
              const photoUrl = contactPhotoPublicUrl(entry.photo_path);
              const dobDisplay = entry.date_of_birth ? formatContactDob(entry.date_of_birth) : "";
              return (
                <article key={entry.id} className="contact-book-card">
                  <div className="contact-book-card-photo">
                    {photoUrl ? (
                      <img src={photoUrl} alt="" />
                    ) : (
                      <span className="contact-book-card-photo-fallback" aria-hidden>
                        👤
                      </span>
                    )}
                  </div>
                  <div className="contact-book-card-body">
                    <h3 className="contact-book-card-name">{entry.name}</h3>
                    {entry.designation?.trim() ? (
                      <p className="contact-book-card-designation">{entry.designation}</p>
                    ) : null}
                    {entry.department?.trim() ? (
                      <p className="contact-book-card-department">{entry.department}</p>
                    ) : null}
                    <dl className="contact-book-card-details">
                      <ContactDetailRow label="Contact" value={entry.contact_number} href={entry.contact_number ? `tel:${entry.contact_number}` : undefined} />
                      <ContactDetailRow
                        label="Alt. contact"
                        value={entry.alternate_contact_number}
                        href={
                          entry.alternate_contact_number
                            ? `tel:${entry.alternate_contact_number}`
                            : undefined
                        }
                      />
                      <ContactDetailRow
                        label="Email"
                        value={entry.email}
                        href={entry.email ? `mailto:${entry.email}` : undefined}
                      />
                      <ContactDetailRow label="Date of birth" value={dobDisplay} />
                      <ContactDetailRow label="Address" value={entry.address} />
                    </dl>
                    {mayEdit ? (
                      <div className="contact-book-card-actions">
                        <button
                          type="button"
                          className="contact-book-edit-btn"
                          onClick={() => openEditForm(entry)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="contact-book-delete-btn"
                          onClick={() => handleDelete(entry)}
                          disabled={saving}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
