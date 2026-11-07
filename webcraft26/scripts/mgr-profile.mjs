// CPU profile of the running game: node scripts/mgr-profile.mjs [seconds] [url]
// Teleports to the open-ground "stage", waits for chunks, then samples the main thread via CDP.
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const seconds = Number(process.argv[2] ?? 6);
const url = process.argv[3] ?? 'http://127.0.0.1:5174/?workers=4';
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 240; i++) {
  if (await page.evaluate(() => !!window.__mc)) break;
  await page.waitForTimeout(500);
}
if (!process.env.PROFILE_EARLY) {
  await page.evaluate(() => {
    const m = window.__mc; m.options.gamemode = 'creative'; m.level.time = 6000;
    const p = m.player.pos; p.x = 313.5; p.z = -109.5; p.y = 71; m.player.pitch = 8; m.player.yaw = 0;
  });
  await page.waitForTimeout(12000);
}
const fps0 = await page.evaluate(() => window.__mc.fps);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.waitForTimeout(seconds * 1000);
const { profile } = await cdp.send('Profiler.stop');

const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const dt = profile.timeDeltas[i] / 1000; // ms
  const n = nodes.get(profile.samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + dt);
  total += dt;
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`fps before=${fps0} sampled=${total.toFixed(0)}ms`);
for (const [k, v] of top) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${v.toFixed(0).padStart(6)}ms  ${k}`);
console.log('stats', JSON.stringify(await page.evaluate(() => ({ fps: window.__mc.fps, mesh: window.__mc.renderer.meshStats, chunks: window.__mc.level.chunks.size, ents: window.__mc.entityManager.getEntities().length }))));
await browser.close();
