// Node test for the client-side chunk unload policy in ClientLevel.ts
//
//   npx tsx scripts/test-chunkunload.mts
//
// Mirrors the vanilla client drop path:
//   net.minecraft.client.multiplayer.ClientChunkCache.drop / Storage.inRange / Storage.drop
//   (G:/ck-web26/src-vanilla/net/minecraft/client/multiplayer/ClientChunkCache.java:60-68,
//    159-161, 258-265, 318-320)
// Vanilla keeps its storage range at max(2, viewRange) + 3 chunks, i.e. 3 chunks of hysteresis
// between the load radius (render distance) and the unload radius. These checks pin that policy:
//  - enter radius and retain radius differ by >= 1 chunk, so a player standing on a chunk border
//    cannot generate/drop the same columns every tick (no thrash)
//  - a chunk with unsaved block edits (LevelChunk.dirtySections non-empty) is never dropped
//    silently; it stays loaded until WorldSaveManager.flushDirty() has persisted it
//  - a clean chunk that was generated this session may be dropped: NoiseChunkGenerator is
//    deterministic, so the same seed regenerates identical terrain when the player returns
//  - removeChunk / getChunk / getBlockState / light lookups stay consistent after a drop
//
// Chunks are planted directly in level.chunks (no generator, no light pass): the policy only
// touches the chunk map plus LevelChunk.dirtySections, and building 500 real chunks through
// addChunk() would just burn CPU on the light engine without testing anything extra.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { LevelChunk } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import {
  ClientLevel,
  CHUNK_RETAIN_MARGIN,
  DAY_LENGTH,
} from '../src/vanilla/world/level/ClientLevel.ts';
import { chunkKey } from '../src/vanilla/core/Geometry.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const blockMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8'));
const mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));

const MIN_Y = -64;
const HEIGHT = 384;
const STONE = mc.stateOf('stone');

// ------------------------------------------------------------------ helpers

