// Screenshot harness for the HANDOFF 8.1 mob models (slime / witch / fox / cat /
// ocelot / parrot / squid / glow squid / cod / salmon / cave spider / zombie
// villager). One browser session, three scenes:
//
//   shots/mobs2/day.png         t=6000  all 12 new mobs in a clearing
//   shots/mobs2/night.png       t=18000 same lineup (dark blue lightmap)
//   shots/mobs2/night-torch.png t=18000 + a torch next to the water mobs
//
// It also prints the actual renderer check the fix is about:
// EntityRenderDispatcher.canRender(type) for every new type (a type without a
// MODEL_REGISTRY entry is invisible *and* gets its factory nulled by Game.init).
//
// Usage: node scripts/shot-newmobs.mjs [url]

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/?play';
const outDir = 'shots/mobs2';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
const deadline = Date.now() + 150000;
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
// Scene helpers installed in the page (same pattern as scripts/shot-mobs.mjs)
// ---------------------------------------------------------------------------
await evaluate(() => {
  const m = window.__mc;
  // entity.scale values from src/vanilla/world/entity/**; the renderer multiplies
  // its per-type EXTRA_SCALE on top of these to reach the vanilla size.
  const SPAWNED = [
    // row 1: ground mobs
    { name: 'slime', dx: 4.5, dz: -3.6 },
    { name: 'witch', dx: 4.5, dz: -2.4 },
    { name: 'cave_spider', dx: 4.5, dz: -1.2 },
    { name: 'zombie_villager', dx: 4.5, dz: 0.0 },
    { name: 'fox', dx: 4.5, dz: 1.2 },
    { name: 'cat', dx: 4.5, dz: 2.4 },
    // row 2: the second half, water mobs floated above the grass so they render
    // the way they would while hovering in water (no fluid physics in the port)
    { name: 'ocelot', dx: 7.5, dz: -3.0 },
    { name: 'parrot', dx: 7.5, dz: -1.8, dy: 0.55 },
    { name: 'squid', dx: 7.5, dz: -0.6, dy: 1.5 },
    { name: 'glow_squid', dx: 7.5, dz: 0.6, dy: 1.5 },
    { name: 'cod', dx: 7.5, dz: 1.8, dy: 0.8 },
    { name: 'salmon', dx: 7.5, dz: 3.0, dy: 0.8 },
  ];
  const P = {
    mobs: [],
    clearing: null,
    spawned: [],
    freeze() {
      if (!m.__newMobOrigPlayerTick) m.__newMobOrigPlayerTick = m.player.tick;
      m.player.tick = () => {};
      m.entityManager.spawnInterval = 1e9;
      m.entityManager.tick = () => {};
    },
    clearMobs() {
      for (const e of m.entityManager.getEntities()) e.remove();
      P.mobs.length = 0;
    },
    findClearing() {
      const air = (x, y, z) => m.level.getBlockState(x, y, z) === 0;
      const px = Math.floor(m.player.pos.x), pz = Math.floor(m.player.pos.z);
      let best = null;
      for (let dx = 6; dx <= 14 && !best; dx++) {
        for (let dz = -8; dz <= 8 && !best; dz++) {
          const x = px + dx, z = pz + dz;
          const h = m.level.getHeight(x, z);
          let ok = true;
          for (let ax = -1; ax <= 8; ax++) {
            for (let az = -7; az <= 7; az++) {
              if (m.level.getHeight(x + ax, z + az) !== h) { ok = false; break; }
              if (!air(x + ax, h + 1, z + az) || !air(x + ax, h + 2, z + az) || !air(x + ax, h + 3, z + az)) { ok = false; break; }
            }
            if (!ok) break;
          }
          if (ok) best = { x, z, h };
        }
      }
      if (!best) {
        const h = m.level.getHeight(px + 6, pz);
        best = { x: px + 6, z: pz, h };
      }
      P.clearing = best;
      m.player.pos.x = best.x + 0.5; m.player.pos.y = best.h + 1; m.player.pos.z = best.z + 0.5;
      m.player.prevPos.x = m.player.pos.x; m.player.prevPos.y = m.player.pos.y; m.player.prevPos.z = m.player.pos.z;
      m.player.yaw = 90;   // camera forward = +X
      m.player.pitch = 6;  // slight look-down; vanilla positive pitch looks down
      return best;
    },
    spawnOne(spec) {
      const c = P.clearing;
      const x = c.x + spec.dx, z = c.z + spec.dz;
      const y = c.h + 1 + (spec.dy ?? 0);
      const e = m.entityManager.spawn(spec.name, x, y, z);
      if (!e) return null;
      e.x = x; e.y = y; e.z = z;
      e.xo = x; e.yo = y; e.zo = z;
      // face the camera: MC yaw 0 looks +Z and yaw 90 looks -X; the camera sits at
      // -X looking +X, so yaw 90 turns the model's front (-Z) toward the camera.
      e.yaw = 90; e.yRotO = 90;
      e.yBodyRot = 90; e.yBodyRotO = 90;
      e.yHeadRot = 90; e.yHeadRotO = 90;
      e.pitch = 0; e.xRotO = 0;
      P.mobs.push(e);
      P.spawned.push({ type: spec.name, ok: true, x, y, z });
      return e;
    },
    spawnAll() {
      P.clearMobs();
      P.spawned = [];
      for (const spec of SPAWNED) {
        const e = P.spawnOne(spec);
        if (!e) P.spawned.push({ type: spec.name, ok: false });
      }
      m.showDebug = false;
      return P.spawned;
    },
  };
  window.__newMobP = P;
});
console.log('helpers installed');

