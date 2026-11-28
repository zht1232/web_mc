// Deterministic in-game test stage for browser probes.
//
// Parity checks used to screenshot whatever terrain happened to be around the
// player, so unrelated blocks, mobs and weather leaked into the pixels. This
// module carves a controlled arena high above the world, fixes the time,
// removes every entity and stops natural spawning, then puts the camera at an
// exact position. Screenshots can be diffed against a before/after pair, which
// isolates the entity under test without depending on the background.
//
//   import { prepareStage, frameCamera, waitTicks, capture, diffPng } from './lib/stage.mjs';
//
//   const stage = await prepareStage(page, { radius: 12, water: { dx: -4, dz: -4, w: 8, d: 8 } });
//   const before = await capture(page, stage.clip);
//   ... spawn entity ...
//   const after = await capture(page, stage.clip);
//   const diff = diffPng(before, after);

import fs from 'node:fs';
import { PNG } from 'pngjs';

/**
 * Builds the arena and teleports the player to the camera position.
 *
 * opts:
 *   x/z        column centre (defaults to the player's current column)
 *   y          floor top block Y (default 240; world max is 319)
 *   radius     half-size of the cleared platform (default 12)
 *   clear      blocks cleared above the floor (default 10)
 *   floor      floor block name (default "smooth_stone")
 *   water      { dx, dz, w, d } recessed one block pool, filled with source water
 *   backdrop   solid wall behind the entity for silhouette shots
 *   backdropBlock  wall block (default "white_concrete")
 *   camera     { x, y, z, yaw, pitch, fov }
 *   time       level day time (default 6000, noon)
 *   clip       screenshot clip used by capture() (default centre 420x320)
 */
export async function prepareStage(page, opts = {}) {
  const stage = await page.evaluate((o) => {
    const m = window.__mc;
    const p = m.player;
    const bx = Math.round(o.x ?? p.pos.x);
    const bz = Math.round(o.z ?? p.pos.z);
    const floorY = Math.round(o.y ?? 240);
    const radius = o.radius ?? 12;
    const clear = o.clear ?? 10;

    // No natural spawning while the probe runs, and no leftovers from the
    // world we flew in from.
    m.entityManager.spawnInterval = 1e9;
    for (const e of m.entityManager.getEntities()) e.remove();
    m.screens?.close?.();
    m.survival?.closeMenu?.();
    m.showDebug = false;
    // A frozen clock and clear sky keep two screenshots directly comparable.
    m.daylightCycle = false;
    m.level.time = o.time ?? 6000;
    m.level.setRainOverride(0);
    m.level.raining = false;
    m.level.thundering = false;
    m.level.rainTime = 1e9;
    m.level.thunderTime = 1e9;

    // Clear the volume and lay the floor.
    const floorState = m.mc.stateOf(o.floor ?? 'smooth_stone');
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = 0; dy <= clear; dy++) {
          m.level.setBlockState(bx + dx, floorY + dy, bz + dz, 0);
        }
        m.level.setBlockState(bx + dx, floorY - 1, bz + dz, floorState);
      }
    }

    // Recessed water pool (source blocks): the surface sits just below the
    // surrounding floor so a boat floats at the pool rim.
    const water = o.water ?? null;
    if (water) {
      const waterState = m.mc.stateOf('water');
      for (let dx = 0; dx < water.w; dx++) {
        for (let dz = 0; dz < water.d; dz++) {
          const x = bx + (water.dx ?? 0) + dx;
          const z = bz + (water.dz ?? 0) + dz;
          m.level.setBlockState(x, floorY - 2, z, floorState);
          m.level.setBlockState(x, floorY - 1, z, waterState);
        }
      }
    }

    // A vertical backdrop turns the arena into a photo studio: the entity is
    // the only thing between the camera and a flat wall.
    if (o.backdrop) {
      const wallState = m.mc.stateOf(o.backdropBlock ?? 'white_concrete');
      const wz = bz - radius + 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = 0; dy <= clear; dy++) {
          m.level.setBlockState(bx + dx, floorY + dy, wz, wallState);
        }
      }
    }

    // Camera: creative flight, no velocity, exact rotation.
    const cam = o.camera ?? {};
    p.flying = true;
    p.sneaking = false;
    p.pos.x = cam.x ?? bx + 0.5;
    p.pos.y = cam.y ?? floorY + 1.8;
    p.pos.z = cam.z ?? bz + 4.5;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    p.yaw = cam.yaw ?? 180;
    p.pitch = cam.pitch ?? 30;
    p.vel = new p.pos.constructor(0, 0, 0);
    if (cam.fov !== undefined) m.options.fov = cam.fov;
    return {
      x: bx, z: bz, floorY, radius,
      cam: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch },
    };
  }, opts);
  stage.clip = opts.clip ?? { x: 340, y: 190, width: 420, height: 320 };
  return stage;
}

