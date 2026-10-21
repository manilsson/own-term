import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The marketing page, a separate Vite app from the Electron renderer; it builds to site/dist.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  base: './',
  server: { port: 5200, strictPort: true },
  build: { rollupOptions: { input: { index: 'index.html', releases: 'releases.html' } } },
})
