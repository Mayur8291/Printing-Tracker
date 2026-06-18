import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { profileDisplayName } from "./coordinatorSelectUtils";
import { viewerIsActive } from "./viewerUserListUtils";

const SUGGESTION_LIMIT = 8;

function userLabel(profile) {
  const name = profileDisplayName(profile);
  const email = String(profile?.email ?? "").trim();
  if (name && email && name !== email) return name;
  return name || email || "User";
}

function userSubLabel(profile) {
  const email = String(profile?.email ?? "").trim();
  const dept = String(profile?.department ?? "").trim();
  if (email && dept) return `${email} · ${dept}`;
  return email || dept || "";
}

function matchesQuery(user, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = [user.full_name, user.email, user.department, user.job_role, user.employee_id]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  return haystack.includes(q);
}

export default function InwardUserTagPicker({ selectedIds, onChange, excludeUserId }) {
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, department, job_role, employee_id, is_active, role")
        .eq("role", "viewer")
        .order("full_name", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Inward tag users:", error.message);
        setUsers([]);
      } else {
        setUsers((data ?? []).filter((row) => viewerIsActive(row)));
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);

  const selectedUsers = useMemo(
    () => users.filter((user) => selectedSet.has(user.id)),
    [users, selectedSet]
  );

  const suggestions = useMemo(() => {
    const exclude = String(excludeUserId ?? "").trim();
    const q = query.trim();
    if (!q) return [];
    return users
      .filter((user) => {
        if (exclude && user.id === exclude) return false;
        if (selectedSet.has(user.id)) return false;
        return matchesQuery(user, q);
      })
      .slice(0, SUGGESTION_LIMIT);
  }, [users, query, excludeUserId, selectedSet]);

  const showMenu = menuOpen && query.trim().length > 0;

  useEffect(() => {
    if (!showMenu) return undefined;
    function onDocumentMouseDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [showMenu]);

  function addUser(user) {
    if (!user?.id || selectedSet.has(user.id)) return;
    onChange?.([...selectedSet, user.id]);
    setQuery("");
    setMenuOpen(false);
    inputRef.current?.focus();
  }

  function removeUser(userId) {
    onChange?.([...selectedSet].filter((id) => id !== userId));
  }

  return (
    <div className="inward-tag-picker" ref={wrapRef}>
      <div className="inward-tag-picker-head">
        <label className="create-oc-field-label" htmlFor="inward-tag-user-input" id="inward-tag-users-label">
          Tag users
        </label>
        <span className="inward-tag-picker-hint">Type a name — tagged users get notified about this inward entry</span>
      </div>

      {selectedUsers.length > 0 ? (
        <ul className="inward-tag-chip-list" aria-label="Tagged users">
          {selectedUsers.map((user) => (
            <li key={user.id}>
              <span className="inward-tag-chip">
                <span className="inward-tag-chip-label">{userLabel(user)}</span>
                <button
                  type="button"
                  className="inward-tag-chip-remove"
                  aria-label={`Remove ${userLabel(user)}`}
                  onClick={() => removeUser(user.id)}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="inward-tag-picker-combobox">
        <input
          ref={inputRef}
          id="inward-tag-user-input"
          type="text"
          className="inward-tag-picker-search"
          placeholder={loading ? "Loading users…" : "Type name or email…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMenuOpen(true);
          }}
          onFocus={() => setMenuOpen(true)}
          aria-labelledby="inward-tag-users-label"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls="inward-tag-suggest-menu"
          autoComplete="off"
        />
        {showMenu ? (
          <ul id="inward-tag-suggest-menu" className="inward-tag-suggest-menu" role="listbox">
            {loading ? <li className="inward-tag-suggest-empty">Loading users…</li> : null}
            {!loading && suggestions.length === 0 ? (
              <li className="inward-tag-suggest-empty">No matching users</li>
            ) : null}
            {!loading
              ? suggestions.map((user) => {
                  const sub = userSubLabel(user);
                  return (
                    <li key={user.id} role="option">
                      <button type="button" onClick={() => addUser(user)}>
                        <span className="inward-tag-suggest-name">{userLabel(user)}</span>
                        {sub ? <span className="inward-tag-suggest-sub">{sub}</span> : null}
                      </button>
                    </li>
                  );
                })
              : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
