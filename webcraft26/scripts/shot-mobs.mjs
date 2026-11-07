// Mob renderer screenshot harness (mobs package).
//
// One browser session, several scenes, so the shared machine only pays for a
// single launch:
//   shots/mobs/day.png         t=6000, 13 mobs in a natural clearing
//   shots/mobs/night.png       t=18000, same mobs -> dark blue lightmap
//   shots/mobs/night-torch.png t=18000 + torch next to the zombie -> brighter
//   shots/mobs/walk-a.png / walk-b.png  two frames 0.3 s apart, walking mobs
//   shots/mobs/hurt.png        zombie hurt flash (0.7 red overlay)
//   shots/mobs/death.png       zombie 90-degree death fall
//
// Usage: node scripts/shot-mobs.mjs [url]

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/?play';
const outDir = 'shots/mobs';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));

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
if (state !== 'ready') {
  console.log('FAILED to load:', state);
  console.log(logs.slice(-20).join('\n'));
  await browser.close();
  process.exit(1);
}
// wait until chunk streaming has gone quiet, then a bit more for the mesher
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
// Scene helpers installed in the page
// ---------------------------------------------------------------------------
await evaluate(() => {
  const m = window.__mc;
  const P = {
    mobs: [],
    clearing: null,
    freeze() {
      if (!m.__mobOrigPlayerTick) m.__mobOrigPlayerTick = m.player.tick;
      m.player.tick = () => {};
      m.entityManager.spawnInterval = 1e9;
      m.entityManager.tick = () => {};
    },
    unfreeze() {
      if (m.__mobOrigPlayerTick) m.player.tick = m.__mobOrigPlayerTick;
      delete m.entityManager.tick;
    },
    clearMobs() {
      for (const e of m.entityManager.getEntities()) e.remove();
      P.mobs.length = 0;
    },
    /** Flat, treeless clearing in front of the player; also places the camera there. */
    findClearing() {
      const air = (x, y, z) => m.level.getBlockState(x, y, z) === 0;
      const px = Math.floor(m.player.pos.x), pz = Math.floor(m.player.pos.z);
      let best = null;
      for (let dx = 4; dx <= 12 && !best; dx++) {
        for (let dz = -7; dz <= 7 && !best; dz++) {
          const x = px + dx, z = pz + dz;
          const h = m.level.getHeight(x, z);
          let ok = true;
          for (let ax = -1; ax <= 8; ax++) {
            for (let az = -6; az <= 6; az++) {
              if (m.level.getHeight(x + ax, z + az) !== h) { ok = false; break; }
              if (!air(x + ax, h + 1, z + az) || !air(x + ax, h + 2, z + az) || !air(x + ax, h + 3, z + az)) { ok = false; break; }
            }
            if (!ok) break;
          }
          if (ok) best = { x, z, h };
        }
      }
      if (!best) {
        const h = m.level.getHeight(px + 5, pz);
        best = { x: px + 5, z: pz, h };
      }
      P.clearing = best;
      m.player.pos.x = best.x + 0.5; m.player.pos.y = best.h + 1; m.player.pos.z = best.z + 0.5;
      m.player.prevPos.x = m.player.pos.x; m.player.prevPos.y = m.player.pos.y; m.player.prevPos.z = m.player.pos.z;
      m.player.yaw = 90;   // camera forward = (sin yaw, 0, cos yaw) => +X
      m.player.pitch = 7;  // vanilla: positive pitch looks down
      return best;
    },
    surface() { return P.clearing ? P.clearing.h + 1 : m.player.pos.y; },
    spawn(name, dx, dz) {
      const c = P.clearing;
      const x = c.x + dx, z = c.z + dz, y = c.h + 1;
      const e = m.entityManager.spawn(name, x, y, z);
      if (!e) return null;
      e.x = x; e.y = y; e.z = z;
      e.xo = x; e.yo = y; e.zo = z;
      e.yaw = 90; e.yRotO = 90;
      e.yBodyRot = 90; e.yBodyRotO = 90;
      e.yHeadRot = 90; e.yHeadRotO = 90;
      e.pitch = 0; e.xRotO = 0;
      P.mobs.push(e);
      return e;
    },
    spawnAll() {
      P.clearMobs();
      const row1 = ['zombie', 'skeleton', 'creeper', 'spider', 'pig', 'cow', 'sheep'];
      const row2 = ['enderman', 'silverfish', 'chicken', 'wolf', 'rabbit', 'bat'];
      row1.forEach((name, i) => P.spawn(name, 4.5, -3.6 + i * 1.2));
      row2.forEach((name, i) => P.spawn(name, 7.5, -3.0 + i * 1.2));
      m.showDebug = false;
      return P.mobs.length;
    },
    lightReport() {
      return P.mobs.map((e) => {
        const bx = Math.floor(e.x), by = Math.floor(e.getEyeY()), bz = Math.floor(e.z);
        return {
          type: e.getTypeName(),
          light: [m.level.getSkyLight(bx, by, bz), m.level.getBlockLight(bx, by, bz)],
          walk: [+(e.walkAnimPos ?? 0).toFixed(2), +(e.walkAnimSpeed ?? 0).toFixed(2)],
          pos: [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)],
        };
      });
    },
  };
  window.__mobP = P;
});
console.log('helpers installed');

