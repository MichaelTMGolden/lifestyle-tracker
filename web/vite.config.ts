import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the C# backend so the frontend can use relative
    // "/api/..." URLs in dev with no CORS fuss.
    proxy: {
      '/api': 'http://localhost:5080',
    },
  },
})
