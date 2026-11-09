export function text(value, fallback = "—") { return value == null || value === "" ? fallback : String(value); }
export function number(value) { return value == null ? "—" : new Intl.NumberFormat("en-IN").format(Number(value)); }
export function money(value) {
  if (value == null || value === "") return "—";
  const [integer, fraction = ""] = String(value).split(".");
  if (!/^-?\d+$/.test(integer) || !/^\d*$/.test(fraction)) return "—";
  return `₹${BigInt(integer).toLocaleString("en-IN")}.${fraction.padEnd(2, "0")}`;
}
export function date(value, time = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", ...(time ? { timeStyle: "short" } : {}), timeZone: "Asia/Kolkata" }).format(parsed);
}
