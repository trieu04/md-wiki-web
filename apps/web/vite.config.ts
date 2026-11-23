import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // Filtered Vitest runs don't build workspace dependencies first.
  ...(mode === 'test' && {
    resolve: {
      alias: {
        '@md-wiki/domain': fileURLToPath(
          new URL('../../packages/domain/src/index.ts', import.meta.url),
        ),
      },
    },
  }),
  plugins: [
    react(),
    tailwindcss(),
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
  define: {
    'import.meta.env.WIKI_NAME': JSON.stringify(process.env.WIKI_NAME ?? 'Bioimaging core'),
  },
  server: {
    host: process.env.WEB_HOST || '127.0.0.1',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: { '/api/v1': `http://127.0.0.1:${process.env.API_PORT || '3000'}` },
  },
  test: { environment: 'jsdom', css: { include: [/theme\.css\?raw$/] } },
}));
