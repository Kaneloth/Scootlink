import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // __INCLUDE_ADMIN__ is a compile-time constant (not just an env string
  // check) — esbuild/Rollup can prove branches gated on it are dead code
  // and drop them, including any dynamic import() inside, so the native
  // build (`npm run build:native`, mode=native) never bundles a single
  // byte of the admin dashboard. The regular web build (`npm run build`)
  // includes it as normal.
  define: {
    __INCLUDE_ADMIN__: mode !== 'native',
  },
  build: {
    outDir: 'dist',
  },
}));
