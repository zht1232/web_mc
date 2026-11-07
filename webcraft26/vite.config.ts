import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // Do not watch the ~40k official asset files, screenshots, logs and reports: with several agents writing
    // into the workspace the default fs.watch watcher used to crash the server (EBUSY on atomic replaces of
    // *.TMP files), and polling instead pegged two cores walking all of public/mc.
    watch: {
      ignored: ['**/*.TMP', '**/*.tmp', '**/*.tmpdir/**', '**/node_modules/**', '**/dist/**', '**/public/mc/**',
        '**/shots/**', '**/logs/**', '**/REPORTS/**', '**/research/**'],
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
