import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  preview: {
    port: 3002,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    // IMPORTANT: prevent Vite from turning your worker into a data: URL
    assetsInlineLimit: 0,
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@vlcn.io/crsqlite-wasm']
  }
})