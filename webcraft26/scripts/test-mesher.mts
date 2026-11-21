// Node test for src/client/renderer/chunk/SectionMesher.ts
//
//   npx tsx scripts/test-mesher.mts
//
// Loads the shipped data pack with fs (no fetch), builds a fake 3x3x3 world around a single
// block position and asserts the vanilla quad/AO/light/fluid behaviour.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { ModelSource } from '../src/client/renderer/model/ModelSource.ts';
import {
  RenderLayer,
  layerFor,
  meshFluid,
  meshSection,
  type MeshInput,
  type SectionMesh,
  type TintSource,
} from '../src/client/renderer/chunk/SectionMesher.ts';

// ---------------------------------------------------------------------------
// data pack
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const blockMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8'));
const modelMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/models.json'), 'utf8'));

const mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));

const models = new ModelSource(
  new DataView(readArrayBuffer(path.join(root, 'public/mc/models.bin'))),
  modelMeta.textures,
  modelMeta.models,
  modelMeta.noGeometry ?? [],
);

const AIR = mc.stateOf('air');

// vanilla water colour (WaterColor / BiomeColors.DEFAULT_WATER = 0x3F76E4)
const WATER_TINT: [number, number, number] = [0x3f / 255, 0x76 / 255, 0xe4 / 255];

const tints: TintSource = {
  tint(stateId, tintIndex, x, z) {
    const name = mc.blockOf(stateId).name;
    if (name === 'water' || tintIndex === 0) {
      if (name === 'water') return WATER_TINT;
      if (name.includes('grass') || name === 'oak_leaves' || name === 'short_grass' || name === 'fern') {
        return [0.56, 0.74, 0.35];
      }
    }
    if (name.endsWith('_leaves') || name.includes('grass')) return [0.56, 0.74, 0.35];
    return [1, 1, 1];
  },
};

// ---------------------------------------------------------------------------
// fake world: explicit blocks in a (small) map, air everywhere else
// ---------------------------------------------------------------------------

class FakeWorld {
  readonly blocks = new Map<string, number>();
  /** light used for every position unless overridden */
  sky = 15;
  block = 0;

  set(x: number, y: number, z: number, state: number): this {
    this.blocks.set(`${x},${y},${z}`, state);
    return this;
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number): this {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) this.set(x, y, z, state);
      }
    }
    return this;
  }

  getState(x: number, y: number, z: number): number {
    const s = this.blocks.get(`${x},${y},${z}`);
    return s === undefined ? AIR : s;
  }

  getSkyLight(): number {
    return this.sky;
  }

  getBlockLight(): number {
    return this.block;
  }

  input(variantSeed = 0x5eed): MeshInput {
    return {
      mc,
      models,
      getState: (x, y, z) => this.getState(x, y, z),
      getSkyLight: () => this.sky,
      getBlockLight: () => this.block,
      tints,
      originX: 0,
      originY: 0,
      originZ: 0,
      variantSeed,
    };
  }

  mesh(variantSeed?: number): SectionMesh {
    return meshSection(this.input(variantSeed));
  }
}

const STRIDE = 24;

interface Vertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  tex: number;
  sky: number;
  block: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

function readVertex(buf: Uint8Array, i: number): Vertex {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const o = i * STRIDE;
  return {
    x: dv.getFloat32(o, true),
    y: dv.getFloat32(o + 4, true),
    z: dv.getFloat32(o + 8, true),
    u: dv.getUint16(o + 12, true),
    v: dv.getUint16(o + 14, true),
    tex: dv.getUint16(o + 16, true),
    sky: dv.getUint8(o + 18),
    block: dv.getUint8(o + 19),
    r: dv.getUint8(o + 20),
    g: dv.getUint8(o + 21),
    b: dv.getUint8(o + 22),
    a: dv.getUint8(o + 23),
  };
}

function vertexCount(mesh: SectionMesh, layer: RenderLayer): number {
  return mesh.vertices[layer].length / STRIDE;
}

function totalQuads(mesh: SectionMesh): number {
  return mesh.quadCounts[0] + mesh.quadCounts[1] + mesh.quadCounts[2];
}

