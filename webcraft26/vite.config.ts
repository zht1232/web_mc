import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // Several agents write files in this workspace at the same time. Vite's fs.watch based
    // chokidar watcher kills the whole dev server with EBUSY whenever it catches an atomic
    // replace ("~RF*.TMP", ".tmpdir", or the target file itself), so poll instead.
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/*.TMP', '**/*.tmp', '**/*.tmpdir/**', '**/node_modules/**', '**/dist/**'],
    },
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
