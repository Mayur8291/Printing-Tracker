import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so phones / other PCs on same Wi‑Fi can open the app
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
});
