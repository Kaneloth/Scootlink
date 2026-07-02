import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress unresolved Capacitor plugin warnings on web builds
        // Capacitor imports use @vite-ignore + string concat to avoid bundling
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.id?.includes('capacitor')) return;
        if (warning.message?.includes('capacitor')) return;
        warn(warning);
      },
    },
  },
});
