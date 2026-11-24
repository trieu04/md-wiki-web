import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Headers for the built app (P10-02, D-251): `vite preview` sends them, and docs/operations.md asks the
 * production web server to send the same. Inline style attributes are used by React components.
 */
export const webSecurityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

export default defineConfig(({ mode }) => ({
  // Filtered Vitest runs don't build workspace dependencies first.
  ...(mode === 'test' && {
    resolve: {
      alias: {
        '@md-wiki/contracts': fileURLToPath(
          new URL('../../packages/contracts/src/index.ts', import.meta.url),
        ),
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
  server: {
    host: process.env.WEB_HOST || '127.0.0.1',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: { '/api/v1': `http://127.0.0.1:${process.env.API_PORT || '3000'}` },
  },
  preview: { headers: webSecurityHeaders },
  test: { environment: 'jsdom', css: { include: [/theme\.css\?raw$/] } },
}));
