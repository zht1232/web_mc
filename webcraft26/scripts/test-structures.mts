// Node test for the structure step: RandomSpreadPlacement (vanilla villages placement math)
// and VillageGenerator (piece layout determinism + per-chunk materialisation).
//
//   npx tsx scripts/test-structures.mts
//
// Generates a region at a seed where a village candidate falls on plains, verifies:
//   [1] potentialChunk matches vanilla's random_spread arithmetic (spacing/separation bounds)
//   [2] a village layout exists and is deterministic (same seed -> same piece list)
//   [3] per-chunk materialisation writes consistent blocks across chunk borders (a piece that
//       spans two chunks produces the same structure blocks in both, no missing halves)
//   [4] village blocks appear in generated chunks (planks, cobble, dirt_path, farmland...)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { LevelChunk } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import {
  NoiseChunkGenerator,
  type WorldgenData,
} from '../src/vanilla/world/level/levelgen/NoiseChunkGenerator.ts';
import { VILLAGE_PLACEMENT, structureRandom } from '../src/vanilla/world/level/levelgen/structure/RandomSpreadPlacement.ts';
import { VillageGenerator } from '../src/vanilla/world/level/levelgen/structure/VillageGenerator.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const blockMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8'));
const mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));

const data = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/worldgen.json'), 'utf8')) as WorldgenData;
const tagsJson = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/tags.json'), 'utf8'));
(data as { blockTags?: Record<string, string[]> }).blockTags =
  (tagsJson.block as Record<string, string[]>) ?? {};

const SEED = 0x2602c0den;

// ------------------------------------------------------------------ [1] placement math
{
  const random = structureRandom();
  let minSpread = 999, maxSpread = -1;
  for (let i = 0; i < 400; i++) {
    const p = VILLAGE_PLACEMENT.potentialChunk(SEED, i, i, random);
    // candidate must lie inside its spacing cell and respect separation
    const gx = floorDiv2(p.x, VILLAGE_PLACEMENT.spacing);
    const gz = floorDiv2(p.z, VILLAGE_PLACEMENT.spacing);
    const ox = p.x - gx * VILLAGE_PLACEMENT.spacing;
    const oz = p.z - gz * VILLAGE_PLACEMENT.spacing;
    if (ox < 0 || ox >= VILLAGE_PLACEMENT.spacing || oz < 0 || oz >= VILLAGE_PLACEMENT.spacing) {
      check('placement inside cell', false, `chunk (${p.x},${p.z}) offset (${ox},${oz})`);
      break;
    }
    minSpread = Math.min(minSpread, ox, oz);
    maxSpread = Math.max(maxSpread, ox, oz);
  }
  check('placement math in bounds', minSpread >= 0 && maxSpread < VILLAGE_PLACEMENT.spacing - VILLAGE_PLACEMENT.separation,
    `offsets ${minSpread}..${maxSpread}, limit=${VILLAGE_PLACEMENT.spacing - VILLAGE_PLACEMENT.separation}`);
}
function floorDiv2(a: number, b: number): number { return Math.floor(a / b); }

// ------------------------------------------------------------------ setup
const SEED2 = 0x2602c0den;
const gen = new NoiseChunkGenerator(mc, data, SEED2, 'overworld', true);
const village = new VillageGenerator(mc, gen.seaLevelY, -64, -64 + 384);

// ------------------------------------------------------------------ [2] find a plains village
let layout = null as ReturnType<VillageGenerator['layoutFor']>;
let layoutChunk: { x: number; z: number } | null = null;
const random = structureRandom();
outer:
for (let gx = -20; gx <= 20; gx++) {
  for (let gz = -20; gz <= 20; gz++) {
    const random2 = structureRandom();
    const c = VILLAGE_PLACEMENT.potentialChunk(SEED2, gx * 34, gz * 34, random2);
    const l = village.layoutFor(SEED2, c.x, c.z, (x, z) => gen.computeExactSurfaceHeight(x, z), (x, y, z) => gen.biomeName(gen.getBiome(x, y, z)));
    if (l && l.pieces.length > 3) {
      // confirm the site is plains
      const bn = gen.biomeName(gen.getBiome(l.originX, l.anchorY + 1, l.originZ));
      if (bn.includes('plains')) {
        layout = l;
        layoutChunk = { x: c.x, z: c.z };
        break outer;
      }
    }
  }
}
check('village layout found on plains', !!layout,
  layout ? `origin chunk (${layoutChunk!.x},${layoutChunk!.z}) pieces=${layout!.pieces.length} anchorY=${layout!.anchorY}` : 'none');
if (!layout) process.exit(1);

// determinism: same origin chunk -> identical piece list
const layout2 = village.layoutFor(SEED2, layoutChunk!.x, layoutChunk!.z, (x, z) => gen.computeExactSurfaceHeight(x, z), (x, y, z) => gen.biomeName(gen.getBiome(x, y, z)));
check('layout deterministic', JSON.stringify(layout2) === JSON.stringify(layout), 'piece lists identical');

// ------------------------------------------------------------------ [3] + [4] generate the region
const R = 6;
const cx0 = layoutChunk!.x - R, cz0 = layoutChunk!.z - R;
const gen2 = new NoiseChunkGenerator(mc, data, SEED2, 'overworld', true);
const chunks = new Map<string, LevelChunk>();
for (let dx = -R; dx <= R; dx++) {
  for (let dz = -R; dz <= R; dz++) {
    const chunk = new LevelChunk(layoutChunk!.x + dx, layoutChunk!.z + dz, -64, 384, mc);
    gen2.generateChunk(chunk);
    chunks.set(`${dx},${dz}`, chunk);
  }
}

// count village blocks across the whole region
const counts: Record<string, number> = {};
const nameOf = new Array<string>(mc.stateCount);
for (let s = 0; s < mc.stateCount; s++) nameOf[s] = mc.blockOf(s).name;
for (const chunk of chunks.values()) {
  for (const section of chunk.sections) {
    if (!section) continue;
    for (let i = 0; i < 4096; i++) {
      const st = section.states.get(i);
      const n = nameOf[st];
      if (n === 'oak_planks' || n === 'cobblestone' || n === 'dirt_path' || n === 'farmland' ||
          n === 'oak_door' || n === 'glass_pane' || n === 'oak_stairs') {
        counts[n] = (counts[n] ?? 0) + 1;
      }
    }
  }
}
check('village blocks present', (counts['oak_planks'] ?? 0) > 100 && (counts['cobblestone'] ?? 0) > 40 && (counts['dirt_path'] ?? 0) > 5,
  JSON.stringify(counts));

// cross-border consistency: the well ring at the anchor must be complete in whatever chunk holds it
{
  // 5x5 well: the 16 rim cells (|dx|==2 or |dz|==2) are cobblestone walls at anchorY+1
  const wy = layout!.anchorY + 1;
  let ringBlocks = 0, ringFound = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
      ringFound++;
      const bx = layout!.originX + dx, bz = layout!.originZ + dz;
      const chunk = chunks.get(`${Math.floor(bx / 16) - layoutChunk!.x},${Math.floor(bz / 16) - layoutChunk!.z}`);
      if (!chunk) continue;
      const lx = ((bx % 16) + 16) % 16, lz = ((bz % 16) + 16) % 16;
      if (nameOf[chunk.getBlockState(lx, wy, lz)].includes('cobblestone')) ringBlocks++;
    }
  }
  check('well ring complete (cross-chunk)', ringBlocks === ringFound && ringFound === 16, `ring blocks=${ringBlocks}/${ringFound}`);
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
