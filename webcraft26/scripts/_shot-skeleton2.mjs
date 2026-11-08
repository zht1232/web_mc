import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 900, height: 640 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 200)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(5000);
const info = await p.evaluate(async () => {
  const g = window.__mc;
  g.level.time = 6000;
  const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
  // teleport to a known-land spot first (spawn point varies between runs and may be ocean)
  const px = 256, pz = -100;
  let gy = g.level.getHeight(px, pz);
  for (let tries = 0; tries < 40 && (gy < 0 || gy > 200); tries++) {
    g.player.pos = new Vec3(px + 0.5, 120, pz + 0.5 + tries * 7);
    await new Promise((r) => setTimeout(r, 400));
    gy = g.level.getHeight(px, pz + tries * 7);
  }
  g.player.pos = new Vec3(px + 0.5, gy + 1.62, pz + 0.5);
  await new Promise((r) => setTimeout(r, 1200));
  g.commandHost().summon('skeleton', px + 0.5, gy, pz - 4);
  const sk = [...g.entityManager.getEntities()].find((e) => e.getTypeName() === 'skeleton');
  if (sk) {
    // freeze all AI goals + target selection, kill velocity, face the player
    sk.goalSelector?.removeAllGoals(() => true);
    sk.targetSelector?.removeAllGoals(() => true);
    sk.speed = 0;
    if (sk.vel) sk.vel = new Vec3(0, 0, 0);
    if ('yBodyRot' in sk) sk.yBodyRot = 0;
    if ('yHeadRot' in sk) sk.yHeadRot = 0;
    if ('headYaw' in sk) sk.headYaw = 0;
    if (sk.x !== undefined) { sk.x = px + 0.5; sk.y = gy; sk.z = pz - 4; }
  }
  // stand eye-level at same height, facing the skeleton
  const ex = px + 0.5, ey = gy + 1.62, ez = pz + 0.5;
  g.player.pos = new Vec3(ex, ey, ez);
  g.player.vel = new Vec3(0, 0, 0);
  const dx = (sk ? sk.x : px + 0.5) - ex;
  const dy = (sk ? sk.y + 1.2 : gy + 1.2) - ey;
  const dz = (sk ? sk.z : pz - 4) - ez;  const horiz = Math.sqrt(dx * dx + dz * dz);
  g.player.yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  g.player.pitch = (-Math.atan2(dy, horiz) * 180) / Math.PI;
  return sk ? { sk: { x: sk.x, y: sk.y, z: sk.z }, look: { yaw: g.player.yaw, pitch: g.player.pitch } } : null;
});
console.log(JSON.stringify(info));
await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots/diag/skeleton-close.png', clip: { x: 300, y: 160, width: 300, height: 300 } });
await b.close();