// ---------------------------------------------------------------------------
// Probe: canRender() for every new type (this is the natural-spawn un-block)
// ---------------------------------------------------------------------------
let r = await evaluate(() => {
  const m = window.__mc;
  const types = ['slime', 'witch', 'cave_spider', 'zombie_villager', 'fox', 'cat',
    'ocelot', 'parrot', 'squid', 'glow_squid', 'cod', 'salmon'];
  return types.map((t) => ({ type: t, canRender: m.entityRenderer.canRender(t) }));
});
console.log('canRender:', JSON.stringify(r));

// ---------------------------------------------------------------------------
// Scene 1: day (t=6000)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__newMobP;
  P.freeze();
  P.clearMobs();
  const clearing = P.findClearing();
  const spawned = P.spawnAll();
  m.level.time = 6000;
  return { clearing, spawned, time: m.level.time };
});
console.log('day setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
r = await evaluate(() => {
  const m = window.__mc, P = window.__newMobP;
  return {
    entities: m.entityManager.getEntities().length,
    renderers: P.mobs.map((e) => ({ type: e.getTypeName(), pos: [+e.x.toFixed(1), +e.y.toFixed(1), +e.z.toFixed(1)] })),
    drawCalls: m.entityRenderer.lastDrawCallCount,
    batchFloats: Array.from(m.entityRenderer.batch.lengths).reduce((a, b) => a + b, 0),
    sky: { factor: m.sky.skyFactor, light: m.sky.skyLightLevel },
    time: m.level.time,
  };
});
console.log('day:', JSON.stringify(r));
await shot('day');

// ---------------------------------------------------------------------------
// Scene 2: night (t=18000), same lineup
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc;
  m.level.time = 18000;
  return { time: m.level.time };
});
console.log('night setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
r = await evaluate(() => {
  const m = window.__mc;
  return {
    drawCalls: m.entityRenderer.lastDrawCallCount,
    batchFloats: Array.from(m.entityRenderer.batch.lengths).reduce((a, b) => a + b, 0),
    sky: { factor: m.sky.skyFactor, light: m.sky.skyLightLevel },
    time: m.level.time,
  };
});
console.log('night:', JSON.stringify(r));
await shot('night');

// ---------------------------------------------------------------------------
// Scene 3: night + torch next to the water-mob row (glow squid / fish lit by
// block light instead of the moon)
// ---------------------------------------------------------------------------
r = await evaluate(() => {
  const m = window.__mc, P = window.__newMobP;
  const c = P.clearing;
  const torch = m.mc.stateOf('torch');
  const tx = Math.floor(c.x + 6.0), ty = c.h + 1, tz = Math.floor(c.z);
  const placed = m.level.setBlockState(tx, ty, tz, torch);
  P.torchPos = [tx, ty, tz];
  const lightAt = (e) => {
    const bx = Math.floor(e.x), by = Math.floor(e.getEyeY()), bz = Math.floor(e.z);
    return { block: m.level.getBlockLight(bx, by, bz), sky: m.level.getSkyLight(bx, by, bz) };
  };
  return { placed, torchAt: [tx, ty, tz], light: P.mobs.map((e) => ({ type: e.getTypeName(), ...lightAt(e) })) };
});
console.log('torch setup:', JSON.stringify(r));
await page.waitForTimeout(2500);
await shot('night-torch');

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
const diag = await evaluate(() => {
  const m = window.__mc;
  return {
    glError: m.gl.getError(),
    drawCalls: m.entityRenderer.lastDrawCallCount,
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
