import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The backend has no CORS headers (CP4), so the browser talks to its own origin and Vite forwards
 * the two backend routes. API_PROXY_TARGET is read here, in Node, and is NOT exposed to the browser
 * (only VITE_* variables are).
 */
const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
const proxy = { '/walks': target, '/health': target };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
