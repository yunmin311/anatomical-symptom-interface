import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const sharedSrc = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume @asi/shared as source so the browser gets hot reloads during
      // development and no build step is needed for a workspace-internal package.
      '@asi/shared': sharedSrc,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
