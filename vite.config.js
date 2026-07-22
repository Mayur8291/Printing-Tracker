import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
  preview: {
    host: true,
    port: 4173
  }
});
