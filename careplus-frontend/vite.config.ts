import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, '../careplus-backend/src/common/validation'),
      ],
    },
  },
  preview: {
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
  },
})
