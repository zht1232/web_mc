// Skeleton bow close-up via the shot-mobs harness pattern (freeze player+entities,
// flat clearing, skeleton 4 blocks ahead facing the camera).
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/?play';
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
const deadline = Date.now() + 120000;
let state = 'loading';
while (Date.now() < deadline) {
  state = await page.evaluate(() => {
    const m = window.__mc;
    return m && m.level && m.chunkProvider && m.entityRenderer ? 'ready' : 'loading';
  });
  if (state === 'ready') break;
  await page.waitForTimeout(500);
}
if (state !== 'ready') { console.log('FAILED to load'); await browser.close(); process.exit(1); }
for (let i = 0; i < 60; i++) {
  const q = await page.evaluate(() => {
    const m = window.__mc;
    if (!m || !m.chunkProvider) return { queue: 1, inflight: 1 };
    return { queue: m.chunkProvider.queueLength, inflight: m.chunkProvider.inflight };
  });
  if (q.queue === 0 && q.inflight === 0) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2000);

const r = await page.evaluate(() => {
  const m = window.__mc;
  // freeze player + entity ticks so nothing moves
  if (!m.__mobOrigPlayerTick) m.__mobOrigPlayerTick = m.player.tick;
  m.player.tick = () => {};
  m.entityManager.spawnInterval = 1e9;
  m.entityManager.tick = () => {};
  for (const e of m.entityManager.getEntities()) e.remove();

  const px = Math.floor(m.player.pos.x), pz = Math.floor(m.player.pos.z);
  let best = null;
  const air = (x, y, z) => m.level.getBlockState(x, y, z) === 0;
  for (let dx = 4; dx <= 14 && !best; dx++) {
    for (let dz = -8; dz <= 8 && !best; dz++) {
      const x = px + dx, z = pz + dz;
      const h = m.level.getHeight(x, z);
      if (h < 0 || h > 200) continue;
      let ok = true;
      for (let ax = -1; ax <= 4; ax++) {
        for (let az = -2; az <= 2; az++) {
          if (m.level.getHeight(x + ax, z + az) !== h) { ok = false; break; }
          if (!air(x + ax, h + 1, z + az) || !air(x + ax, h + 2, z + az)) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) best = { x, z, h };
    }
  }
  if (!best) best = { x: px + 6, z: pz, h: m.level.getHeight(px + 6, pz) };
  // camera behind the skeleton spot, looking +X
  const camX = best.x - 3, camZ = best.z, camY = best.h + 1.62;
  m.player.pos.x = camX; m.player.pos.y = camY; m.player.pos.z = camZ;
  m.player.prevPos.x = camX; m.player.prevPos.y = camY; m.player.prevPos.z = camZ;
  m.player.yaw = 90; m.player.pitch = 3;

  const e = m.entityManager.spawn('skeleton', best.x, best.h + 1, best.z);
  if (!e) return { error: 'skeleton spawn failed' };
  e.x = best.x; e.y = best.h + 1; e.z = best.z;
  e.xo = e.x; e.yo = e.y; e.zo = e.z;
  e.yaw = 270; e.yRotO = 270;         // face -X, toward the camera
  e.yBodyRot = 270; e.yBodyRotO = 270;
  e.yHeadRot = 270; e.yHeadRotO = 270;
  e.pitch = 0; e.xRotO = 0;
  e.goalSelector?.removeAllGoals(() => true);
  e.targetSelector?.removeAllGoals(() => true);
  m.level.time = 6000;
  return { clearing: best, cam: { camX, camZ, camY } };
});
console.log('setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/diag/skeleton-close.png', clip: { x: 440, y: 160, width: 400, height: 400 } });
console.log('saved shots/diag/skeleton-close.png');
await browser.close();
