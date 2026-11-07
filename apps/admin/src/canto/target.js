import { supabase } from "../supabaseClient";
import { getRuntimeEnv } from "../runtimeEnv";
import { getResolvedScottApiTarget } from "../scott/scottRuntime";

const KEY = "canto:admin-target:v1";
// The header reloads the app when switching environments. Pin this to the same
// runtime used to create the dashboard client, including its existing session.
const dashboardEnvironment = getRuntimeEnv().env;
export function getCantoTarget() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if (value?.source === "supabase") return { source: "supabase", environment: dashboardEnvironment };
    if (value?.source === "legacy" && ["staging", "production"].includes(value.environment)) return value;
  } catch { /* default for a first visit */ }
  return { source: "legacy", environment: getResolvedScottApiTarget() };
}
export function setCantoTarget(target) {
  if (!["legacy", "supabase"].includes(target.source) || !["staging", "production"].includes(target.environment)) throw new Error("Invalid target");
  const next = target.source === "supabase" ? { ...target, environment: dashboardEnvironment } : target;
  localStorage.setItem(KEY, JSON.stringify(next));
  window.location.reload();
}
export function getCantoClient(environment = dashboardEnvironment) {
  if (environment !== dashboardEnvironment) throw new Error("Use the dashboard header to switch environments first.");
  return supabase;
}
export async function cantoRpc(name, args, environment = getCantoTarget().environment) {
  const client = getCantoClient(environment);
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("Your dashboard session has expired. Please sign in again.");
  const { data, error } = await client.schema("canto_api").rpc(name, args);
  if (error) throw new Error(error.message || "The operation failed.");
  return data;
}
export function defaultRefreshEnvironment() { return dashboardEnvironment; }
