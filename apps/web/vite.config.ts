import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'visual' && {
      name: 'visual-msw-worker',
      apply: 'build',
      async generateBundle() {
        // Generate at the origin root so the service worker can control all app routes.
        const fileName = 'mockServiceWorker.js';
        const source = await readFile(createRequire(import.meta.url).resolve(`msw/${fileName}`));
        this.emitFile({ type: 'asset', fileName, source });
      },
    },
  ],
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: { '/api/v1': `http://127.0.0.1:${process.env.API_PORT || '3000'}` },
  },
  test: { environment: 'jsdom' },
}));