// ---------------------------------------------------------------------------
// Scene 1: day (t=6000) — 13 mobs
// ---------------------------------------------------------------------------
let r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.freeze();
  P.clearMobs();
  const clearing = P.findClearing();
  const spawned = P.spawnAll();
  m.level.time = 6000;
  return { clearing, spawned, sky: { skyFactor: m.sky && m.sky.skyFactor, fog: m.sky && m.sky.fogColor } };
});
console.log('day setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
r = await evaluate(() => ({ light: window.__mobP.lightReport(), sky: { f: window.__mc.sky.skyFactor, lvl: window.__mc.sky.skyLightLevel, fog: window.__mc.sky.fogColor } }));
console.log('day:', JSON.stringify(r));
await shot('day');

// ---------------------------------------------------------------------------
// Scene 2: night (t=18000) — same mobs
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc;
  m.level.time = 18000;
  return { time: m.level.time };
});
console.log('night setup:', JSON.stringify(r));
await page.waitForTimeout(2000);
r = await evaluate(() => ({ light: window.__mobP.lightReport(), sky: { f: window.__mc.sky.skyFactor, lvl: window.__mc.sky.skyLightLevel, fog: window.__mc.sky.fogColor }, time: window.__mc.level.time }));
console.log('night:', JSON.stringify(r));
await shot('night');

// ---------------------------------------------------------------------------
// Scene 3: night + torch beside the zombie (one lit, one in the dark)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  const c = P.clearing;
  const near = P.spawn('zombie', 4.5, 0);
  const far = P.spawn('zombie', 10.5, 0);
  const tx = Math.floor(near.x), ty = c.h + 1, tz = Math.floor(near.z) + 1;
  const torch = m.mc.stateOf('torch');
  const placed = m.level.setBlockState(tx, ty, tz, torch);
  P.torchPos = [tx, ty, tz];
  const at = (e) => {
    const bx = Math.floor(e.x), by = Math.floor(e.getEyeY()), bz = Math.floor(e.z);
    return { block: m.level.getBlockLight(bx, by, bz), sky: m.level.getSkyLight(bx, by, bz) };
  };
  return { placed, torchAt: [tx, ty, tz], near: at(near), far: at(far) };
});
console.log('torch setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
await shot('night-torch');
r = await evaluate(() => window.__mobP.lightReport());
console.log('torch light:', JSON.stringify(r));

// ---------------------------------------------------------------------------
// Scene 4: walking animation, two frames 0.3 s apart (one zombie close up)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  // put the torch back to air
  if (P.torchPos) m.level.setBlockState(P.torchPos[0], P.torchPos[1], P.torchPos[2], 0);
  m.level.time = 6000;
  P.unfreeze();
  m.player.tick = () => {};
  m.entityManager.spawnInterval = 1e9;
  P.spawn('zombie', 10.0, 0);
  return { spawned: P.mobs.length, time: m.level.time };
});
console.log('walk setup:', JSON.stringify(r));
await page.waitForTimeout(800);
const walkA = await evaluate(() => window.__mobP.lightReport());
await shot('walk-a');
await page.waitForTimeout(300);
const walkB = await evaluate(() => window.__mobP.lightReport());
await shot('walk-b');
console.log('walk A:', JSON.stringify(walkA));
console.log('walk B:', JSON.stringify(walkB));

// ---------------------------------------------------------------------------
// Scene 5: hurt flash (red overlay) + skeleton bow pose
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.freeze();
  P.clearMobs();
  m.level.time = 6000;
  const zombie = P.spawn('zombie', 4.5, -1.2);
  P.spawn('skeleton', 4.5, 1.2);
  zombie.hurtTime = 10; // vanilla red overlay: hasRedOverlay = hurtTime > 0
  return { hurtTime: zombie.hurtTime };
});
console.log('hurt setup:', JSON.stringify(r));
await page.waitForTimeout(2000);
await shot('hurt');

// ---------------------------------------------------------------------------
// Scene 6: death fall (deathTime 19 => sqrt((19-1)/20*1.6) clamped => 90 deg)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  const zombie = P.spawn('zombie', 4.5, 0);
  zombie.hurtTime = 0;
  zombie.dead = true;
  zombie.deathTime = 19;
  return { dead: zombie.dead, deathTime: zombie.deathTime };
});
console.log('death setup:', JSON.stringify(r));
await page.waitForTimeout(2000);
await shot('death');

// ---------------------------------------------------------------------------
// Scene 7: entity shadow (ShadowFeatureRenderer) close-up on flat grass
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__mobP;
  P.clearMobs();
  m.level.time = 6000;
  P.spawn('zombie', 4.0, 0);
  m.player.pitch = 22; // look down so the ground plane is visible
  return { pitch: m.player.pitch };
});
console.log('shadow setup:', JSON.stringify(r));
await page.waitForTimeout(2000);
await shot('shadow-close');

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
const diag = await evaluate(() => {
  const m = window.__mc;
  return {
    glError: m.gl.getError(),
    drawCalls: m.entityRenderer.lastDrawCallCount,
    lastBatchTotal: Array.from(m.entityRenderer.batch.lengths).reduce((a, b) => a + b, 0),
    shadowVertices: m.entityRenderer.shadowVertices,
    lightmapBound: !!m.entityRenderer.lightmap,
    fog: m.entityRenderer.fogColor,
    entities: m.entityManager.getEntities().length,
    fps: m.fps,
    time: m.level.time,
  };
});
console.log('diagnostics:', JSON.stringify(diag));

console.log('--- console (last 30) ---');
for (const line of logs.slice(-30)) console.log(line);
await browser.close();
console.log('done');
