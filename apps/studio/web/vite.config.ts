import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The Studio interface. Built into apps/studio/dist-web and served by the Studio server.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../dist-web', import.meta.url)), emptyOutDir: true },
  server: { port: 4311, proxy: { '/api': 'http://127.0.0.1:4310' } },
});
