// Mob renderer screenshot harness (mobs package).
//
// One browser session, several scenes, so the shared machine only pays for a
// single launch:
//   shots/mobs/day.png        t=6000, 13 mobs on a flat platform
//   shots/mobs/night.png      t=18000, same mobs -> dark blue lightmap
//   shots/mobs/night-torch.png t=18000 + torch next to the zombie
//   shots/mobs/walk-a.png / walk-b.png  two frames 0.3 s apart, walking zombies
//   shots/mobs/hurt.png       zombie hurt flash (0.7 red overlay)
//   shots/mobs/death.png      zombie 90-degree death fall
//
// Usage: node scripts/shot-mobs.mjs [url]

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/';
const outDir = 'shots/mobs';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const deadline = Date.now() + 90000;
let state = 'loading';
while (Date.now() < deadline) {
  state = await page.evaluate(() => (window.__mc ? 'ready' : 'loading'));
  if (state === 'ready') break;
  await page.waitForTimeout(500);
}
if (state !== 'ready') {
  console.log('FAILED to load:', state);
  console.log(logs.slice(-20).join('\n'));
  await browser.close();
  process.exit(1);
}
// let the spawn chunks stream in
await page.waitForTimeout(6000);

async function evaluate(fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}
async function shot(name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  console.log('shot:', `${outDir}/${name}.png`);
}

// ---------------------------------------------------------------------------
// Helpers installed in the page
// ---------------------------------------------------------------------------
await evaluate(() => {
  const m = window.__mc;
  const P = {
    mobs: [],
    baseY: 0,
    px: 0,
    pz: 0,
    surfaceY: 0,
    freeze() { m.entityManager.tick = () => {}; },
    unfreeze() { delete m.entityManager.tick; },
    clearMobs() {
      for (const e of m.entityManager.getEntities()) e.remove();
    },
    buildFlat() {
      const px = Math.floor(m.player.pos.x), pz = Math.floor(m.player.pos.z);
      const baseY = Math.floor(m.player.pos.y) - 1;
      const stone = m.mc.stateOf('stone');
      for (let dx = -4; dx <= 14; dx++) {
        for (let dz = -8; dz <= 8; dz++) {
          m.level.setBlockState(px + dx, baseY, pz + dz, stone);
          for (let dy = 1; dy <= 5; dy++) m.level.setBlockState(px + dx, baseY + dy, pz + dz, 0);
        }
      }
      P.px = px; P.pz = pz; P.baseY = baseY; P.surfaceY = baseY + 1;
      // stand on the platform, look along +X (Vec3 is mutable in place)
      m.player.pos.x = px + 0.5;
      m.player.pos.y = P.surfaceY;
      m.player.pos.z = pz + 0.5;
      m.player.prevPos.x = m.player.pos.x;
      m.player.prevPos.y = m.player.pos.y;
      m.player.prevPos.z = m.player.pos.z;
      m.player.yaw = -90;
      m.player.pitch = -6;
    },
    spawn(name, x, z) {
      const e = m.entityManager.spawn(name, x, P.surfaceY, z);
      if (!e) return null;
      e.x = x; e.y = P.surfaceY; e.z = z;
      e.xo = x; e.yo = P.surfaceY; e.zo = z;
      e.yaw = 90; e.yRotO = 90;
      e.yBodyRot = 90; e.yBodyRotO = 90;
      e.yHeadRot = 90; e.yHeadRotO = 90;
      e.pitch = 0; e.xRotO = 0;
      P.mobs.push(e);
      return e;
    },
    spawnAll() {
      P.clearMobs();
      P.mobs.length = 0;
      const row1 = ['zombie', 'skeleton', 'creeper', 'spider', 'pig', 'cow', 'sheep'];
      const row2 = ['enderman', 'silverfish', 'chicken', 'wolf', 'rabbit', 'bat'];
      row1.forEach((name, i) => P.spawn(name, P.px + 5.5, P.pz - 3.6 + i * 1.2));
      row2.forEach((name, i) => P.spawn(name, P.px + 8.5, P.pz - 3.0 + i * 1.2));
      m.showDebug = false;
    },
    /** lightmap levels sampled exactly like EntityRenderer.getPackedLightCoords */
    lightReport() {
      return P.mobs.map((e) => {
        const bx = Math.floor(e.x), by = Math.floor(e.getEyeY()), bz = Math.floor(e.z);
        return {
          type: e.getTypeName(),
          sky: m.level.getSkyLight(bx, by, bz),
          block: m.level.getBlockLight(bx, by, bz),
          walkPos: +(e.walkAnimPos ?? 0).toFixed(3),
          walkSpeed: +(e.walkAnimSpeed ?? 0).toFixed(3),
        };
      });
    },
  };
  window.__mobP = P;
});
console.log('helpers installed');

