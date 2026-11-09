import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Writes /asset-list.json: every file the build put in /assets. The service
// worker caches the whole list before it switches to a new build, so lazy page
// chunks are there offline and an older saved page never asks for missing code.
// Read from disk once the build is written: Vite drops empty style-only chunks
// late, so the in-memory bundle can name files that never ship.
const assetList = (): Plugin => ({
  name: 'asset-list',
  apply: 'build',
  writeBundle(options) {
    const out = options.dir ?? 'dist'
    const files = readdirSync(join(out, 'assets')).map(f => `/assets/${f}`).sort()
    writeFileSync(join(out, 'asset-list.json'), JSON.stringify(files))
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), assetList()],
  server: {
    // Proxy API calls to the C# backend so the frontend can use relative
    // "/api/..." URLs in dev with no CORS fuss.
    proxy: {
      '/api': 'http://localhost:5080',
    },
  },
})
