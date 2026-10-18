import { spawn } from "node:child_process";

const children = [];
const PICKLIST_PORT = Number(process.env.PICKLIST_API_PORT || 3001);
const PICKLIST_HEALTH = `http://127.0.0.1:${PICKLIST_PORT}/health`;

function start(name, command, args, { fatal = true } = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
    if (!fatal) {
      if (code && code !== 0) {
        console.error(`[dev] ${name} died. App still on http://localhost:5173/`);
      }
      return;
    }
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

async function picklistAlreadyUp() {
  try {
    const res = await fetch(PICKLIST_HEALTH, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.service === "picklist-api";
  } catch {
    return false;
  }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev] Starting picklist API (port 3001) + Vite (port 5173)…");
console.log("[dev] Picklist PDF: POST /api/picklist/pdf (proxied from Vite)");

if (await picklistAlreadyUp()) {
  console.log(`[dev] Picklist API already on ${PICKLIST_HEALTH} — not starting a second one.`);
} else {
  start("picklist-api", "node", ["server/index.js"], { fatal: false });
}

start("vite", "node", ["./node_modules/vite/bin/vite.js"], { fatal: true });
