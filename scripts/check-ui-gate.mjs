#!/usr/bin/env node
/**
 * UI blank-screen gate — run before marking frontend work done.
 * 1) Production build must pass.
 * 2) JSX import heuristic (warn-only; skips local components).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VITE = join(ROOT, "node_modules/vite/bin/vite.js");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, acc);
    else if (/\.(jsx|tsx)$/.test(name)) acc.push(path);
  }
  return acc;
}

function collectImports(src) {
  const imported = new Set();
  const blocks = [...src.matchAll(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm)].map((m) => m[0]);
  for (const block of blocks) {
    for (const m of block.matchAll(/import\s+\*\s+as\s+(\w+)/g)) imported.add(m[1]);
    for (const m of block.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))/g)) {
      if (m[1]) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/i)[0].trim();
          if (name) imported.add(name);
        }
      }
      if (m[2]) imported.add(m[2]);
    }
  }
  return imported;
}

function isDefinedLocally(src, name) {
  return [
    new RegExp(`function\\s+${name}\\b`),
    new RegExp(`const\\s+${name}\\s*=`),
    new RegExp(`let\\s+${name}\\s*=`),
    new RegExp(`class\\s+${name}\\b`)
  ].some((re) => re.test(src));
}

const HTML_TAGS = new Set([
  "Fragment", "Suspense", "StrictMode",
  "br", "img", "input", "form", "div", "span", "p", "ul", "li", "ol",
  "table", "thead", "tbody", "tr", "th", "td", "label", "option", "select",
  "textarea", "a", "h1", "h2", "h3", "h4", "section", "time", "strong", "svg", "path", "g"
]);

function checkJsxImports(filePath) {
  const src = readFileSync(filePath, "utf8");
  const rel = relative(ROOT, filePath);
  const imported = collectImports(src);
  const used = new Set();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) used.add(m[1]);
  const missing = [...used].filter(
    (name) => !imported.has(name) && !HTML_TAGS.has(name) && !isDefinedLocally(src, name)
  );
  return missing.length ? { rel, missing: [...new Set(missing)].sort() } : null;
}

console.log("UI gate: production build…");
const build = spawnSync(process.execPath, [VITE, "build"], { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log("UI gate: JSX import scan (warnings)…");
const problems = walk(join(ROOT, "src")).map(checkJsxImports).filter(Boolean);
if (problems.length) {
  console.warn("\nReview possible missing imports (may cause blank screen):");
  for (const p of problems.slice(0, 15)) {
    console.warn(`  ${p.rel}: ${p.missing.join(", ")}`);
  }
  if (problems.length > 15) console.warn(`  … and ${problems.length - 15} more files`);
}

console.log("UI gate passed (build OK).");
