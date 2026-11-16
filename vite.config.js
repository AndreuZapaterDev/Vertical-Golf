import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Necesario para que el hot-reload funcione con volúmenes de Docker en Windows/macOS
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
