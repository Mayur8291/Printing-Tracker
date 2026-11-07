import { supabase } from "../supabaseClient";
import { createClient } from "@supabase/supabase-js";
import { getEnvironmentConfig, getRuntimeEnv } from "../runtimeEnv";
import { getResolvedScottApiTarget } from "../scott/scottRuntime";

const KEY = "canto:admin-target:v1";
const clients = new Map();
export function getCantoTarget() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if (["legacy", "supabase"].includes(value?.source) && ["staging", "production"].includes(value?.environment)) return value;
  } catch { /* default for a first visit */ }
  return { source: "legacy", environment: getResolvedScottApiTarget() };
}
export function setCantoTarget(target) {
  if (!["legacy", "supabase"].includes(target.source) || !["staging", "production"].includes(target.environment)) throw new Error("Invalid target");
  localStorage.setItem(KEY, JSON.stringify(target));
  window.location.reload();
}
export function getCantoClient(environment = getCantoTarget().environment) {
  if (getEnvironmentConfig(environment).url === getRuntimeEnv().url) return supabase;
  if (!clients.has(environment)) {
    const { url, anonKey } = getEnvironmentConfig(environment);
    clients.set(environment, createClient(url, anonKey));
  }
  return clients.get(environment);
}
export async function cantoRpc(name, args, environment = getCantoTarget().environment) {
  const client = getCantoClient(environment);
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error(`Sign in to ${environment} to continue.`);
  const { data, error } = await client.schema("canto_api").rpc(name, args);
  if (error) throw new Error(error.message || "The operation failed.");
  return data;
}
export function defaultRefreshEnvironment() { return getRuntimeEnv().env; }