// ---------------------------------------------------------------------------
// Scene 1: day (t=6000)
// ---------------------------------------------------------------------------
let r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.buildFlat();
  P.spawnAll();
  P.freeze();
  m.level.time = 6000;
  return { mobs: P.mobs.length, surfaceY: P.surfaceY, px: P.px, pz: P.pz };
});
console.log('day setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
await shot('day');
r = await evaluate(() => window.__mobP.lightReport());
console.log('day light:', JSON.stringify(r));

// ---------------------------------------------------------------------------
// Scene 2: night (t=18000)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc;
  m.level.time = 18000;
  return { time: m.level.time, sky: m.sky && { fog: m.sky.fogColor, skyLightLevel: m.sky.skyLightLevel } };
});
console.log('night setup:', JSON.stringify(r));
await page.waitForTimeout(1800);
await shot('night');
r = await evaluate(() => window.__mobP.lightReport());
console.log('night light:', JSON.stringify(r));

// ---------------------------------------------------------------------------
// Scene 3: night + torch beside the zombie
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  const zombie = P.mobs[0];
  const tx = Math.floor(zombie.x), ty = P.surfaceY, tz = Math.floor(zombie.z);
  const torch = m.mc.stateOf('torch');
  const ok = m.level.setBlockState(tx, ty, tz + 2, torch);
  const bx = Math.floor(zombie.x), by = Math.floor(zombie.getEyeY()), bz = Math.floor(zombie.z);
  return {
    torchState: torch, placed: ok, at: [tx, ty, tz + 2],
    zombieBlockLight: m.level.getBlockLight(bx, by, bz),
    zombieSkyLight: m.level.getSkyLight(bx, by, bz),
    torchLight: m.level.getBlockLight(tx, ty, tz + 2),
  };
});
console.log('torch setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
await shot('night-torch');
r = await evaluate(() => window.__mobP.lightReport());
console.log('torch light:', JSON.stringify(r));

// ---------------------------------------------------------------------------
// Scene 4: walking animation, two frames 0.3 s apart
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  P.mobs.length = 0;
  // remove the torch again so the light is neutral
  m.level.setBlockState(Math.floor(m.player.pos.x) + 5, P.surfaceY, Math.floor(m.player.pos.z) + 2, 0);
  P.unfreeze();
  const z1 = P.spawn('zombie', P.px + 10.5, P.pz - 1.3);
  const z2 = P.spawn('zombie', P.px + 10.5, P.pz + 1.3);
  const sk = P.spawn('skeleton', P.px + 8.5, P.pz);
  return { spawned: [z1 && z1.getTypeName(), z2 && z2.getTypeName(), sk && sk.getTypeName()] };
});
console.log('walk setup:', JSON.stringify(r));
await page.waitForTimeout(1200);
const walkA = await evaluate(() => window.__mobP.lightReport());
await shot('walk-a');
await page.waitForTimeout(300);
const walkB = await evaluate(() => window.__mobP.lightReport());
await shot('walk-b');
console.log('walk anim A:', JSON.stringify(walkA));
console.log('walk anim B:', JSON.stringify(walkB));

// ---------------------------------------------------------------------------
// Scene 5: hurt flash (red overlay) + skeleton bow pose
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  P.mobs.length = 0;
  P.freeze();
  m.level.time = 6000;
  const zombie = P.spawn('zombie', P.px + 5.5, P.pz - 1.2);
  const sk = P.spawn('skeleton', P.px + 5.5, P.pz + 1.2);
  zombie.hurtTime = 10;          // vanilla 10-tick red overlay
  sk.isHoldingBow = true;
  return { hurtTime: zombie.hurtTime, skeleton: sk.getTypeName() };
});
console.log('hurt setup:', JSON.stringify(r));
await page.waitForTimeout(1800);
await shot('hurt');

// ---------------------------------------------------------------------------
// Scene 6: death fall (deathTime = 19 -> sqrt((19-1)/20*1.6) clamped = 90 deg)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  P.mobs.length = 0;
  const zombie = P.spawn('zombie', P.px + 5.5, P.pz);
  zombie.hurtTime = 0;
  zombie.dead = true;
  zombie.deathTime = 19;
  return { dead: zombie.dead, deathTime: zombie.deathTime };
});
console.log('death setup:', JSON.stringify(r));
await page.waitForTimeout(1800);
await shot('death');

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
const diag = await evaluate(() => {
  const m = window.__mc;
  return {
    glError: m.gl.getError(),
    drawCalls: m.entityRenderer.lastDrawCallCount,
    entities: m.entityManager.getEntities().length,
    fog: m.sky && m.sky.fogColor,
    fps: m.fps,
  };
});
console.log('diagnostics:', JSON.stringify(diag));

console.log('--- console (last 40) ---');
for (const line of logs.slice(-40)) console.log(line);

await browser.close();
console.log('done');
