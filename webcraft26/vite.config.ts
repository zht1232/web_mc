import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-server sink for the in-game performance report (src/client/PerfLog.ts).
 *
 * The phone cannot open DevTools, so the client POSTs its report here and it lands in
 * `logs/perf/perf-<timestamp>.json` — readable from the PC without touching the phone.
 * Only available while `npm run dev` / `npm run preview` is serving; a failed upload is
 * ignored by the client.
 */
function perfLogSink(): Plugin {
  const handle = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void): void => {
    if (!req.url || !req.url.startsWith('/__perf-log')) { next(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4e6) req.destroy(); // 4 MB guard
    });
    req.on('end', () => {
      try {
        const dir = path.resolve(process.cwd(), 'logs/perf');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(dir, `perf-${stamp}.json`);
        fs.writeFileSync(file, body);
        console.log(`[perf] ${path.basename(file)} (${(body.length / 1024).toFixed(0)} KB)`);
        res.statusCode = 204;
        res.end();
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
  };
  return {
    name: 'perf-log-sink',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

/**
 * Copies the committed advancement/tag/villager-trade definitions into the production bundle.
 * Vite serves them from the project root in dev, but the build only emits public/.
 */
function advancementData(): Plugin {
  return {
    name: 'advancement-data',
    generateBundle() {
      for (const name of ['advancements.json', 'tags.json', 'villager_trades.json', 'wandering_trader_trades.json', 'jukebox_songs.json']) {
        const file = path.resolve(process.cwd(), 'data', name);
        if (!fs.existsSync(file)) continue;
        this.emitFile({ type: 'asset', fileName: `data/${name}`, source: fs.readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  plugins: [perfLogSink(), advancementData()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // Do not watch the ~40k official asset files, screenshots, logs and reports: with several agents writing
    // into the workspace the default fs.watch watcher used to crash the server (EBUSY on atomic replaces of
    // *.TMP files), and polling instead pegged two cores walking all of public/mc.
    watch: {
      ignored: ['**/*.TMP', '**/*.tmp', '**/*.tmpdir/**', '**/node_modules/**', '**/dist/**', '**/public/mc/**',
        '**/shots/**', '**/logs/**', '**/REPORTS/**', '**/research/**',
        // Tool scripts are not part of the app; watching them crashed the watcher (EBUSY) when
        // another agent deleted a temp *.mjs between fs.watch registrations.
        '**/scripts/**'],
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
