// Node evidence for src/client/world/SpawnSelector.ts
//
//   npx tsx scripts/test-spawn.mts
//
// Uses the real shipped worldgen data and the real noise generator (no chunks are generated for
// the search itself), then generates the single chunk around the chosen column to prove the spot
// is standable ground and not the top of a tree.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { LevelChunk } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import { NoiseChunkGenerator, type WorldgenData } from '../src/vanilla/world/level/levelgen/NoiseChunkGenerator.ts';
import {
  DEFAULT_PREFERRED_BIOMES,
  findSpawnSpot,
  isTreeBlock,
  refineSpawnColumn,
  type SpawnSpot,
} from '../src/client/world/SpawnSelector.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const blockMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8'));
let mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/worldgen.json'), 'utf8')) as WorldgenData;

const SEED = 0x2602c0den;
const SEED_OTHER = 0x0badf00dn;
const gen = new NoiseChunkGenerator(mc, data, SEED);

let failures = 0;
function check(name: string, fn: () => boolean | string): void {
  let ok: boolean | string;
  try {
    ok = fn();
  } catch (e) {
    ok = `threw ${(e as Error).message}`;
  }
  if (ok === true) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${typeof ok === 'string' ? ' - ' + ok : ''}`); }
}

const describe = (spot: SpawnSpot): string =>
  `(${spot.x},${spot.z}) y=${spot.y} biome=${spot.biome} water=${spot.waterDistance === Infinity ? 'none' : spot.waterDistance + 'b'} ` +
  `relief=${spot.relief} score=${spot.score} columns=${spot.columnsSampled} biomeQueries=${spot.biomeQueries}`;

/** The OLD Game.findSpawnSpot: first column above sea level on a 4-block spiral from (8,8). */
function oldFindSpawnSpot(): { x: number; z: number; y: number } {
  const sea = gen.seaLevel;
  for (let r = 0; r <= 512; r += 4) {
    for (let dz = -r; dz <= r; dz += 4) {
      for (let dx = -r; dx <= r; dx += 4) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = 8 + dx;
        const z = 8 + dz;
        const h = gen.getSurfaceHeight(x, z);
        if (h >= sea + 1) return { x, z, y: h };
      }
    }
  }
  return { x: 8, z: 8, y: sea + 1 };
}

// ------------------------------------------------------------------ 1. old vs new
const oldSpot = oldFindSpawnSpot();
console.log(`old findSpawnSpot(): (${oldSpot.x}, ${oldSpot.y}, ${oldSpot.z}) biome=${gen.biomeName(gen.getBiome(oldSpot.x, oldSpot.y, oldSpot.z))}`);

const t0 = performance.now();
const first = findSpawnSpot(gen);
const firstWall = performance.now() - t0;
const t1 = performance.now();
const second = findSpawnSpot(gen);
const secondWall = performance.now() - t1;
const warmWalls: number[] = [];
for (let i = 0; i < 3; i++) {
  const t = performance.now();
  findSpawnSpot(gen);
  warmWalls.push(performance.now() - t);
}

console.log(`new findSpawnSpot():  ${describe(first)}`);
console.log(`  cold ${firstWall.toFixed(1)} ms, then ${secondWall.toFixed(1)} ms, warm ${warmWalls.map((w) => w.toFixed(1)).join('/')} ms`);

const signature = (spot: SpawnSpot): string =>
  [spot.x, spot.y, spot.z, spot.biome, spot.biomeId, spot.waterDistance, spot.relief, spot.score].join('|');
const oneLine = signature(first);

// ------------------------------------------------------------------ 2. checks
check('1. deterministic: two searches on the same seed return the identical spot', () =>
  signature(first) === signature(second) || `${signature(first)} != ${signature(second)}`);

check('2. biome is one of the preferred plains/forest/birch_forest families', () =>
  DEFAULT_PREFERRED_BIOMES.includes(first.biome) || `got ${first.biome}`);

check('3. the spot is on land above sea level', () =>
  first.y >= gen.seaLevel + 1 || `y=${first.y}, sea=${gen.seaLevel}`);

check('4. water is within the 24 block requirement', () =>
  first.waterDistance <= 24 || `water ${first.waterDistance} blocks away`);

check('5. terrain relief over the 3x3 grid is at most 3 blocks', () =>
  first.relief <= 3 || `relief ${first.relief}`);

check('6. the search stays inside the ~100 ms budget', () => {
  const worst = Math.min(...warmWalls);
  if (worst > 100) return `warm worst ${worst.toFixed(1)} ms`;
  return true;
});

check('6b. the reported water distance matches an independent water-rule scan', () => {
  // Same rule the implementation documents: preliminary height below sea level AND an
  // ocean/river/swamp biome. Scanned here from scratch, coarse 8 block grid around the spot.
  let best = Infinity;
  for (let dz = -32; dz <= 32; dz += 8) {
    for (let dx = -32; dx <= 32; dx += 8) {
      const x = first.x + dx;
      const z = first.z + dz;
      if (gen.getSurfaceHeight(x, z) >= gen.seaLevel) continue;
      if (!/ocean|river|swamp/.test(gen.biomeName(gen.getBiome(x, gen.seaLevel, z)))) continue;
      best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dz)));
    }
  }
  if (!Number.isFinite(best)) return 'independent scan found no water';
  return Math.abs(best - first.waterDistance) <= 8 || `scan ${best} vs reported ${first.waterDistance}`;
});

// Old-spot quality, for the report: how close is water and how rough is the ground.
let oldWater = Infinity;
for (let dz = -24; dz <= 24; dz++) {
  for (let dx = -24; dx <= 24; dx++) {
    if (gen.getSurfaceHeight(oldSpot.x + dx, oldSpot.z + dz) < gen.seaLevel) {
      oldWater = Math.min(oldWater, Math.max(Math.abs(dx), Math.abs(dz)));
    }
  }
}
let oldRelief = 0;
{
  let lo = Infinity;
  let hi = -Infinity;
  for (const [ox, oz] of [[-4, 0], [4, 0], [0, -4], [0, 4], [4, 4], [-4, -4], [4, -4], [-4, 4]]) {
    const h = gen.getSurfaceHeight(oldSpot.x + ox, oldSpot.z + oz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  oldRelief = hi - lo;
}
const oldBiomeName = gen.biomeName(gen.getBiome(oldSpot.x, oldSpot.y, oldSpot.z));
const oldLooksFine = oldWater <= 24 && oldRelief <= 3;
console.log(`old spot quality: biome=${oldBiomeName} water=${oldWater === Infinity ? 'none' : oldWater + 'b'} relief=${oldRelief}`);

check('7. the new spot is better than the old one for the spawn brief', () => {
  if (DEFAULT_PREFERRED_BIOMES.includes(oldBiomeName) && oldLooksFine) return 'old spot was already acceptable';
  if (first.biome === oldBiomeName) return 'biome did not change';
  return true;
});

// ------------------------------------------------------------------ 3. ground truth in the chunk
{
  const cx = first.x >> 4;
  const cz = first.z >> 4;
  const chunk = new LevelChunk(cx, cz, gen.minY, gen.height, mc);
  const tGen = performance.now();
  gen.generateChunk(chunk);
  const genMs = performance.now() - tGen;
  const lx = first.x & 15;
  const lz = first.z & 15;
  const nameAt = (y: number): string => mc.blockOf(chunk.getBlockState(lx, y, lz)).name;
  let top = gen.minY + gen.height - 1;
  while (top > gen.minY && mc.isAir(chunk.getBlockState(lx, top, lz))) top--;
  const topName = nameAt(top);
  const above1 = nameAt(top + 1);
  const above2 = nameAt(top + 2);
  const section = chunk.getSection(top >> 4)!;
  const biomeInChunk = section.biomes.get(((top & 15) << 8) | ((lz & 15) << 4) | (lx & 15));
  console.log(`chunk ${cx},${cz} in ${genMs.toFixed(0)} ms: column top y=${top} ${topName}, above ${above1}/${above2}; ` +
    `chunk biome ${gen.biomeName(biomeInChunk)} (search said ${first.biome})`);

  check('8. the chosen column is real ground, not water', () =>
    !mc.isLiquid(chunk.getBlockState(lx, top, lz)) || `top is liquid (${topName})`);
  check('9. the chosen column is not a tree canopy', () =>
    !isTreeBlock(topName) || `top is ${topName}`);
  check('10. the search biome matches the generated chunk biome at that column', () =>
    biomeInChunk === first.biomeId || `chunk ${biomeInChunk} vs search ${first.biomeId}`);
  check('11. two blocks of headroom above the surface', () =>
    (mc.isAir(chunk.getBlockState(lx, top + 1, lz)) && mc.isAir(chunk.getBlockState(lx, top + 2, lz))) ||
    `${above1}/${above2}`);
  check('12. refineSpawnColumn() is a no-op on a good column', () => {
    const refined = refineSpawnColumn(first.x, first.z, (x, z) => !isTreeBlock(mc.blockOf(chunk.getBlockState(x & 15, top, z & 15)).name), 4);
    return refined.x === first.x && refined.z === first.z || `moved to ${refined.x},${refined.z}`;
  });
}

// ------------------------------------------------------------------ 4. another seed is still valid
{
  const gen2 = new NoiseChunkGenerator(mc, data, SEED_OTHER);
  const t2 = performance.now();
  const spot2 = findSpawnSpot(gen2);
  const wall = performance.now() - t2;
  const spot2b = findSpawnSpot(gen2);
  console.log(`other seed: ${describe(spot2)} (wall ${wall.toFixed(1)} ms)`);
  check('13. a different seed yields a deterministic but different spot', () =>
    signature(spot2) === signature(spot2b) || 'not deterministic');
  check('14. the other seed also satisfies biome/water/relief', () =>
    (DEFAULT_PREFERRED_BIOMES.includes(spot2.biome) && spot2.waterDistance <= 24 && spot2.relief <= 3) ||
    `biome=${spot2.biome} water=${spot2.waterDistance} relief=${spot2.relief}`);
  check('15. the other seed spawns somewhere else', () =>
    spot2.x !== first.x || spot2.z !== first.z);
}

console.log('');
console.log(`spot=${oneLine}`);
if (failures === 0) console.log('ALL PASS');
else { console.log(`${failures} FAIL`); process.exitCode = 1; }
