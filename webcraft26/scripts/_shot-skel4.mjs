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
      for (let ax = -1; ax <= 4; ax++) for (let az = -2; az <= 2; az++) {
        if (m.level.getHeight(x + ax, z + az) !== h) { ok = false; break; }
        if (!air(x + ax, h + 1, z + az) || !air(x + ax, h + 2, z + az)) { ok = false; break; }
      }
      if (ok) best = { x, z, h };
    }
  }
  if (!best) best = { x: px + 6, z: pz, h: m.level.getHeight(px + 6, pz) };
  // camera at front-left diagonal, skeleton faces camera
  const camX = best.x - 2.6, camZ = best.z - 2.6;
  const camY = best.h + 1.62;
  m.player.pos.x = camX; m.player.pos.y = camY; m.player.pos.z = camZ;
  m.player.prevPos.x = camX; m.player.prevPos.y = camY; m.player.prevPos.z = camZ;
  const dx = best.x - camX, dz = best.z - camZ;
  m.player.yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  m.player.pitch = 2;
  const e = m.entityManager.spawn('skeleton', best.x, best.h + 1, best.z);
  e.x = best.x; e.y = best.h + 1; e.z = best.z;
  e.xo = e.x; e.yo = e.y; e.zo = e.z;
  const back = { x: camX, z: camZ };
  const dyaw = (Math.atan2(back.x - best.x, back.z - best.z) * 180) / Math.PI;
  e.yaw = dyaw; e.yRotO = dyaw;
  e.yBodyRot = dyaw; e.yBodyRotO = dyaw;
  e.yHeadRot = dyaw; e.yHeadRotO = dyaw;
  e.pitch = 0; e.xRotO = 0;
  e.goalSelector?.removeAllGoals(() => true);
  e.targetSelector?.removeAllGoals(() => true);
  m.level.time = 6000;
  return { clearing: best, cam: { camX, camZ, camY, yaw: m.player.yaw }, skYaw: dyaw };
});
console.log('setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/diag/skeleton-diag.png', clip: { x: 460, y: 140, width: 380, height: 420 } });
console.log('saved shots/diag/skeleton-diag.png');
await browser.close();