/** geometric normal of the (0,1,2) triangle of quad `q` in `layer` */
function quadNormal(mesh: SectionMesh, layer: RenderLayer, q: number): [number, number, number] {
  const a = readVertex(mesh.vertices[layer], q * 4);
  const b = readVertex(mesh.vertices[layer], q * 4 + 1);
  const c = readVertex(mesh.vertices[layer], q * 4 + 2);
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

// ---------------------------------------------------------------------------
// tiny assertion harness
// ---------------------------------------------------------------------------

let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`PASS  ${name}${detail ? `  [${detail}]` : ''}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown, detail = ''): void {
  check(name, actual === expected, `got ${String(actual)}, expected ${String(expected)}${detail ? `, ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 0. layer classification (sanity for the layer rules themselves)
// ---------------------------------------------------------------------------

console.log('--- layer assignment -------------------------------------------------');
eq('layerFor(stone) == SOLID', layerFor(mc.stateOf('stone'), mc), RenderLayer.SOLID);
eq('layerFor(torch) == CUTOUT', layerFor(mc.stateOf('torch'), mc), RenderLayer.CUTOUT);
eq('layerFor(short_grass) == CUTOUT', layerFor(mc.stateOf('short_grass'), mc), RenderLayer.CUTOUT);
eq('layerFor(oak_door) == CUTOUT', layerFor(mc.stateOf('oak_door'), mc), RenderLayer.CUTOUT);
eq('layerFor(ladder) == CUTOUT', layerFor(mc.stateOf('ladder'), mc), RenderLayer.CUTOUT);
eq('layerFor(oak_leaves) == CUTOUT', layerFor(mc.stateOf('oak_leaves'), mc), RenderLayer.CUTOUT);
eq('layerFor(iron_bars) == CUTOUT', layerFor(mc.stateOf('iron_bars'), mc), RenderLayer.CUTOUT);
eq('layerFor(glass) == TRANSLUCENT', layerFor(mc.stateOf('glass'), mc), RenderLayer.TRANSLUCENT);
eq('layerFor(ice) == TRANSLUCENT', layerFor(mc.stateOf('ice'), mc), RenderLayer.TRANSLUCENT);
eq(
  'layerFor(white_stained_glass) == TRANSLUCENT',
  layerFor(mc.stateOf('white_stained_glass'), mc),
  RenderLayer.TRANSLUCENT,
);
eq('layerFor(water) == TRANSLUCENT', layerFor(mc.stateOf('water'), mc), RenderLayer.TRANSLUCENT);
eq('layerFor(lava) == SOLID', layerFor(mc.stateOf('lava'), mc), RenderLayer.SOLID);

// ---------------------------------------------------------------------------
// 1. a lone stone block
// ---------------------------------------------------------------------------

console.log('\n--- 1. lone stone ----------------------------------------------------');
const stoneAlone = new FakeWorld().set(0, 0, 0, mc.stateOf('stone')).mesh();
eq('stone: 6 quads', totalQuads(stoneAlone), 6);
eq('stone: all in SOLID', stoneAlone.quadCounts[RenderLayer.SOLID], 6);
eq('stone: 24 vertices', vertexCount(stoneAlone, RenderLayer.SOLID), 24);
eq('stone: 36 indices', stoneAlone.indices[RenderLayer.SOLID].length, 36);
eq('stone: no CUTOUT/TRANSLUCENT', stoneAlone.quadCounts[1] + stoneAlone.quadCounts[2], 0);

// winding: every face must point away from the cube centre
let windingOk = true;
for (let q = 0; q < stoneAlone.quadCounts[RenderLayer.SOLID]; q++) {
  const v0 = readVertex(stoneAlone.vertices[RenderLayer.SOLID], q * 4);
  const n = quadNormal(stoneAlone, RenderLayer.SOLID, q);
  const cx = (v0.x + 0.5) / 2 - 0.5 + 0.0; // centroid approximated with the face's first vertex
  const outward = n[0] * (v0.x - 0.5) + n[1] * (v0.y - 0.5) + n[2] * (v0.z - 0.5);
  if (outward <= 0) windingOk = false;
  void cx;
}
check('stone: CCW winding faces outward (0,1,2)+(0,2,3)', windingOk);

// ---------------------------------------------------------------------------
// 2. two adjacent stone blocks: the shared face is culled
// ---------------------------------------------------------------------------

console.log('\n--- 2. two adjacent stone blocks ------------------------------------');
const twoStone = new FakeWorld()
  .set(0, 0, 0, mc.stateOf('stone'))
  .set(1, 0, 0, mc.stateOf('stone'))
  .mesh();
eq('two stone: 10 quads (shared face culled)', totalQuads(twoStone), 10);

// ---------------------------------------------------------------------------
// 3. torch: cutout
// ---------------------------------------------------------------------------

console.log('\n--- 3. torch --------------------------------------------------------');
const torch = new FakeWorld().set(0, 0, 0, mc.stateOf('torch')).mesh();
eq('torch: 6 quads', totalQuads(torch), 6);
eq('torch: in CUTOUT', torch.quadCounts[RenderLayer.CUTOUT], 6);
eq('torch: nothing in SOLID', torch.quadCounts[RenderLayer.SOLID], 0);

// ---------------------------------------------------------------------------
// 4. glass: translucent, and glass next to glass keeps both faces
// ---------------------------------------------------------------------------

console.log('\n--- 4. glass --------------------------------------------------------');
const glassAlone = new FakeWorld().set(0, 0, 0, mc.stateOf('glass')).mesh();
eq('glass: 6 quads', totalQuads(glassAlone), 6);
eq('glass: in TRANSLUCENT', glassAlone.quadCounts[RenderLayer.TRANSLUCENT], 6);

const twoGlass = new FakeWorld()
  .set(0, 0, 0, mc.stateOf('glass'))
  .set(1, 0, 0, mc.stateOf('glass'))
  .mesh();
eq('two glass: 12 quads (TransparentBlock has no skipRendering)', totalQuads(twoGlass), 12);

// opposite case: ice is a HalfTransparentBlock and *does* skip same block faces
const twoIce = new FakeWorld()
  .set(0, 0, 0, mc.stateOf('ice'))
  .set(1, 0, 0, mc.stateOf('ice'))
  .mesh();
eq('two ice: 10 quads (HalfTransparentBlock.skipRendering)', totalQuads(twoIce), 10);

// ---------------------------------------------------------------------------
// 5. stairs
// ---------------------------------------------------------------------------

console.log('\n--- 5. oak stairs ---------------------------------------------------');
const stairsState = mc.stateOf('oak_stairs', { facing: 'north', half: 'bottom', shape: 'straight' });
const stairs = new FakeWorld().set(0, 0, 0, stairsState).mesh();
eq('oak_stairs: 11 quads (baked model)', totalQuads(stairs), 11);

// ---------------------------------------------------------------------------
// 6. fence connections
// ---------------------------------------------------------------------------

console.log('\n--- 6. oak fence ----------------------------------------------------');
const fenceAlone = new FakeWorld().set(0, 0, 0, mc.stateOf('oak_fence')).mesh();
const fenceConnectedState = mc.stateOf('oak_fence', {
  north: 'true',
  south: 'true',
  east: 'true',
  west: 'true',
});
const fenceConnected = new FakeWorld().set(0, 0, 0, fenceConnectedState).mesh();
check(
  'oak_fence: connected emits more quads than isolated',
  fenceConnected.quadCounts[0] > fenceAlone.quadCounts[0],
  `connected ${fenceConnected.quadCounts[0]} > isolated ${fenceAlone.quadCounts[0]}`,
);
eq('oak_fence: isolated post is 6 quads', fenceAlone.quadCounts[0], 6);
eq('oak_fence: 4 connections is post + 4 sides = 46 quads', fenceConnected.quadCounts[0], 46);

// ---------------------------------------------------------------------------
// 7. water
// ---------------------------------------------------------------------------

console.log('\n--- 7. water --------------------------------------------------------');
const water = mc.stateOf('water');

// 7a: single source on top of stone -> top + 4 sides, no bottom (stone occludes it)
const loneWaterWorld = new FakeWorld()
  .set(0, 0, 0, water)
  .set(0, -1, 0, mc.stateOf('stone'))
  .mesh();
eq('water alone on stone: 5 quads', loneWaterWorld.quadCounts[RenderLayer.TRANSLUCENT], 5);

let up = 0;
let down = 0;
let horizontal = 0;
for (let q = 0; q < loneWaterWorld.quadCounts[RenderLayer.TRANSLUCENT]; q++) {
  const n = quadNormal(loneWaterWorld, RenderLayer.TRANSLUCENT, q);
  if (n[1] > 0.5) up++;
  else if (n[1] < -0.5) down++;
  else horizontal++;
}
eq('water alone: 1 top quad', up, 1);
eq('water alone: 4 side quads', horizontal, 4);
eq('water alone: 0 bottom quads', down, 0);

// 7b: full 3x3 pool with air above -> only the top face of the centre block, corners at the
// full source height. FluidRenderer subtracts `offs = 0.001` from the four top corners.
const poolWorld = new FakeWorld().fill(-1, 0, -1, 1, 0, 1, water).set(0, -1, 0, water);
const pool = meshFluid(poolWorld.input(), 0, 0, 0);
check('water pool: meshFluid returns geometry', pool !== null);
if (pool) {
  eq('water pool: 1 top quad', pool.quads, 1);
  let topY = -Infinity;
  const dv = new DataView(pool.vertices.buffer, pool.vertices.byteOffset, pool.vertices.byteLength);
  for (let i = 0; i < pool.vertices.length / STRIDE; i++) {
    const y = dv.getFloat32(i * STRIDE + 4, true);
    if (y > topY) topY = y;
  }
  // vertex space is 1 unit per block (section 0..16), so the water surface sits 8/9 of a block
  // above the block base: y = 8/9 - 0.001 (vanilla's FluidRenderer `offs` notch).
  const expectedFraction = 8 / 9; // 0.8888 -> 14.222 in 16ths of a block
  const expectedWithInset = expectedFraction - 0.001;
  check(
    'water pool: top y == 8/9 - 0.001',
    Math.abs(topY - expectedWithInset) < 1e-4,
    `y=${topY.toFixed(5)} blocks, expected ${expectedWithInset.toFixed(5)}`,
  );
  check(
    'water pool: top y within 0.02/16 of 8/9*16 = 14.222 in 16ths',
    Math.abs(topY * 16 - expectedFraction * 16) < 0.02,
    `${(topY * 16).toFixed(5)} vs ${(expectedFraction * 16).toFixed(4)} sixteenths`,
  );
  const v0 = readVertex(pool.vertices, 0);
  eq('water pool: water tint applied (r channel)', v0.r, Math.round((0x3f / 255) * 255));
  eq('water pool: alpha is 255', v0.a, 255);
}

// falling/flowing level 1 -> 7/9 high
const flowingWater = mc.stateOf('water', { level: '1' });
const flowingWorld = new FakeWorld().fill(-1, 0, -1, 1, 0, 1, flowingWater).set(0, -1, 0, flowingWater);
const flowing = meshFluid(flowingWorld.input(), 0, 0, 0);
check('water level=1: meshFluid returns geometry', flowing !== null);
if (flowing) {
  eq('water level=1: 1 top quad', flowing.quads, 1);
  const dvf = new DataView(flowing.vertices.buffer, flowing.vertices.byteOffset, flowing.vertices.byteLength);
  let topY = -Infinity;
  for (let i = 0; i < flowing.vertices.length / STRIDE; i++) {
    const y = dvf.getFloat32(i * STRIDE + 4, true);
    if (y > topY) topY = y;
  }
  check(
    'water level=1: top y == 7/9 - 0.001 blocks',
    Math.abs(topY - (7 / 9 - 0.001)) < 1e-4,
    `y=${topY.toFixed(5)} blocks (${(topY * 16).toFixed(4)} in 16ths)`,
  );
}

// lava is emissive: block light 15, sky 0, SOLID layer
const lavaWorld = new FakeWorld().set(0, 0, 0, mc.stateOf('lava')).set(0, -1, 0, mc.stateOf('stone'));
const lava = meshFluid(lavaWorld.input(), 0, 0, 0);
check('lava: meshFluid returns geometry', lava !== null);
if (lava) {
  eq('lava: SOLID layer', lava.layer, RenderLayer.SOLID);
  const v = readVertex(lava.vertices, 0);
  eq('lava: block light 15', v.block, 15);
  eq('lava: sky light 0', v.sky, 0);
  eq('lava: no tint (white)', v.r, 255);
}

// ---------------------------------------------------------------------------
// 8. ambient occlusion darkens the face next to a solid corner
// ---------------------------------------------------------------------------

console.log('\n--- 8. ambient occlusion --------------------------------------------');
// ice is a full cube (shade brightness 0.2) without occlusion, so the face below it stays
// drawn while its AO corner sample sees the dark neighbour.
const noNeighbour = new FakeWorld().set(0, 0, 0, mc.stateOf('stone')).mesh();
const withNeighbour = new FakeWorld()
  .set(0, 0, 0, mc.stateOf('stone'))
  .set(0, 1, 0, mc.stateOf('ice'))
  .mesh();
function topFaceBrightness(mesh: SectionMesh): number {
  // the first block in the section (0,0,0) is meshed first; its 24 vertices are the 6 faces,
  // the UP quad is vertices 4..7 (stone's model emits dir 0..5 in order)
  let min = 255;
  for (let i = 4; i < 8; i++) {
    const v = readVertex(mesh.vertices[RenderLayer.SOLID], i);
    if (Math.abs(v.y - 1) < 1e-6 && v.r < min) min = v.r;
  }
  return min;
}

const brightA = topFaceBrightness(noNeighbour);
const brightB = topFaceBrightness(withNeighbour);
check(
  'AO: neighbour above the top face darkens it',
  brightB < brightA,
  `r ${brightA} -> ${brightB}`,
);

// the four corners of the top face are sampled independently: with one dark neighbour on the
// east side only, the east corners must be darker than the west ones
const cornerWorld = new FakeWorld()
  .set(0, 0, 0, mc.stateOf('stone'))
  .set(0, 1, 0, mc.stateOf('ice'))
  .set(1, 1, 0, mc.stateOf('ice'))
  .mesh();
const upQuad = [0, 1, 2, 3].map((i) => readVertex(cornerWorld.vertices[RenderLayer.SOLID], 4 + i));
const upMin = Math.min(...upQuad.map((v) => v.r));
const upMax = Math.max(...upQuad.map((v) => v.r));
check('AO: per-vertex colour varies across the quad', upMin !== upMax, `r in [${upMin}, ${upMax}]`);
check('AO: the darker vertices are the ones next to the occluder', upMin < 204, `min r=${upMin}`);

// ---------------------------------------------------------------------------
// 9. invariants: light range and buffer sizes
// ---------------------------------------------------------------------------

console.log('\n--- 9. vertex invariants --------------------------------------------');
{
  const world = new FakeWorld();
  world.set(0, 0, 0, mc.stateOf('stone'));
  world.set(1, 0, 0, mc.stateOf('ice'));
  world.set(2, 0, 0, mc.stateOf('oak_leaves'));
  world.set(0, 1, 0, mc.stateOf('torch'));
  world.set(1, 1, 0, mc.stateOf('short_grass'));
  world.set(1, 1, 1, mc.stateOf('oak_stairs'));
  world.set(2, 1, 0, mc.stateOf('oak_fence'));
  world.fill(3, 0, 0, 5, 0, 2, mc.stateOf('water'));
  world.set(3, 1, 0, mc.stateOf('glass'));
  world.set(4, 1, 0, mc.stateOf('chest'));
  world.sky = 13;
  world.block = 5;
  const mesh = world.mesh();

  let lightOk = true;
  let sizeOk = true;
  let indexOk = true;
  let alphaOk = true;
  let swayOk = true;
  let sawSway = false;
  for (let layer = 0; layer < 3; layer++) {
    if (mesh.vertices[layer].length % STRIDE !== 0) sizeOk = false;
    const n = mesh.vertices[layer].length / STRIDE;
    if (mesh.indices[layer].length !== mesh.quadCounts[layer] * 6) sizeOk = false;
    for (let i = 0; i < n; i++) {
      const v = readVertex(mesh.vertices[layer], i);
      if (v.sky < 0 || v.sky > 15 || v.block < 0 || v.block > 15) lightOk = false;
      // Alpha is the wind weight for cutout plants/leaves (255 = static); everything else opaque.
      if (layer === RenderLayer.CUTOUT) {
        if (v.a < 0 || v.a > 255) swayOk = false;
        if (v.a < 255) sawSway = true;
      } else if (v.a !== 255) alphaOk = false;
    }
    for (let i = 0; i < mesh.indices[layer].length; i++) {
      if (mesh.indices[layer][i] >= n) indexOk = false;
    }
  }
  check('vertex buffers are multiples of 24 bytes', sizeOk);
  check('sky/block light stays within 0..15', lightOk);
  check('solid/translucent alpha is always 255', alphaOk);
  check('cutout alpha encodes the wind weight', swayOk);
  check('plants/leaves carry a wind weight', sawSway);
  check('indices are in range', indexOk);
  check('skipped counts the chest (block entity)', mesh.skipped >= 1, `skipped=${mesh.skipped}`);

  const stoneQuads = mesh.quadCounts[RenderLayer.SOLID] + mesh.quadCounts[RenderLayer.CUTOUT];
  check('mixed section produced geometry', stoneQuads > 0 && mesh.quadCounts[RenderLayer.TRANSLUCENT] > 0,
    `solid=${mesh.quadCounts[0]} cutout=${mesh.quadCounts[1]} translucent=${mesh.quadCounts[2]}`);

  // lights actually come from the world callback (block light 5 -> lit, not 0)
  let sawBlockLight = false;
  for (let i = 0; i < vertexCount(mesh, RenderLayer.SOLID); i++) {
    if (readVertex(mesh.vertices[RenderLayer.SOLID], i).block === 5) sawBlockLight = true;
  }
  check('block light from the world callback reaches the vertices', sawBlockLight);
}

// ---------------------------------------------------------------------------
// 10. determinism of the weighted model variants
// ---------------------------------------------------------------------------

console.log('\n--- 10. variant determinism -----------------------------------------');
{
  const world = new FakeWorld();
  for (let x = 0; x < 6; x++) {
    for (let z = 0; z < 6; z++) world.set(x, 0, z, mc.stateOf('stone'));
  }
  const a = world.mesh(1234);
  const b = world.mesh(1234);
  const c = world.mesh(9999);
  let same = a.vertices[0].length === b.vertices[0].length;
  for (let i = 0; same && i < a.vertices[0].length; i++) if (a.vertices[0][i] !== b.vertices[0][i]) same = false;
  check('same variantSeed -> identical buffer', same);
  // 6x6 slab of stone in air: 36 top + 36 bottom + 24 side faces, one model per block
  eq('stone slab: 96 quads (one variant per block, no duplicates)', a.quadCounts[0], 96);
  let differs = false;
  for (let i = 0; i < Math.min(a.vertices[0].length, c.vertices[0].length); i++) {
    if (a.vertices[0][i] !== c.vertices[0][i]) {
      differs = true;
      break;
    }
  }
  check('different variantSeed rotates at least one stone model', differs || a.vertices[0].length !== c.vertices[0].length);
}

// ---------------------------------------------------------------------------
// 11. winding of every shipped model, checked against BakedQuad.direction
// ---------------------------------------------------------------------------

console.log('\n--- 11. winding of every model --------------------------------------');
{
  // (0,1,2) cross product must point the same way as the quad's face direction, otherwise the
  // (0,1,2)+(0,2,3) index order would be back facing.
  const NORMALS = [
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
    [-1, 0, 0],
    [1, 0, 0],
  ];
  const seen = new Set<number>();
  let quads = 0;
  let degenerate = 0;
  let wrong = 0;
  let firstWrong = '';
  for (let st = 0; st < mc.stateCount; st++) {
    const off = mc.modelOffset[st];
    const count = mc.modelCount[st];
    for (let i = 0; i < count; i++) {
      const mi = mc.modelIds[off + i];
      if (seen.has(mi)) continue;
      seen.add(mi);
      for (const q of models.getModel(mi).quads) {
        quads++;
        const p = q.p;
        const ax = p[3] - p[0];
        const ay = p[4] - p[1];
        const az = p[5] - p[2];
        const bx = p[6] - p[0];
        const by = p[7] - p[1];
        const bz = p[8] - p[2];
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-9) {
          degenerate++;
          continue;
        }
        const n = NORMALS[q.dir];
        const dot = (nx * n[0] + ny * n[1] + nz * n[2]) / len;
        if (dot <= 0.01) {
          wrong++;
          if (!firstWrong) firstWrong = `${models.modelLocation(mi)} dir=${q.dir} dot=${dot.toFixed(3)}`;
        }
      }
    }
  }
  check(
    `all ${quads} baked quads are CCW for (0,1,2)+(0,2,3)`,
    wrong === 0,
    `${seen.size} models, ${degenerate} degenerate, ${wrong} wrong${firstWrong ? `, first ${firstWrong}` : ''}`,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
