import { spawn } from "node:child_process";

const children = [];

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
    shutdown(code ?? 0);
  });
  children.push(child);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev] Starting picklist API (port 3001) + Vite (port 5173)…");
console.log("[dev] Picklist PDF: POST /api/picklist/pdf (proxied from Vite)");

start("picklist-api", "node", ["server/index.js"]);
start("vite", "node", ["./node_modules/vite/bin/vite.js"]);