/** Removes every entity without touching the arena blocks. */
export async function clearEntities(page) {
  await page.evaluate(() => {
    for (const e of window.__mc.entityManager.getEntities()) e.remove();
  });
}

/** Sets the camera (player) pose exactly; clears interpolation state. */
export async function frameCamera(page, cam) {
  await page.evaluate((c) => {
    const m = window.__mc;
    const p = m.player;
    p.flying = true;
    p.sneaking = false;
    p.pos.x = c.x;
    p.pos.y = c.y;
    p.pos.z = c.z;
    p.prevPos.x = c.x;
    p.prevPos.y = c.y;
    p.prevPos.z = c.z;
    p.yaw = c.yaw;
    p.pitch = c.pitch;
    p.vel = new p.pos.constructor(0, 0, 0);
    if (c.fov !== undefined) m.options.fov = c.fov;
  }, cam);
}

/** Waits for N game ticks (the entity manager clock advances once per tick). */
export async function waitTicks(page, ticks, timeout = 20000) {
  const start = await page.evaluate(() => window.__mc.entityManager.getGameTime());
  await page.waitForFunction(
    ([s, n]) => window.__mc.entityManager.getGameTime() >= s + n,
    [start, ticks],
    { timeout },
  );
}

/** Screenshot as a PNG buffer, optionally clipped to a rectangle. */
export async function capture(page, clip) {
  return page.screenshot(clip ? { clip } : {});
}

export function readPng(buffer) {
  return PNG.sync.read(buffer);
}

export function savePng(pngOrBuffer, path) {
  fs.mkdirSync(path.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
  const data = Buffer.isBuffer(pngOrBuffer) ? pngOrBuffer : PNG.sync.write(pngOrBuffer);
  fs.writeFileSync(path, data);
}

/**
 * Pixel diff between two equally sized PNG buffers.
 * A pixel counts as changed when any channel differs by more than `threshold`.
 * Returns the changed count, bounding box and centroid of the changed pixels.
 */
export function diffPng(before, after, threshold = 8) {
  const a = Buffer.isBuffer(before) ? readPng(before) : before;
  const b = Buffer.isBuffer(after) ? readPng(after) : after;
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let changed = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sumX = 0, sumY = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > threshold
        || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold
        || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold) {
        changed++;
        sumX += x; sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (changed === 0) {
    return { changed, bbox: null, centroid: null, width: a.width, height: a.height };
  }
  return {
    changed,
    width: a.width,
    height: a.height,
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    centroid: { x: sumX / changed, y: sumY / changed },
  };
}

/** Colour histogram of a rectangle (opaque pixels only). */
export function colorStats(png, rect = null) {
  const img = Buffer.isBuffer(png) ? readPng(png) : png;
  const r = rect ?? { x: 0, y: 0, width: img.width, height: img.height };
  const counts = new Map();
  let opaque = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 255) continue;
      opaque++;
      const key = (img.data[i] >> 3 << 10) | (img.data[i + 1] >> 3 << 5) | (img.data[i + 2] >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((p, q) => q[1] - p[1]).slice(0, 12)
    .map(([key, count]) => ({
      rgb: [(key >> 10) << 3, ((key >> 5) & 31) << 3, (key & 31) << 3],
      count,
    }));
  return { opaque, unique: counts.size, top };
}
