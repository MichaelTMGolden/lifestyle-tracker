import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Writes /asset-list.json: every file the build put in /assets. The service
// worker caches the whole list before it switches to a new build, so lazy page
// chunks are there offline and an older saved page never asks for missing code.
const assetList = (): Plugin => ({
  name: 'asset-list',
  apply: 'build',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter(f => f.startsWith('assets/')).map(f => `/${f}`).sort()
    this.emitFile({ type: 'asset', fileName: 'asset-list.json', source: JSON.stringify(files) })
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
