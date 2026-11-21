// Village visual check at the default seed (0x2602c0de): village origin chunk (-598,-418),
// anchorY 104 (from scripts/test-structures.mts). Teleport to the edge, look at the well.
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await page.goto('http://127.0.0.1:5174/?play', { waitUntil: 'domcontentloaded', timeout: 90000 });
let state = 'loading';
for (let i = 0; i < 240 && state !== 'ready'; i++) {
  state = await page.evaluate(() => {
    const m = window.__mc;
    return m && m.level && m.chunkProvider && m.entityRenderer ? 'ready' : 'loading';
  });
  if (state !== 'ready') await page.waitForTimeout(500);
}
await page.waitForTimeout(2000);
const r = await page.evaluate(async () => {
  const m = window.__mc;
  const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
  const originX = -598 * 16 + 8, originZ = -418 * 16 + 8, anchorY = 104;
  const ex = originX - 14, ez = originZ - 14;
  m.player.pos = new Vec3(ex + 0.5, anchorY + 4, ez + 0.5);
  m.player.prevPos = new Vec3(ex + 0.5, anchorY + 4, ez + 0.5);
  m.player.vel = new Vec3(0, 0, 0);
  const dx = originX - ex, dz = originZ - ez;
  m.player.yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  m.player.pitch = 3;
  m.player.tick = () => {};
  return { pos: [m.player.pos.x, m.player.pos.y, m.player.pos.z], yaw: m.player.yaw };
});
console.log('teleport:', JSON.stringify(r));
for (let i = 0; i < 180; i++) {
  const q = await page.evaluate(() => {
    const m = window.__mc;
    return { queue: m.chunkProvider.queueLength, inflight: m.chunkProvider.inflight };
  });
  if (q.queue === 0 && q.inflight === 0) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(5000);
await page.screenshot({ path: 'shots/diag/village.png' });
console.log('saved shots/diag/village.png');
await browser.close();
