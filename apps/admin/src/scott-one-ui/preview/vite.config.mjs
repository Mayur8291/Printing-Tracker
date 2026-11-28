import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const admin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export default defineConfig({
  root: admin,
  base: './',
  plugins: [react()],
  build: {
    outDir: path.join(admin, 'dist-ui-kit'),
    emptyOutDir: true,
    rollupOptions: { input: path.join(admin, 'scott-one-ui-kit.html') },
  },
});
