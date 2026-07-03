#!/usr/bin/env node
/**
 * Verify local dev commands point at staging Supabase, not production.
 * Run: npm run check:env
 */
import { loadEnv } from "vite";

const PROD_REF = "levwrmvqdntngeasrtnb";
const STAGING_REF = "scvojtvgnkmbupvyslmb";

function refFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

function checkMode(mode, label) {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const url = env.VITE_SUPABASE_URL ?? "";
  const ref = refFromUrl(url);
  const ok = ref === STAGING_REF;
  return { label, mode, url, ref, ok };
}

const checks = [
  checkMode("development", "npm run dev"),
  checkMode("staging", "npm run dev:staging")
];

let failed = false;

console.log("Scott Dashboard — environment check\n");

for (const c of checks) {
  const status = c.ok ? "OK (staging)" : c.ref === PROD_REF ? "FAIL (production)" : "WARN (unknown ref)";
  console.log(`${c.label}`);
  console.log(`  mode: ${c.mode}`);
  console.log(`  url:  ${c.url || "(missing)"}`);
  console.log(`  ref:  ${c.ref || "(none)"} → ${status}\n`);
  if (!c.ok) failed = true;
}

const prodEnv = loadEnv("", process.cwd(), "VITE_");
const prodRef = refFromUrl(prodEnv.VITE_SUPABASE_URL ?? "");
console.log(".env fallback (build/preview only — not used by npm run dev):");
console.log(`  ref: ${prodRef || "(none)"}${prodRef === PROD_REF ? " (production — expected)" : ""}\n`);

if (failed) {
  console.error(
    "Fix: ensure .env.development and .env.staging use staging ref",
    STAGING_REF,
    "(see .env.development.example)."
  );
  process.exit(1);
}

console.log("All dev commands point at staging. Production is not used for local dev.");
