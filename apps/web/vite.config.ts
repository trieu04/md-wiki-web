import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    proxy: { '/api/v1': `http://127.0.0.1:${process.env.API_PORT || '3000'}` },
  },
  test: { environment: 'jsdom' },
});
