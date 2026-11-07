import { supabase } from "./supabaseClient";

export const CONTACT_PHOTO_BUCKET = "contact-book-photos";
export const CONTACT_MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const CONTACT_ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

export function contactPhotoPublicUrl(photoPath) {
  if (!photoPath?.trim()) return "";
  const { data } = supabase.storage.from(CONTACT_PHOTO_BUCKET).getPublicUrl(photoPath.trim());
  return data?.publicUrl ?? "";
}

export function sanitizeContactPhotoName(name) {
  return (name ?? "photo").replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 120) || "photo";
}

export function validateContactPhotoFile(file) {
  if (!file) return null;
  if (!CONTACT_ALLOWED_PHOTO_TYPES.has(file.type)) {
    return "Photo must be JPEG, PNG, WebP, or GIF";
  }
  if (file.size > CONTACT_MAX_PHOTO_BYTES) {
    return "Photo must be 5 MB or smaller";
  }
  return null;
}

export function formatContactDob(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export const EMPTY_CONTACT_FORM = {
  name: "",
  designation: "",
  department: "",
  contact_number: "",
  alternate_contact_number: "",
  date_of_birth: "",
  address: "",
  email: ""
};

export function contactToForm(entry) {
  if (!entry) return { ...EMPTY_CONTACT_FORM };
  return {
    name: entry.name ?? "",
    designation: entry.designation ?? "",
    department: entry.department ?? "",
    contact_number: entry.contact_number ?? "",
    alternate_contact_number: entry.alternate_contact_number ?? "",
    date_of_birth: entry.date_of_birth ?? "",
    address: entry.address ?? "",
    email: entry.email ?? ""
  };
}

export function displayContactValue(value) {
  const text = (value ?? "").toString().trim();
  return text || "—";
}

export function filterAndSortContacts(contacts, { searchQuery, departmentFilter, sortBy }) {
  let list = [...(contacts ?? [])];
  const q = (searchQuery ?? "").trim().toLowerCase();

  if (q) {
    list = list.filter((c) => {
      const haystack = [
        c.name,
        c.designation,
        c.department,
        c.contact_number,
        c.alternate_contact_number,
        c.email,
        c.address
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  if (departmentFilter === "__none__") {
    list = list.filter((c) => !(c.department ?? "").trim());
  } else if (departmentFilter) {
    list = list.filter((c) => (c.department ?? "").trim() === departmentFilter);
  }

  list.sort((a, b) => {
    if (sortBy === "department") {
      const da = (a.department ?? "").trim().toLowerCase();
      const db = (b.department ?? "").trim().toLowerCase();
      if (!da && db) return 1;
      if (da && !db) return -1;
      const deptCmp = da.localeCompare(db);
      if (deptCmp !== 0) return deptCmp;
    }
    return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
  });

  return list;
}

export function uniqueContactDepartments(contacts) {
  const set = new Set();
  for (const c of contacts ?? []) {
    const d = (c.department ?? "").trim();
    if (d) set.add(d);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function formToContactPayload(form) {
  return {
    name: form.name.trim(),
    designation: form.designation.trim() || null,
    department: form.department.trim() || null,
    contact_number: form.contact_number.trim() || null,
    alternate_contact_number: form.alternate_contact_number.trim() || null,
    date_of_birth: form.date_of_birth || null,
    address: form.address.trim() || null,
    email: form.email.trim() || null
  };
}
