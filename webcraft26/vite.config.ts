import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
  build: {
    // dist/mc holds ~14 MB of extracted vanilla assets. Letting Vite empty the
    // out dir fails on Windows when the recycle-bin helper cannot remove it,
    // so we keep it and overwrite the generated bundles instead.
    emptyOutDir: false,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
