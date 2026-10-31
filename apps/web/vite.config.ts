import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // E2E_API_URL exists for the Playwright suite (apps/e2e), which proxies
    // to an isolated API on an alt port. Default keeps `pnpm dev` as before.
    // ws: true carries the /api/voice WebSocket upgrade to the API server.
    proxy: {
      '/api': { target: process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8787', ws: true },
    },
  },
})
