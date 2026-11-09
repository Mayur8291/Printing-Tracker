// Source contacts are Indian numbers; explicit international country codes remain intact.
// Input comes only from an already scoped person DTO, never an arbitrary destination URL.
export function contactLinks(phone) {
  if (typeof phone !== 'string' || phone.length > 40) return null;
  const value = phone.trim().replace(/[ ()-]/g, '');
  let digits;
  if (/^\+[1-9]\d{7,14}$/.test(value)) digits = value.slice(1);
  else if (/^[1-9]\d{9}$/.test(value)) digits = `91${value}`;
  else if (/^91[1-9]\d{9}$/.test(value)) digits = value;
  else return null;
  return { whatsapp: `https://wa.me/${digits}`, telephone: `tel:+${digits}` };
}

export function accountContacts(person) {
  const source = person?.linked_dealers?.length ? person.linked_dealers : person?.coordinator_contact ? [person.coordinator_contact] : [];
  const seen = new Set();
  return source.filter(person => person && /^[1-9]\d*$/.test(String(person.id)) && !seen.has(String(person.id)) && seen.add(String(person.id)));
}
