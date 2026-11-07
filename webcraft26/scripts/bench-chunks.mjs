// Throwaway benchmark: measures chunk pipeline throughput for a given worker count.
// Usage: node scripts/bench-chunks.mjs <workers> <seconds>
import { chromium } from 'playwright';

const workers = process.argv[2] ?? '4';
const seconds = Number(process.argv[3] ?? 15);
const url = `http://127.0.0.1:5174/?workers=${workers}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.text()));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

const boot = Date.now();
while (Date.now() - boot < 180000) {
  if (await page.evaluate(() => !!window.__mc)) break;
  await page.waitForTimeout(200);
}
const initMs = Date.now() - boot;

const sample = () => page.evaluate(() => {
  const g = window.__mc;
  const p = g.chunkProvider;
  return {
    t: performance.now(),
    generated: p.generatedCount,
    applied: p.appliedCount,
    chunks: g.level.chunks.size,
    queue: p.queueLength,
    inflight: p.inflight,
    fps: g.fps,
  };
});

const samples = [await sample()];
const start = Date.now();
while (Date.now() - start < seconds * 1000) {
  await page.waitForTimeout(250);
  samples.push(await sample());
}

const first = samples[0];
const last = samples[samples.length - 1];
const dt = (last.t - first.t) / 1000;
const genRate = (last.generated - first.generated) / dt;
const applyRate = (last.applied - first.applied) / dt;
const fps = samples.reduce((a, s) => a + s.fps, 0) / samples.length;

const spawnLog = logs.find((l) => l.includes('spawn area')) ?? '';

console.log(JSON.stringify({
  workers,
  initMs,
  spawn: spawnLog,
  windowSeconds: Number(dt.toFixed(2)),
  generatedPerSec: Number(genRate.toFixed(1)),
  appliedPerSec: Number(applyRate.toFixed(1)),
  chunksStart: first.chunks,
  chunksEnd: last.chunks,
  queueEnd: last.queue,
  avgFps: Number(fps.toFixed(1)),
}, null, 2));

await browser.close();
