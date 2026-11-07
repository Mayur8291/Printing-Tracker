export const APPLICATION_NAME = "Canto";
export const ENVIRONMENTS = Object.freeze({
  staging: Object.freeze({ label: "Staging", projectRef: "scvojtvgnkmbupvyslmb" }),
  production: Object.freeze({ label: "Production", projectRef: "levwrmvqdntngeasrtnb" })
});
export function requireEnvironment(value) {
  if (value !== "staging" && value !== "production") throw new Error("Choose staging or production.");
  return value;
}
export const DATA_SOURCES = Object.freeze(["legacy", "supabase"]);
