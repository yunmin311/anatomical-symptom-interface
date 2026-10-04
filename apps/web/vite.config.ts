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
    port: Number(process.env.ASI_WEB_PORT ?? 5173),
    // Fail instead of moving. Vite's default is to take the next free port when
    // the one it was asked for is busy, which means a second checkout — or a
    // leftover process from a previous run — quietly serves the OLD build on the
    // port you are reading, and every screenshot and browser gate is of that one.
    // A collision has to be an error you can see.
    strictPort: true,
    proxy: {
      // Configurable because a gate run cannot use the default: it starts the API
      // on its own port so two runs cannot collide, and a hardcoded target meant
      // every browser gate silently 502'd rather than failing loudly. Overridable
      // also means the dev server can be pointed at a second checkout's API.
      '/api': {
        target: process.env.ASI_API_ORIGIN ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
