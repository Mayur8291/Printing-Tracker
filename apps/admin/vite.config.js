import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

/** Serves the Scott One page for /squad locally (Vercel does this in production) and stamps the worker version. */
function squadPwa() {
  // Braces matter: Vite would call a returned value as a post-middleware hook.
  const rewrite = (server) => {
    server.middlewares.use((req, _res, next) => {
      if (/^\/squad(\/|\?|$)/.test(req.url || "") && String(req.headers.accept || "").includes("text/html")) req.url = "/squad.html";
      next();
    });
  };
  let outDir;
  return {
    name: "squad-pwa",
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    configureServer: rewrite,
    configurePreviewServer: rewrite,
    closeBundle() {
      const worker = path.join(outDir || "", "sw.js");
      if (fs.existsSync(worker)) fs.writeFileSync(worker, fs.readFileSync(worker, "utf8").replace("__BUILD_ID__", Date.now().toString(36)));
    }
  };
}

export default defineConfig({
  plugins: [react(), squadPwa()],
  envDir: path.resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    // Listen on all interfaces so phones / other PCs on same Wi‑Fi can open the app
    host: true,
    port: 5173,
    proxy: {
      "/api/picklist": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    exclude: ["@imgly/background-removal"]
  },
  build: {
    rollupOptions: {
      input: { main: path.resolve(__dirname, "index.html"), squad: path.resolve(__dirname, "squad.html") }
    },
    chunkSizeWarningLimit: 1200
  },
  preview: {
    host: true,
    port: 4173
  }
});