let failures = 0;
function check(name: string, fn: () => boolean | string): void {
  let ok: boolean | string;
  try {
    ok = fn();
  } catch (e) {
    ok = `threw ${(e as Error).message}`;
  }
  if (ok === true) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${typeof ok === 'string' ? ' - ' + ok : ''}`);
  }
}

/** A generator-less level: chunks are planted by hand, like a client that got them from a server. */
function freshLevel(): ClientLevel {
  return new ClientLevel(mc, null, 0n);
}

function plant(level: ClientLevel, cx: number, cz: number): LevelChunk {
  const chunk = new LevelChunk(cx, cz, MIN_Y, HEIGHT, mc);
  level.chunks.set(chunkKey(cx, cz), chunk);
  return chunk;
}

/** Plants the full Chebyshev ring/grid |dx| <= r, |dz| <= r around (cx, cz). */
function plantSquare(level: ClientLevel, cx: number, cz: number, r: number): number {
  let n = 0;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      plant(level, cx + dx, cz + dz);
      n++;
    }
  }
  return n;
}

const RENDER_DISTANCE = 8;
const RETAIN = RENDER_DISTANCE + CHUNK_RETAIN_MARGIN; // 11

// ------------------------------------------------------------------ 1. policy constants

check('1. retain radius = max(2, viewRange) + 3 (vanilla ClientChunkCache.calculateStorageRange)', () => {
  if (CHUNK_RETAIN_MARGIN !== 3) return `CHUNK_RETAIN_MARGIN=${CHUNK_RETAIN_MARGIN}, expected 3`;
  if (RETAIN !== 11) return `retain radius ${RETAIN}, expected 11 for renderDistance 8`;
  if (RETAIN - RENDER_DISTANCE < 1) return 'no hysteresis between load and unload radius';
  console.log(`      renderDistance ${RENDER_DISTANCE} loads, retain radius ${RETAIN} keeps (hysteresis ${RETAIN - RENDER_DISTANCE})`);
  return true;
});

// ------------------------------------------------------------------ 2. boundary is exact

check('2. chunks at the retain boundary are kept, one chunk further are dropped', () => {
  const level = freshLevel();
  plant(level, 11, 0);
  plant(level, 11, 11);
  plant(level, 0, -11);
  plant(level, 12, 0);
  plant(level, 0, -12);
  plant(level, 12, 12);
  const removed = level.unloadFarChunks(0, 0, RETAIN);
  const removedNames = removed.map((c) => `${c.x},${c.z}`).sort().join(' ');
  if (removed.length !== 3) return `removed ${removed.length} chunks (${removedNames}), expected 3`;
  if (!level.hasChunk(11, 0) || !level.hasChunk(11, 11) || !level.hasChunk(0, -11)) {
    return 'a chunk inside the retain radius was dropped';
  }
  console.log(`      removed ${removedNames}; kept 11,0 / 11,11 / 0,-11`);
  return true;
});

// ------------------------------------------------------------------ 3. hysteresis / no thrash

check('3. crossing a chunk border does not drop-and-regenerate the boundary ring', () => {
  const level = freshLevel();
  const loaded = plantSquare(level, 0, 0, RETAIN); // 23x23 = 529, everything the client may hold
  if (level.chunks.size !== loaded) return `setup planted ${level.chunks.size}/${loaded}`;

  let removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 0) return `idle pass removed ${removed.length} chunks while the centre did not move`;

  // walk one chunk east: only the old west column (23 chunks) leaves the retain radius
  removed = level.unloadFarChunks(1, 0, RETAIN);
  if (removed.length !== 23) return `moving 1 chunk east removed ${removed.length}, expected the 23 chunks of column x=-11`;
  const afterMove = level.chunks.size;
  if (afterMove !== loaded - 23) return `size after move ${afterMove}, expected ${loaded - 23}`;

  // walking back must NOT drop anything more (the old column is kept unloaded, not re-created
  // here because ensureChunksAround only requests the enter radius): no oscillation
  removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 0) return `walking back removed ${removed.length} more chunks (thrash)`;
  if (level.chunks.size !== afterMove) return `size changed while walking back: ${level.chunks.size} != ${afterMove}`;
  console.log(`      ${loaded} held -> ${afterMove} after 1 chunk east -> stable after walking back`);
  return true;
});

// ------------------------------------------------------------------ 4. dirty chunks are protected

check('4. a chunk with unsaved edits is kept until the save layer clears it', () => {
  const level = freshLevel();
  const chunk = plant(level, 30, 0);
  chunk.setBlockState(0, 70, 0, STONE);
  if (!level.hasUnsavedChanges(30, 0)) return 'setBlockState did not mark dirtySections';
  if (!level.hasDirtyChunksOutside(0, 0, RETAIN)) return 'hasDirtyChunksOutside missed the edited chunk';

  let removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 0) return `dropped ${removed.length} chunk(s) with unsaved edits`;
  if (!level.hasChunk(30, 0)) return 'dirty chunk disappeared from the level';

  // WorldSaveManager.flushDirty() does exactly this once the bytes are in the IndexedDB batch
  chunk.clearDirty();
  if (level.hasUnsavedChanges(30, 0)) return 'clearDirty left dirtySections non-empty';
  removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 1) return `after flush removed ${removed.length}, expected 1`;
  if (level.hasChunk(30, 0)) return 'flushed chunk still loaded';
  console.log('      dirty chunk skipped, then dropped after clearDirty() (flush)');
  return true;
});

// ------------------------------------------------------------------ 5. clean generated chunks are safe

check('5. a never-persisted but clean chunk is safe to drop (deterministic regeneration)', () => {
  const level = freshLevel();
  const chunk = new LevelChunk(30, 0, MIN_Y, HEIGHT, mc);
  level.addChunk(chunk); // real add path incl. light engine
  if (chunk.dirtySections.size !== 0) return 'fresh chunk has dirtySections (generator edits?)';
  if (chunk.dirty !== true) return 'fresh chunk is not renderer-dirty (unexpected)';
  const removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 1 || removed[0] !== chunk) return `removed ${removed.length}, expected the fresh chunk`;
  console.log('      fresh chunk (dirty=true, dirtySections=0) dropped; seed regeneration is identical');
  return true;
});

// ------------------------------------------------------------------ 6. removeChunk semantics

check('6. removeChunk / getChunk / getBlockState stay consistent after a drop', () => {
  const level = freshLevel();
  const chunk = plant(level, 30, 0);
  chunk.setBlockState(0, 70, 0, STONE);
  const wx = 30 * 16;
  if (level.getBlockState(wx, 70, 0) !== STONE) return 'planted block not readable';
  const got = level.removeChunk(30, 0);
  if (got !== chunk) return 'removeChunk did not return the stored chunk';
  if (level.hasChunk(30, 0) || level.getChunk(30, 0) !== undefined) return 'chunk still reachable after removeChunk';
  if (level.getBlockState(wx, 70, 0) !== 0) return 'block lookup in a removed chunk did not fall back to air';
  if (level.removeChunk(30, 0) !== undefined) return 'second removeChunk returned a chunk';
  if (level.removeChunk(99, 99) !== undefined) return 'removeChunk on a missing chunk returned a chunk';
  // light queries on a missing chunk must not throw (LightEngine returns its "unloaded" defaults)
  const sky = level.getSkyLight(wx, 70, 0);
  if (typeof sky !== 'number' || !Number.isFinite(sky)) return `getSkyLight returned ${sky} on a removed chunk`;
  console.log(`      removeChunk ok, getBlockState=0, getSkyLight=${sky} (unloaded default)`);
  return true;
});

// ------------------------------------------------------------------ 7. radius clamp

check('7. retain radius is clamped to at least 2 chunks (player chunk is never dropped)', () => {
  const level = freshLevel();
  plant(level, 0, 0);
  plant(level, 2, 0);
  plant(level, 3, 0);
  const removed = level.unloadFarChunks(0, 0, 0);
  const names = removed.map((c) => `${c.x},${c.z}`).join(' ');
  if (removed.length !== 1 || names !== '3,0') return `radius 0 removed [${names}], expected only 3,0 (clamp 2)`;
  if (!level.hasChunk(0, 0)) return 'the chunk the player stands in was dropped';
  console.log('      radius 0 -> clamp 2: kept 0,0 and 2,0; dropped 3,0');
  return true;
});

// ------------------------------------------------------------------ 8. count helper

check('8. countChunksOutside matches the removed batch', () => {
  const level = freshLevel();
  plantSquare(level, 0, 0, RENDER_DISTANCE); // 289, the full enter ring
  if (level.countChunksOutside(0, 0, RETAIN) !== 0) return 'count > 0 while all chunks are inside the retain radius';
  plant(level, 40, 0);
  plant(level, -40, 3);
  plant(level, 0, -40);
  if (level.countChunksOutside(0, 0, RETAIN) !== 3) return `count ${level.countChunksOutside(0, 0, RETAIN)}, expected 3`;
  const removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 3) return `removed ${removed.length}, expected 3`;
  if (level.countChunksOutside(0, 0, RETAIN) !== 0) return 'count did not return to 0 after the unload pass';
  console.log('      289 entered ring + 3 far chunks -> count 3 -> removed 3 -> count 0');
  return true;
});

// ------------------------------------------------------------------ 9. teleport-shaped workload

check('9. after a 2000-block teleport the loaded set returns to one enter ring (smoke 15 shape)', () => {
  const level = freshLevel();
  // old area fully loaded (17x17 = 289), plus the retained margin the client may have cached
  plantSquare(level, 0, 0, RETAIN);
  const before = level.chunks.size;
  // teleport 2000 blocks ~= 125 chunks: every old chunk is outside the retain radius
  const removed = level.unloadFarChunks(125, 125, RETAIN);
  if (removed.length !== before) return `teleport dropped ${removed.length}/${before} old chunks`;
  if (level.chunks.size !== 0) return `${level.chunks.size} chunks left after the teleport`;
  // new area streams in up to the enter radius only (Game.ensureChunksAround never asks further)
  plantSquare(level, 125, 125, RENDER_DISTANCE);
  if (level.chunks.size !== 289) return `new enter ring is ${level.chunks.size}, expected 289`;
  const steady = level.unloadFarChunks(125, 125, RETAIN);
  if (steady.length !== 0) return `steady-state pass removed ${steady.length} chunks (unexpected)`;
  // old chunks do not come back: they are only requested within RENDER_DISTANCE of the new centre
  if (level.hasChunk(0, 0)) return 'a chunk from the old position is loaded again';
  console.log(`      old area ${before} chunks -> dropped all on teleport -> new ring 289, steady state stable`);
  return true;
});

// ------------------------------------------------------------------ 10. level clock untouched

check('10. unloading does not touch the day/weather fields (survival package owns those)', () => {
  const level = freshLevel();
  level.time = 18000;
  plant(level, 40, 0);
  level.unloadFarChunks(0, 0, RETAIN);
  if (level.time !== 18000) return `level.time changed to ${level.time}`;
  if (level.gameTime !== 0) return `gameTime changed to ${level.gameTime}`;
  if (level.getRainLevel() !== 0 || level.getThunderLevel() !== 0) return 'weather fields changed';
  if (level.raining !== false || level.thundering !== false) return 'raining/thundering changed';
  if (DAY_LENGTH !== 24000) return `DAY_LENGTH=${DAY_LENGTH}`;
  return true;
});

// ------------------------------------------------------------------ 11. edited chunks are pinned

check('11. a chunk edited through level.setBlockState is pinned and never dropped', () => {
  const level = freshLevel();
  plant(level, 30, 0);
  // real edit path (what Game.useItem/attack use), not chunk.setBlockState
  const changed = level.setBlockState(30 * 16, 70, 0, STONE);
  if (!changed) return 'setBlockState reported no change';
  if (!level.isChunkModified(30, 0)) return 'edited chunk was not added to modifiedChunks';
  if (!level.hasUnsavedChanges(30, 0)) return 'edited chunk was not marked dirtySections';
  if (level.countChunksOutside(0, 0, RETAIN) !== 0) return 'pinned chunk counted as an unload candidate';

  // flush happens (dirtySections cleared) but the chunk stays pinned: revisiting must show the edit
  level.chunks.get(chunkKey(30, 0))!.clearDirty();
  if (!level.isChunkModified(30, 0)) return 'modifiedChunks lost the chunk after a flush';
  const removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 0) return `dropped ${removed.length} edited chunk(s)`;
  if (level.getBlockState(30 * 16, 70, 0) !== STONE) return 'edit no longer readable after the unload pass';

  // an unmodified chunk right next to it still unloads: pinning is per chunk, not per area
  plant(level, 31, 0);
  const removed2 = level.unloadFarChunks(0, 0, RETAIN);
  if (removed2.length !== 1 || removed2[0].x !== 31) return `neighbour pass removed ${removed2.length}, expected the 1 clean chunk`;
  console.log('      edited chunk pinned across flush; clean neighbour still dropped');
  return true;
});

check('12. a no-op setBlockState does not pin the chunk', () => {
  const level = freshLevel();
  plant(level, 30, 0);
  // chunk is air at y=70, so writing air is a no-op and must not mark the chunk edited
  if (level.setBlockState(30 * 16, 70, 0, 0)) return 'setBlockState(air) reported a change';
  if (level.setBlockState(30 * 16, 70, 0, 0)) return 'second setBlockState(air) reported a change';
  if (level.isChunkModified(30, 0)) return 'no-op write pinned the chunk';
  const removed = level.unloadFarChunks(0, 0, RETAIN);
  if (removed.length !== 1) return `clean chunk not dropped after no-op write (${removed.length})`;
  return true;
});

// ------------------------------------------------------------------ result

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
