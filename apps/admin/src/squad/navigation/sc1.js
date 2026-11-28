// Per-persona rollout of the Scott One look. Customer (3) and Dealer (10) have the native app and never opt in.
const NEVER = [3, 10];
export const SC1_DEFAULT_ROLES = "1";

export function sc1Roles(setting) {
  return String(setting ?? SC1_DEFAULT_ROLES).split(",").map((value) => value.trim()).filter(Boolean).map(Number);
}

/** `?sc1=1` / `?sc1=0` is remembered in this browser for review and rollback. */
export function sc1Enabled(identity, { search = "", storage, setting } = {}) {
  const role = Number(identity?.role);
  if (!Number.isInteger(role) || NEVER.includes(role)) return false;
  let flag = new URLSearchParams(search).get("sc1");
  if (flag !== "1" && flag !== "0") flag = null;
  try {
    if (flag) storage?.setItem("squad.sc1", flag);
    else flag = storage?.getItem("squad.sc1") ?? null;
  } catch { /* The query value still applies when storage is unavailable. */ }
  return flag ? flag === "1" : sc1Roles(setting).includes(role);
}

/** A tab root shows the wordmark header; anything deeper shows Back. */
export function isTabRoot(tabs, path, search = "") {
  const current = new URLSearchParams(search);
  const clean = String(path).replace(/\/$/, "");
  return tabs.some((tab) => {
    const [target, required = ""] = tab.href.split("?");
    return clean === target && [...new URLSearchParams(required)].every(([key, value]) => current.get(key) === value);
  });
}
