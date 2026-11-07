import type { LoadedAssets } from './assets.js';
import { sampleColormap } from './assets.js';
import { smoothstep } from './math.js';
import type { BlockRegistry } from './blocks.js';
import { generateStructures, type StructureSite } from './structures.js';

export const CHUNK_SIZE = 16;
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 320;
export const WORLD_HEIGHT = WORLD_MAX_Y - WORLD_MIN_Y;
export const SEA_LEVEL = 63;
export const REGION_RADIUS = 6;

const SKY_BITS = 9;
const Z_SHIFT = 9;
const Y_SHIFT = 18;

export const BIOME = {
  ocean: 0, plains: 1, forest: 2, birch: 3, taiga: 4, desert: 5, savanna: 6,
  snowy: 7, beach: 8, mountains: 9, frozenOcean: 10, swamp: 11,
};

const BIOME_DATA = [
  { name: 'ocean', temp: 0.5, humid: 0.5, water: '#3f76e4' },
  { name: 'plains', temp: 0.8, humid: 0.4, water: '#3f76e4' },
  { name: 'forest', temp: 0.7, humid: 0.8, water: '#3f76e4' },
  { name: 'birch_forest', temp: 0.6, humid: 0.6, water: '#3f76e4' },
  { name: 'taiga', temp: 0.25, humid: 0.8, water: '#287082' },
  { name: 'desert', temp: 2.0, humid: 0.0, water: '#32a598' },
  { name: 'savanna', temp: 1.2, humid: 0.0, water: '#2c8b9c' },
  { name: 'snowy_plains', temp: 0.0, humid: 0.5, water: '#3938c9' },
  { name: 'beach', temp: 0.8, humid: 0.4, water: '#3f76e4' },
  { name: 'mountains', temp: 0.2, humid: 0.3, water: '#3f76e4' },
  { name: 'frozen_ocean', temp: 0.0, humid: 0.5, water: '#3938c9' },
  { name: 'swamp', temp: 0.8, humid: 0.9, water: '#617b64' },
];

function hash2i(x: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3i(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 1103515245) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2i(xi, zi, seed), b = hash2i(xi + 1, zi, seed);
  const c = hash2i(xi, zi + 1, seed), d = hash2i(xi + 1, zi + 1, seed);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

function fbm2(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, fx = x, fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(fx, fz, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03; fz *= 2.03;
  }
  return sum / norm;
}

export interface Chunk {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  light: Uint8Array;
  biomes: Uint8Array;
  heights: Int16Array;
  generated: boolean;
}

class IntQueue {
  data: Int32Array;
  head = 0;
  tail = 0;
  constructor(capacity = 1 << 20) { this.data = new Int32Array(capacity); }
  get length() { return this.tail - this.head; }
  clear() { this.head = this.tail = 0; }
  push(v: number) {
    if (this.tail === this.data.length) {
      if (this.head > this.data.length / 2) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      } else {
        const grown = new Int32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
      }
    }
    this.data[this.tail++] = v;
  }
  pop(): number { return this.data[this.head++]; }
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly grid: (Chunk | null)[];
  readonly gridSize: number;
  readonly originCX: number;
  readonly originCZ: number;
  readonly minWorldX: number;
  readonly minWorldZ: number;
  readonly maxWorldX: number;
  readonly maxWorldZ: number;
  readonly seed: number;
  readonly rocks: BlockRegistry;

  readonly grassTint: Float32Array;
  readonly foliageTint: Float32Array;
  readonly waterTint: Float32Array;

  private ids: Record<string, number> = {};
  private skyQueue = new IntQueue(1 << 21);
  private blockQueue = new IntQueue(1 << 16);
  private flowerIds: number[] = [];
  /** Normalised direction from the chosen spawn toward the open water. */
  private viewX = 0;
  private viewZ = -1;
  /** Debug/diagnostic list of generated surface structures. */
  readonly structureSites: StructureSite[] = [];

  constructor(rocks: BlockRegistry, assets: LoadedAssets, seed = 0x26_02_2026) {
    this.rocks = rocks;
    this.seed = seed;
    this.gridSize = REGION_RADIUS * 2 + 1;
    this.originCX = -REGION_RADIUS;
    this.originCZ = -REGION_RADIUS;
    this.minWorldX = this.originCX * CHUNK_SIZE;
    this.minWorldZ = this.originCZ * CHUNK_SIZE;
    this.maxWorldX = (this.originCX + this.gridSize) * CHUNK_SIZE - 1;
    this.maxWorldZ = (this.originCZ + this.gridSize) * CHUNK_SIZE - 1;
    this.grid = new Array(this.gridSize * this.gridSize).fill(null);

    this.grassTint = new Float32Array(BIOME_DATA.length * 3);
    this.foliageTint = new Float32Array(BIOME_DATA.length * 3);
    this.waterTint = new Float32Array(BIOME_DATA.length * 3);
    for (let i = 0; i < BIOME_DATA.length; i++) {
      const b = BIOME_DATA[i];
      const g = sampleColormap(assets.grassColormap, Math.min(1, b.temp), Math.min(1, b.humid));
      const f = sampleColormap(assets.foliageColormap, Math.min(1, b.temp), Math.min(1, b.humid));
      this.grassTint.set(g, i * 3);
      this.foliageTint.set(f, i * 3);
      const n = parseInt(b.water.slice(1), 16);
      this.waterTint[i * 3] = ((n >> 16) & 255) / 255;
      this.waterTint[i * 3 + 1] = ((n >> 8) & 255) / 255;
      this.waterTint[i * 3 + 2] = (n & 255) / 255;
    }

    for (const name of [
      'stone', 'dirt', 'grass_block', 'sand', 'red_sand', 'gravel', 'clay', 'water', 'lava', 'ice', 'snow',
      'snow_block', 'oak_log', 'oak_leaves', 'birch_log', 'birch_leaves', 'spruce_log', 'spruce_leaves',
      'cactus', 'short_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'allium',
      'lily_of_the_valley', 'dead_bush', 'coal_ore', 'iron_ore', 'copper_ore', 'diamond_ore', 'emerald_ore',
      'deepslate', 'bedrock', 'sandstone', 'red_sandstone', 'sulfur', 'sulfur_bricks', 'polished_sulfur', 'chiseled_sulfur',
      'cinnabar', 'cinnabar_bricks', 'polished_cinnabar', 'chiseled_cinnabar', 'sulfur_spike', 'moss_block',
      'mossy_cobblestone',
    ]) {
      this.ids[name] = rocks.id(name);
    }
    this.flowerIds = [
      'poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'allium', 'lily_of_the_valley',
    ].map(n => this.ids[n]);
  }

  private isLog(id: number): boolean {
    return id === this.ids.oak_log || id === this.ids.birch_log || id === this.ids.spruce_log;
  }

  private isLeaves(id: number): boolean {
    return id === this.ids.oak_leaves || id === this.ids.birch_leaves || id === this.ids.spruce_leaves;
  }

  private isTreeBlock(id: number): boolean {
    return this.isLog(id) || this.isLeaves(id);
  }

  chunkIndex(cx: number, cz: number): number {
    return (cx - this.originCX) * this.gridSize + (cz - this.originCZ);
  }

  chunkAt(cx: number, cz: number): Chunk | null {
    if (cx < this.originCX || cz < this.originCZ) return null;
    if (cx >= this.originCX + this.gridSize || cz >= this.originCZ + this.gridSize) return null;
    return this.grid[this.chunkIndex(cx, cz)];
  }

  createChunk(cx: number, cz: number): Chunk {
    const chunk: Chunk = {
      cx, cz,
      blocks: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT),
      light: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT),
      biomes: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
      heights: new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(SEA_LEVEL),
      generated: false,
    };
    this.chunks.set(`${cx},${cz}`, chunk);
    this.grid[this.chunkIndex(cx, cz)] = chunk;
    return chunk;
  }

  idx(x: number, y: number, z: number): number {
    const lx = x & 15, lz = z & 15;
    return ((y - WORLD_MIN_Y) << 8) | (lz << 4) | lx;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 0;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunkAt(cx, cz);
    if (!c) return 0;
    return c.blocks[this.idx(x, y, z)];
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return;
    c.blocks[this.idx(x, y, z)] = id;
  }

  getSky(x: number, y: number, z: number): number {
    if (y >= WORLD_MAX_Y) return 15;
    if (y < WORLD_MIN_Y) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return 15;
    return c.light[this.idx(x, y, z)] >>> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return 0;
    return c.light[this.idx(x, y, z)] & 15;
  }

  setSky(x: number, y: number, z: number, v: number): void {
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return;
    const i = this.idx(x, y, z);
    c.light[i] = (c.light[i] & 15) | ((v & 15) << 4);
  }

  setBlockLight(x: number, y: number, z: number, v: number): void {
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return;
    const i = this.idx(x, y, z);
    c.light[i] = (c.light[i] & 0xf0) | (v & 15);
  }

  getBiome(x: number, z: number): number {
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return BIOME.plains;
    return c.biomes[(z & 15) * 16 + (x & 15)];
  }

  biomeNameAt(x: number, z: number): string {
    return BIOME_DATA[this.getBiome(x, z)]?.name ?? 'plains';
  }

  tintAt(x: number, z: number, mode: number, fixed: Float32Array | [number, number, number], ctx: 'vertex' | 'array' = 'array'): [number, number, number] {
    if (mode === 0) return [1, 1, 1];
    if (mode === 4) {
      return ctx === 'array' ? [fixed[0], fixed[1], fixed[2]] : [fixed[0], fixed[1], fixed[2]];
    }
    const b = this.getBiome(x, z) * 3;
    const arr = mode === 1 ? this.grassTint : mode === 2 ? this.foliageTint : this.waterTint;
    return [arr[b], arr[b + 1], arr[b + 2]];
  }

  private baseHeight(x: number, z: number): number {
    const cont = fbm2(x * 0.0016, z * 0.0016, 5, this.seed + 1);
    const hills = fbm2(x * 0.010, z * 0.010, 4, this.seed + 2);
    const rolling = fbm2(x * 0.021, z * 0.021, 3, this.seed + 7) - 0.5;
    const detail = fbm2(x * 0.045, z * 0.045, 2, this.seed + 3);
    const ridgeN = fbm2(x * 0.0042, z * 0.0042, 3, this.seed + 4) * 2 - 1;
    const ridge = 1 - Math.abs(ridgeN);
    let h = 50 + cont * 46 + hills * 10 + rolling * 8 + detail * 2.6;
    if (cont > 0.66) h += (cont - 0.66) * 110 * ridge;
    const d2 = x * x + z * z;
    h += 9 * Math.exp(-d2 / (210 * 210));
    return h;
  }

  /**
   * Signed distance to the lake shore, positive over water. The metric is
   * domain-warped and the radius is noise-driven, so the basin is an irregular
   * bowl with bays and points rather than a ring of concentric circles.
   */
  private lakeSigned(x: number, z: number): number {
    const seed = this.seed;
    const wx = x
      + (fbm2(x * 0.0055, z * 0.0055, 2, seed + 82) - 0.5) * 34
      + (fbm2(x * 0.021, z * 0.021, 1, seed + 88) - 0.5) * 12;
    const wz = z
      + (fbm2(x * 0.0055, z * 0.0055, 2, seed + 83) - 0.5) * 34
      + (fbm2(x * 0.021, z * 0.021, 1, seed + 89) - 0.5) * 12;
    let dx = wx - 58, dz = wz + 42;
    const skew = dx * 0.16;
    dz -= skew;
    const d = Math.hypot(dx * 0.88, dz * 1.04);
    const ang = Math.atan2(dz, dx);
    const lobes = Math.sin(ang * 2 + 1.7) * 5.5 + Math.sin(ang * 3 - 0.8) * 3.4 + Math.cos(ang * 5 + 0.4) * 2.2;
    const edge = 34 + lobes
      + (fbm2(x * 0.015, z * 0.015, 3, seed + 84) - 0.5) * 16
      + (fbm2(x * 0.055, z * 0.055, 2, seed + 85) - 0.5) * 6;
    return edge - d;
  }

  /**
   * Height of the lake basin: a sandy shelf and deeper middle below sea level,
   * then a bench and rolling banks above it that dissolve into the base terrain.
   */
  private terrainHeight(x: number, z: number, lakeS: number): number {
    const base = this.baseHeight(x, z);
    if (lakeS < -64) return base;
    const bankNoise = (fbm2(x * 0.023, z * 0.023, 3, this.seed + 86) - 0.5) * 2;
    const fineNoise = (fbm2(x * 0.075, z * 0.075, 2, this.seed + 87) - 0.5) * 2;
    if (lakeS >= 0) {
      const shelf = smoothstep(0, 7, lakeS);
      const deep = smoothstep(8, 28, lakeS);
      let depth = 1 + 2.4 * shelf + 6.4 * deep;
      const rough = (fbm2(x * 0.055, z * 0.055, 2, this.seed + 91) - 0.5) * 4.6;
      depth += bankNoise * 2.6 * smoothstep(3, 12, lakeS);
      depth += rough * smoothstep(2, 9, lakeS);
      depth += fineNoise * 0.75 * smoothstep(4, 14, lakeS);
      return SEA_LEVEL - Math.max(0.6, depth);
    }
    const out = -lakeS;
    const slopeNoise = (fbm2(x * 0.009, z * 0.009, 2, this.seed + 90) - 0.5);
    const slope = 0.26 + 0.16 * smoothstep(0, 34, out) + slopeNoise * 0.16;
    const bench = Math.min(out, 5) * 0.2;
    let h = SEA_LEVEL + bench + Math.max(0, out - 5) * slope;
    h += bankNoise * 4.0 * smoothstep(0, 18, out);
    h += fineNoise * 0.9 * smoothstep(1, 8, out);
    const blend = smoothstep(24, 56, out + bankNoise * 10);
    return h * (1 - blend) + base * blend;
  }

  private biomeAt(x: number, z: number, h: number): number {
    const t = fbm2(x * 0.0022, z * 0.0022, 3, this.seed + 11);
    const m = fbm2(x * 0.0022, z * 0.0022, 3, this.seed + 17);
    if (h < SEA_LEVEL - 2) return t < 0.24 ? BIOME.frozenOcean : BIOME.ocean;
    if (h <= SEA_LEVEL + 1) {
      if (h < SEA_LEVEL) return t < 0.24 ? BIOME.frozenOcean : BIOME.ocean;
      const shoreNoise = fbm2(x * 0.045, z * 0.045, 2, this.seed + 71);
      if (shoreNoise > 0.64) return t < 0.2 ? BIOME.snowy : BIOME.beach;
      if (t < 0.2) return BIOME.snowy;
      if (t > 0.74 && m < 0.42) return BIOME.desert;
      if (t < 0.32) return BIOME.taiga;
      if (m > 0.62) return BIOME.forest;
      return BIOME.plains;
    }
    if (h > 108) return BIOME.mountains;
    if (t < 0.2) return m > 0.5 ? BIOME.taiga : BIOME.snowy;
    if (t < 0.32) return BIOME.taiga;
    if (t > 0.74 && m < 0.42) return BIOME.desert;
    if (t > 0.66 && m < 0.55) return BIOME.savanna;
    if (m > 0.68 && h < SEA_LEVEL + 8 && t > 0.4) return BIOME.swamp;
    if (m > 0.62) return BIOME.forest;
    if (m > 0.5 && t < 0.62) return BIOME.birch;
    return BIOME.plains;
  }

  private isTreeBiome(biome: number): boolean {
    return biome === BIOME.forest || biome === BIOME.birch || biome === BIOME.taiga ||
      biome === BIOME.plains || biome === BIOME.savanna || biome === BIOME.swamp;
  }

  async generate(progress: (f: number, label: string) => void): Promise<void> {
    const total = this.gridSize * this.gridSize;
    let done = 0;
    for (let cx = this.originCX; cx < this.originCX + this.gridSize; cx++) {
      for (let cz = this.originCZ; cz < this.originCZ + this.gridSize; cz++) {
        this.generateChunk(cx, cz);
        done++;
        if (done % 8 === 0) {
          progress(0.72 + 0.14 * (done / total), `Generating terrain ${done}/${total}`);
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
    progress(0.865, 'Building structures');
    await new Promise(r => setTimeout(r, 0));
    this.structureSites.push(...generateStructures(this));
    progress(0.87, 'Lighting the world');
    await new Promise(r => setTimeout(r, 0));
    this.computeLighting();
    progress(0.93, 'Placing features');
  }

  private generateChunk(cx: number, cz: number): void {
    const c = this.createChunk(cx, cz);
    if (c.generated) return;
    c.generated = true;
    const baseX = cx * 16, baseZ = cz * 16;
    const { blocks, biomes, heights } = c;
    const ids = this.ids;
    const lake = new Float32Array(256);

    // First pass: terrain shape and biome, so slopes can be read by the material pass.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = baseX + lx, z = baseZ + lz;
        const ci = lz * 16 + lx;
        const ls = this.lakeSigned(x, z);
        const h = Math.floor(this.terrainHeight(x, z, ls));
        lake[ci] = ls;
        heights[ci] = h;
        biomes[ci] = this.biomeAt(x, z, h);
      }
    }

    // Second pass: blocks and surface materials.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = baseX + lx, z = baseZ + lz;
        const ci = lz * 16 + lx;
        const h = heights[ci];
        const biome = biomes[ci];
        const ls = lake[ci];
        const snowy = biome === BIOME.snowy || biome === BIOME.frozenOcean;
        const desert = biome === BIOME.desert;
        const beach = biome === BIOME.beach;
        const ocean = biome === BIOME.ocean || biome === BIOME.frozenOcean;
        const mountain = biome === BIOME.mountains;
        const nearLake = ls > -16;

        let slope = 0;
        if (lx > 0) slope = Math.max(slope, Math.abs(h - heights[ci - 1]));
        if (lx < 15) slope = Math.max(slope, Math.abs(h - heights[ci + 1]));
        if (lz > 0) slope = Math.max(slope, Math.abs(h - heights[ci - 16]));
        if (lz < 15) slope = Math.max(slope, Math.abs(h - heights[ci + 16]));

        let top = ids.grass_block;
        let filler = ids.dirt;
        if (desert) { top = ids.sand; filler = ids.sand; }
        else if (beach || ocean) {
          top = (h > 48 || h < 40) ? ids.sand : ids.gravel;
          filler = ids.sand;
          if (nearLake && h < SEA_LEVEL) {
            const sed = fbm2(x * 0.055, z * 0.055, 2, this.seed + 93);
            if (sed > 0.60) top = ids.gravel;
            else if (h < SEA_LEVEL - 4 && sed < 0.28) top = ids.clay;
          }
        }
        else if (snowy) { top = ids.snow_block; filler = ids.dirt; }
        else if (mountain) { top = h > 112 ? ids.snow_block : ids.stone; filler = ids.stone; }
        else if (biome === BIOME.swamp && h < SEA_LEVEL + 3) { top = ids.grass_block; filler = ids.dirt; }

        // Patchy beach tongue above the waterline, with gravel bars.
        if (!desert && !snowy && !mountain && nearLake && h >= SEA_LEVEL && h <= SEA_LEVEL + 2) {
          const patch = fbm2(x * 0.075, z * 0.075, 2, this.seed + 94);
          if (h === SEA_LEVEL || (h === SEA_LEVEL + 1 && patch > 0.66) || (h === SEA_LEVEL + 2 && patch > 0.8)) {
            top = patch > 0.74 ? ids.gravel : ids.sand;
            filler = ids.sand;
          } else {
            top = ids.grass_block;
            filler = ids.dirt;
          }
        }
        // Occasional rocky outcrops on steeper grass banks.
        if (!desert && !snowy && !mountain && h > SEA_LEVEL + 2 && slope >= 1) {
          const outcrop = fbm2(x * 0.06, z * 0.06, 2, this.seed + 105);
          const roll = hash2i(x, z, this.seed + 106);
          if ((slope >= 2 && outcrop > 0.53 && roll < 0.5) || (outcrop > 0.72 && roll < 0.22)) {
            top = ids.stone;
            filler = ids.stone;
          }
        }

        const maxY = Math.max(h, SEA_LEVEL);
        for (let y = WORLD_MIN_Y; y <= maxY; y++) {
          if (y < WORLD_MIN_Y + 2 + ((hash3i(x, y, z, this.seed + 5) * 2) | 0)) {
            blocks[this.idx(x, y, z)] = ids.bedrock;
            continue;
          }
          if (y <= h) {
            let id = ids.stone;
            if (y < -8) id = ids.deepslate;
            if (y > h - 4) {
              if (y === h) id = top;
              else id = filler;
            }
            if (y < h - 4 && y < 0 && y > h - 30) {
              const r = hash3i(x, y, z, this.seed + 23);
              if (r < 0.012) id = ids.coal_ore;
              else if (r < 0.019) id = ids.iron_ore;
              else if (r < 0.023) id = ids.copper_ore;
              else if (r < 0.0242) id = ids.diamond_ore;
            }
            if (desert && y > h - 5) id = y === h ? ids.sand : ids.sandstone;
            blocks[this.idx(x, y, z)] = id;
          } else {
            let fluid = ids.water;
            if (snowy && y === SEA_LEVEL) fluid = ids.ice;
            blocks[this.idx(x, y, z)] = fluid;
          }
        }
        if (snowy && h >= SEA_LEVEL && h < 100) {
          const sy = h + 1;
          if (sy < WORLD_MAX_Y) blocks[this.idx(x, sy, z)] = ids.snow;
        }
        if (mountain && h > 112) {
          const sy = h + 1;
          if (sy < WORLD_MAX_Y) blocks[this.idx(x, sy, z)] = ids.snow;
        }
      }
    }

    // Boulders before trees so a rock spot is not also used for a trunk.
    for (let lz = 1; lz < 15; lz++) {
      for (let lx = 1; lx < 15; lx++) {
        const ci = lz * 16 + lx;
        this.placeBoulders(c, baseX + lx, baseZ + lz, heights[ci], lake[ci], biomes[ci]);
      }
    }

    // Trees. Kept away from chunk borders so canopies stay inside; thinned near the shore.
    const treeSpots: [number, number][] = [];
    for (let lz = 3; lz < 13; lz++) {
      for (let lx = 3; lx < 13; lx++) {
        const x = baseX + lx, z = baseZ + lz;
        const ci = lz * 16 + lx;
        const h = heights[ci];
        if (h < SEA_LEVEL) continue;
        const biome = biomes[ci];
        const ground = this.getBlock(x, h, z);
        if (ground !== ids.grass_block) continue;
        if (this.getBlock(x, h + 1, z) !== 0) continue;
        const rnd = hash2i(x, z, this.seed + 41);
        if (!this.isTreeBiome(biome)) continue;
        let chance = this.treeChance(biome);
        if (lake[ci] > -12) chance *= 0.3;
        else if (lake[ci] > -24) chance *= 0.65;
        if (rnd >= chance) continue;
        if (treeSpots.some(([tx, tz]) => (tx - x) * (tx - x) + (tz - z) * (tz - z) < 12)) continue;
        treeSpots.push([x, z]);
        this.placeTree(c, x, h + 1, z, biome, hash2i(x, z, this.seed + 43));
      }
    }

    // Cacti and ground cover, across the whole chunk (plants never cross borders).
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = baseX + lx, z = baseZ + lz;
        const ci = lz * 16 + lx;
        const h = heights[ci];
        const biome = biomes[ci];
        if (biome === BIOME.desert) {
          if (this.getBlock(x, h, z) === ids.sand && this.getBlock(x, h + 1, z) === 0 &&
            hash2i(x, z, this.seed + 47) < 0.018) {
            this.placeCactus(c, x, h + 1, z, hash2i(x, z, this.seed + 47));
          }
        }
        this.placeVegetation(c, x, z, h, biome, lake[ci]);
      }
    }
  }

  private placeBoulders(c: Chunk, x: number, z: number, h: number, lakeS: number, biome: number): void {
    if (biome === BIOME.ocean || biome === BIOME.frozenOcean || biome === BIOME.desert ||
      biome === BIOME.beach || biome === BIOME.snowy) return;
    if (h < SEA_LEVEL + 1 || h > 105) return;
    const ids = this.ids;
    if (this.getBlock(x, h, z) !== ids.grass_block) return;
    if (this.getBlock(x, h + 1, z) !== 0) return;
    const chance = lakeS > -24 ? 0.004 : 0.002;
    if (hash2i(x, z, this.seed + 111) >= chance) return;
    const lx = x & 15, lz = z & 15;
    if (lx < 1 || lx > 14 || lz < 1 || lz > 14) return;

    const size = 1 + ((hash2i(x, z, this.seed + 112) * 3) | 0); // 1-3 extra blocks
    const mossy = hash2i(x, z, this.seed + 113) < 0.4;
    const spots: [number, number][] = [[0, 0]];
    if (size >= 2) spots.push(hash2i(x, z, this.seed + 114) < 0.5 ? [1, 0] : [0, 1]);
    if (size >= 3) spots.push(hash2i(x, z, this.seed + 115) < 0.5 ? [-1, 0] : [0, -1]);
    for (let i = 0; i < spots.length; i++) {
      const nx = x + spots[i][0], nz = z + spots[i][1];
      if (nx < 0 || nz < 0) continue;
      const nlx = nx & 15, nlz = nz & 15;
      if (nlx < 0 || nlz < 0) continue;
      const nh = c.heights[nlz * 16 + nlx];
      if (Math.abs(nh - h) > 1) continue;
      if (c.blocks[this.idx(nx, nh, nz)] !== ids.grass_block) continue;
      if (c.blocks[this.idx(nx, nh + 1, nz)] !== 0) continue;
      const block = (i === 0 ? mossy : hash2i(nx, nz, this.seed + 116) < 0.35)
        ? ids.mossy_cobblestone : ids.stone;
      this.setLocal(c, nx, nh + 1, nz, block, true);
      if (i === 0 && size >= 3) this.setLocal(c, nx, nh + 2, nz, block, true);
    }
  }

  private placeVegetation(c: Chunk, x: number, z: number, h: number, biome: number, lakeS: number): void {
    if (h < SEA_LEVEL || this.getBlock(x, h + 1, z) !== 0) return;
    const ids = this.ids;
    const ground = this.getBlock(x, h, z);
    if (ground === ids.sand || ground === ids.red_sand) {
      const deadChance = biome === BIOME.desert ? 0.006 : (lakeS > -18 ? 0.006 : 0);
      if (deadChance > 0 && hash2i(x, z, this.seed + 120) < deadChance) {
        this.setIfAir(c, x, h + 1, z, ids.dead_bush);
      }
      return;
    }
    if (ground !== ids.grass_block) return;
    if (biome === BIOME.snowy || biome === BIOME.frozenOcean || biome === BIOME.desert ||
      biome === BIOME.mountains) return;

    const patch = fbm2(x * 0.047, z * 0.047, 2, this.seed + 93);
    const forest = biome === BIOME.forest || biome === BIOME.birch;
    const taiga = biome === BIOME.taiga;
    const swamp = biome === BIOME.swamp;
    const plains = biome === BIOME.plains || biome === BIOME.beach;
    const savanna = biome === BIOME.savanna;

    // Compact flower clusters: a deterministic centre per 7x7 cell, one species per cluster.
    const cellX = Math.floor(x / 7), cellZ = Math.floor(z / 7);
    const clusterChance = forest ? 0.13 : plains ? 0.09 : savanna ? 0.035 : swamp ? 0.02 : taiga ? 0.012 : 0;
    if (clusterChance > 0 && hash2i(cellX, cellZ, this.seed + 96) < clusterChance) {
      const cx = cellX * 7 + 2 + ((hash2i(cellX, cellZ, this.seed + 97) * 3) | 0);
      const cz = cellZ * 7 + 2 + ((hash2i(cellX, cellZ, this.seed + 98) * 3) | 0);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz <= 4 && hash2i(x, z, this.seed + 99) < 0.55) {
        const flower = this.flowerIds[(hash2i(cellX, cellZ, this.seed + 100) * this.flowerIds.length) | 0];
        this.setIfAir(c, x, h + 1, z, flower);
        return;
      }
    }

    let fernChance = 0;
    if (forest) fernChance = 0.012 + (patch > 0.5 ? 0.025 : 0);
    else if (taiga) fernChance = 0.045;
    else if (swamp) fernChance = 0.03;
    else if (plains) fernChance = 0.004;
    if (fernChance > 0 && hash2i(x, z, this.seed + 121) < fernChance) {
      this.setIfAir(c, x, h + 1, z, ids.fern);
      return;
    }

    let grassChance = 0;
    if (forest) grassChance = patch > 0.42 ? 0.4 : 0.06;
    else if (plains) grassChance = patch > 0.46 ? 0.34 : 0.04;
    else if (taiga) grassChance = patch > 0.4 ? 0.26 : 0.05;
    else if (savanna) grassChance = patch > 0.5 ? 0.22 : 0.03;
    else if (swamp) grassChance = patch > 0.38 ? 0.36 : 0.1;
    if (hash2i(x, z, this.seed + 53) < grassChance) {
      this.setIfAir(c, x, h + 1, z, ids.short_grass);
    }
  }

  private treeChance(biome: number): number {
    if (biome === BIOME.forest) return 0.035;
    if (biome === BIOME.birch) return 0.03;
    if (biome === BIOME.taiga) return 0.04;
    if (biome === BIOME.swamp) return 0.015;
    if (biome === BIOME.savanna) return 0.004;
    return 0.006;
  }

  private setLocal(c: Chunk, x: number, y: number, z: number, id: number, overwrite = false): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const lx = x & 15, lz = z & 15;
    const i = this.idx(x, y, z);
    if (!overwrite && c.blocks[i] !== 0) return;
    c.blocks[i] = id;
  }

  private setIfAir(c: Chunk, x: number, y: number, z: number, id: number): void {
    this.setLocal(c, x, y, z, id, false);
  }

  private placeTree(c: Chunk, x: number, y: number, z: number, biome: number, rnd: number): void {
    const ids = this.ids;
    let log = ids.oak_log, leaves = ids.oak_leaves;
    let height = 4;
    const spruce = biome === BIOME.taiga;
    const birch = biome === BIOME.birch;
    if (birch) { log = ids.birch_log; leaves = ids.birch_leaves; height = 5 + ((rnd * 3) | 0); }
    else if (spruce) { log = ids.spruce_log; leaves = ids.spruce_leaves; height = 7 + ((rnd * 3) | 0); }
    else { height = 4 + ((rnd * 3) | 0); }
    if (this.getBlock(x, y + height, z) !== 0) return;
    for (let i = 0; i < height; i++) this.setLocal(c, x, y + i, z, log, true);
    const top = y + height - 1;

    if (spruce) {
      // Conical, layered spruce with alternating branch tips and a spire.
      for (let ly = top; ly >= y + 2; ly--) {
        const d = top - ly;
        let r = d <= 1 ? 1 : d <= 4 ? 2 : 3;
        if (height < 9) r = Math.min(r, 2);
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
            if (dx === 0 && dz === 0 && ly <= top) continue;
            this.setIfAir(c, x + dx, ly, z + dz, leaves);
          }
        }
        if (d >= 1 && d <= 4 && (d & 1) === 1) {
          const t = r + 1;
          this.setIfAir(c, x + t, ly, z, leaves);
          this.setIfAir(c, x - t, ly, z, leaves);
          this.setIfAir(c, x, ly, z + t, leaves);
          this.setIfAir(c, x, ly, z - t, leaves);
        }
      }
      this.setIfAir(c, x, top + 1, z, leaves);
      return;
    }

    // Oak and birch: two broad 5x5 layers, then two 3x3 layers with a plus-shaped cap.
    for (let ly = top - 2; ly <= top + 1; ly++) {
      const layer = top + 1 - ly; // 0 = top cap, 3 = lowest 5x5 layer
      const r = layer <= 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && ly <= top) continue;
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner) {
            const roll = hash3i(x + dx, ly, z + dz, this.seed + 61);
            if (r === 2 && roll < (birch ? 0.55 : 0.3)) continue;
            if (r === 1 && roll < 0.5) continue;
          }
          this.setIfAir(c, x + dx, ly, z + dz, leaves);
        }
      }
    }
    // Small diagonal lobes on the upper layer widen the crown without making a flat disc.
    const lobeChance = birch ? 0.3 : 0.55;
    for (const [dx, dz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) {
      if (hash3i(x + dx, top, z + dz, this.seed + 62) < lobeChance) {
        this.setIfAir(c, x + dx, top, z + dz, leaves);
      }
    }
    this.setIfAir(c, x, top + 2, z, leaves);
  }

  private placeCactus(c: Chunk, x: number, y: number, z: number, rnd: number): void {
    const height = 1 + ((rnd * 3) | 0);
    for (let i = 0; i < height; i++) this.setLocal(c, x, y + i, z, this.ids.cactus, true);
  }

  // ---------------- lighting ----------------

  private pack(x: number, y: number, z: number): number {
    const lx = x - this.minWorldX;
    const lz = z - this.minWorldZ;
    const ly = y - WORLD_MIN_Y;
    return (lx & 511) | ((lz & 511) << Z_SHIFT) | ((ly & 511) << Y_SHIFT);
  }
  private unpackX(p: number) { return (p & 511) + this.minWorldX; }
  private unpackZ(p: number) { return ((p >> Z_SHIFT) & 511) + this.minWorldZ; }
  private unpackY(p: number) { return ((p >> Y_SHIFT) & 511) + WORLD_MIN_Y; }

  private computeLighting(): void {
    // 1. Column skylight
    for (const c of this.chunks.values()) {
      const { blocks, light, heights } = c;
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
          let sky = 15;
          for (let y = WORLD_MAX_Y - 1; y >= WORLD_MIN_Y; y--) {
            const i = this.idx(x, y, z);
            const def = this.rocks.get(blocks[i]);
            if (def.flags && def.flags.opaque) {
              sky = 0;
              light[i] = 0;
              continue;
            }
            light[i] = (sky << 4) | (light[i] & 15);
            if (def.flags && def.flags.lightOpacity > 0) sky = Math.max(0, sky - def.flags.lightOpacity);
          }
        }
      }
    }
    // 2. Skylight flood fill near the surface
    this.skyQueue.clear();
    for (const c of this.chunks.values()) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
          const h = c.heights[lz * 16 + lx];
          const y0 = Math.max(WORLD_MIN_Y, Math.min(h, SEA_LEVEL) - 20);
          const y1 = Math.min(WORLD_MAX_Y - 1, Math.max(h, SEA_LEVEL) + 14);
          for (let y = y0; y <= y1; y++) {
            if ((c.light[this.idx(x, y, z)] >>> 4) > 0) this.skyQueue.push(this.pack(x, y, z));
          }
        }
      }
    }
    this.floodSky();

    // 3. Block light
    this.blockQueue.clear();
    for (const c of this.chunks.values()) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
          for (let y = WORLD_MIN_Y; y < WORLD_MAX_Y; y++) {
            const i = this.idx(x, y, z);
            const em = this.rocks.emission[c.blocks[i]];
            if (em > 0) {
              c.light[i] = (c.light[i] & 0xf0) | em;
              this.blockQueue.push(this.pack(x, y, z));
            }
          }
        }
      }
    }
    this.floodBlock();
  }

  private floodSky(): void {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (this.skyQueue.length) {
      const p = this.skyQueue.pop();
      const x = this.unpackX(p), y = this.unpackY(p), z = this.unpackZ(p);
      const level = this.getSky(x, y, z);
      if (level <= 0) continue;
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (nx < this.minWorldX || nx > this.maxWorldX || nz < this.minWorldZ || nz > this.maxWorldZ) continue;
        const c = this.chunkAt(nx >> 4, nz >> 4);
        if (!c) continue;
        const id = c.blocks[this.idx(nx, ny, nz)];
        const def = this.rocks.get(id);
        if (def.flags && def.flags.opaque) continue;
        let atten = Math.max(1, def.flags?.lightOpacity ?? 0);
        if (dy === -1 && level === 15 && (def.flags?.lightOpacity ?? 0) === 0) atten = 0;
        const nl = level - atten;
        if (nl > this.getSky(nx, ny, nz)) {
          this.setSky(nx, ny, nz, nl);
          this.skyQueue.push(this.pack(nx, ny, nz));
        }
      }
    }
  }

  private floodBlock(): void {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (this.blockQueue.length) {
      const p = this.blockQueue.pop();
      const x = this.unpackX(p), y = this.unpackY(p), z = this.unpackZ(p);
      const level = this.getBlockLight(x, y, z);
      if (level <= 1) continue;
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (nx < this.minWorldX || nx > this.maxWorldX || nz < this.minWorldZ || nz > this.maxWorldZ) continue;
        const c = this.chunkAt(nx >> 4, nz >> 4);
        if (!c) continue;
        const id = c.blocks[this.idx(nx, ny, nz)];
        const def = this.rocks.get(id);
        if (def.flags && def.flags.opaque) continue;
        const atten = Math.max(1, def.flags?.lightOpacity ?? 0);
        const nl = level - atten;
        if (nl > this.getBlockLight(nx, ny, nz)) {
          this.setBlockLight(nx, ny, nz, nl);
          this.blockQueue.push(this.pack(nx, ny, nz));
        }
      }
    }
  }

  relightAround(x: number, y: number, z: number, radius = 20): void {
    const x0 = Math.max(this.minWorldX, x - radius), x1 = Math.min(this.maxWorldX, x + radius);
    const z0 = Math.max(this.minWorldZ, z - radius), z1 = Math.min(this.maxWorldZ, z + radius);
    const y0 = Math.max(WORLD_MIN_Y, y - radius), y1 = Math.min(WORLD_MAX_Y - 1, y + radius);
    // Reset light in the box, then recompute skylight columns and flood from the box boundary and emitters.
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        const c = this.chunkAt(xx >> 4, zz >> 4);
        if (!c) continue;
        for (let yy = y0; yy <= y1; yy++) {
          const i = this.idx(xx, yy, zz);
          c.light[i] = 0;
        }
      }
    }
    this.skyQueue.clear();
    this.blockQueue.clear();
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        let sky = y1 + 1 < WORLD_MAX_Y ? this.getSky(xx, y1 + 1, zz) : 15;
        for (let yy = y1; yy >= y0; yy--) {
          const c = this.chunkAt(xx >> 4, zz >> 4);
          if (!c) break;
          const i = this.idx(xx, yy, zz);
          const def = this.rocks.get(c.blocks[i]);
          if (def.flags && def.flags.opaque) { sky = 0; continue; }
          c.light[i] = (sky << 4) | (c.light[i] & 15);
          if (def.flags && def.flags.lightOpacity > 0) sky = Math.max(0, sky - def.flags.lightOpacity);
          if (sky > 0) this.skyQueue.push(this.pack(xx, yy, zz));
        }
      }
    }
    // Boundary seeds from outside the box.
    for (let zz = z0; zz <= z1; zz++) {
      for (let yy = y0; yy <= y1; yy++) {
        for (const xx of [x0 - 1, x1 + 1]) {
          if (xx < this.minWorldX || xx > this.maxWorldX) continue;
          const s = this.getSky(xx, yy, zz); if (s > 0) this.skyQueue.push(this.pack(xx, yy, zz));
          const b = this.getBlockLight(xx, yy, zz); if (b > 0) this.blockQueue.push(this.pack(xx, yy, zz));
        }
      }
    }
    for (let xx = x0; xx <= x1; xx++) {
      for (let yy = y0; yy <= y1; yy++) {
        for (const zz of [z0 - 1, z1 + 1]) {
          if (zz < this.minWorldZ || zz > this.maxWorldZ) continue;
          const s = this.getSky(xx, yy, zz); if (s > 0) this.skyQueue.push(this.pack(xx, yy, zz));
          const b = this.getBlockLight(xx, yy, zz); if (b > 0) this.blockQueue.push(this.pack(xx, yy, zz));
        }
      }
    }
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        for (const yy of [y0 - 1, y1 + 1]) {
          if (yy < WORLD_MIN_Y || yy >= WORLD_MAX_Y) continue;
          const s = this.getSky(xx, yy, zz); if (s > 0) this.skyQueue.push(this.pack(xx, yy, zz));
          const b = this.getBlockLight(xx, yy, zz); if (b > 0) this.blockQueue.push(this.pack(xx, yy, zz));
        }
      }
    }
    // Emitters inside the box.
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        const c = this.chunkAt(xx >> 4, zz >> 4);
        if (!c) continue;
        for (let yy = y0; yy <= y1; yy++) {
          const em = this.rocks.emission[c.blocks[this.idx(xx, yy, zz)]];
          if (em > 0) {
            this.setBlockLight(xx, yy, zz, em);
            this.blockQueue.push(this.pack(xx, yy, zz));
          }
        }
      }
    }
    this.floodSkyBox(x0, x1, y0, y1, z0, z1);
    this.floodBlockBox(x0, x1, y0, y1, z0, z1);
  }

  private floodSkyBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (this.skyQueue.length) {
      const p = this.skyQueue.pop();
      const x = this.unpackX(p), y = this.unpackY(p), z = this.unpackZ(p);
      const level = this.getSky(x, y, z);
      if (level <= 0) continue;
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || nz < z0 || nz > z1) continue;
        const c = this.chunkAt(nx >> 4, nz >> 4);
        if (!c) continue;
        const def = this.rocks.get(c.blocks[this.idx(nx, ny, nz)]);
        if (def.flags && def.flags.opaque) continue;
        let atten = Math.max(1, def.flags?.lightOpacity ?? 0);
        if (dy === -1 && level === 15 && (def.flags?.lightOpacity ?? 0) === 0) atten = 0;
        const nl = level - atten;
        if (nl > this.getSky(nx, ny, nz)) {
          this.setSky(nx, ny, nz, nl);
          this.skyQueue.push(this.pack(nx, ny, nz));
        }
      }
    }
  }

  private floodBlockBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (this.blockQueue.length) {
      const p = this.blockQueue.pop();
      const x = this.unpackX(p), y = this.unpackY(p), z = this.unpackZ(p);
      const level = this.getBlockLight(x, y, z);
      if (level <= 1) continue;
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || nz < z0 || nz > z1) continue;
        const c = this.chunkAt(nx >> 4, nz >> 4);
        if (!c) continue;
        const def = this.rocks.get(c.blocks[this.idx(nx, ny, nz)]);
        if (def.flags && def.flags.opaque) continue;
        const atten = Math.max(1, def.flags?.lightOpacity ?? 0);
        const nl = level - atten;
        if (nl > this.getBlockLight(nx, ny, nz)) {
          this.setBlockLight(nx, ny, nz, nl);
          this.blockQueue.push(this.pack(nx, ny, nz));
        }
      }
    }
  }

  findSpawn(): { x: number, y: number, z: number, yaw: number } {
    const coast = this.findCoastSpawn();
    if (coast) return coast;
    let best: { x: number, y: number, z: number } | null = null;
    let bestScore = -1e9;
    for (let r = 0; r <= 88; r += 4) {
      const steps = r === 0 ? 1 : Math.min(72, Math.max(16, Math.round(r * 1.2)));
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r);
        const z = Math.round(Math.sin(ang) * r);
        const c = this.chunkAt(x >> 4, z >> 4);
        if (!c) continue;
        const h = c.heights[(z & 15) * 16 + (x & 15)];
        const biome = this.getBiome(x, z);
        const minH = biome === BIOME.beach ? SEA_LEVEL : SEA_LEVEL + 2;
        if (h < minH || h > 132) continue;
        const top = this.getBlock(x, h, z);
        if (top !== this.ids.grass_block && top !== this.ids.sand) continue;
        if (biome === BIOME.ocean || biome === BIOME.frozenOcean || biome === BIOME.mountains) continue;
        let clear = true;
        for (let dy = 1; dy <= 5; dy++) {
          const above = this.getBlock(x, h + dy, z);
          if (above !== 0 && this.rocks.solid[above]) { clear = false; break; }
        }
        if (!clear) continue;
        let trees = 0;
        for (let dz = -4; dz <= 4; dz++) {
          for (let dx = -4; dx <= 4; dx++) {
            for (let dy = 1; dy <= 14; dy++) {
              const id = this.getBlock(x + dx, h + dy, z + dz);
              if (this.isLeaves(id)) trees++;
            }
          }
        }
        if (trees > 24) continue;
        let water = 0;
        for (let k = 0; k < 16; k++) {
          const aa = (k / 16) * Math.PI * 2;
          for (let d = 8; d <= 40; d += 4) {
            if (this.getBlock(Math.round(x + Math.cos(aa) * d), SEA_LEVEL, Math.round(z + Math.sin(aa) * d)) === this.ids.water) water++;
          }
        }
        let open = 0;
        for (let k = 0; k < 8; k++) {
          const aa = (k / 8) * Math.PI * 2;
          const cc = this.chunkAt((x + Math.round(Math.cos(aa) * 24)) >> 4, (z + Math.round(Math.sin(aa) * 24)) >> 4);
          if (!cc) continue;
          const hh = cc.heights[((z + Math.round(Math.sin(aa) * 24)) & 15) * 16 + ((x + Math.round(Math.cos(aa) * 24)) & 15)];
          if (hh < h + 6) open++;
        }
        const biomeScore = biome === BIOME.beach ? 20 : biome === BIOME.plains ? 6.5 : biome === BIOME.savanna ? 4.5 : biome === BIOME.birch ? 1 : 0;
        const score = biomeScore + Math.min(7, water * 0.18) + open * 0.22 - trees * 0.12 - Math.abs(h - 70) * 0.035;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y: h + 1, z };
        }
      }
    }
    if (!best) best = { x: 8, y: 100, z: 8 };
    const yaw = this.suggestYaw(best.x, best.z);
    this.setViewDirection(yaw);
    this.clearViewCorridor(best.x, best.y, best.z, yaw);
    return { ...best, yaw };
  }

  private heightOfColumn(x: number, z: number): number {
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return 0;
    return c.heights[(z & 15) * 16 + (x & 15)];
  }

  private setViewDirection(yaw: number): void {
    this.viewX = -Math.sin(yaw);
    this.viewZ = Math.cos(yaw);
  }

  /**
   * Removes only the trees that intersect the narrow wedge between the spawn
   * eye and the water, leaving the shore vegetation on both sides intact.
   */
  private clearViewCorridor(sx: number, sy: number, sz: number, yaw: number): void {
    const fx = -Math.sin(yaw), fz = Math.cos(yaw);
    const roots = new Map<string, [number, number, number]>();
    for (let d = 2; d <= 14; d++) {
      const cx = sx + fx * d, cz = sz + fz * d;
      for (let o = -2; o <= 2; o++) {
        const x = Math.round(cx - fz * o);
        const z = Math.round(cz + fx * o);
        for (let y = sy - 2; y <= sy + 10; y++) {
          if (!this.isLog(this.getBlock(x, y, z))) continue;
          let by = y;
          while (by > sy - 10 && this.isLog(this.getBlock(x, by - 1, z))) by--;
          roots.set(`${x},${by},${z}`, [x, by, z]);
        }
      }
    }
    for (const [bx, by, bz] of roots.values()) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let y = by; y <= by + 10; y++) {
            const id = this.getBlock(bx + dx, y, bz + dz);
            if (this.isTreeBlock(id)) this.setBlock(bx + dx, y, bz + dz, 0);
          }
        }
      }
    }
  }

  private findCoastSpawn(): { x: number, y: number, z: number, yaw: number } | null {
    const waters: [number, number][] = [];
    for (const c of this.chunks.values()) {
      for (let lz = 0; lz < 16; lz += 3) {
        for (let lx = 0; lx < 16; lx += 3) {
          const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
          if (this.getBlock(x, SEA_LEVEL, z) === this.ids.water && this.getBlock(x, SEA_LEVEL + 1, z) === 0) {
            waters.push([x, z]);
          }
        }
      }
    }
    if (!waters.length) return null;
    let sumX = 0, sumZ = 0;
    for (const [wx, wz] of waters) { sumX += wx; sumZ += wz; }
    const waterCenterX = sumX / waters.length, waterCenterZ = sumZ / waters.length;
    type Coast = { x: number, z: number, y: number, yaw: number, score: number };
    let best: Coast | null = null;
    for (let wi = 0; wi < waters.length; wi += 5) {
      const [wx, wz] = waters[wi];
      for (let r = 6; r <= 26; r += 2) {
        const steps = Math.max(12, r * 2);
        for (let a = 0; a < steps; a++) {
          const ang = (a / steps) * Math.PI * 2;
          const x = Math.round(wx + Math.cos(ang) * r);
          const z = Math.round(wz + Math.sin(ang) * r);
          if (Math.abs(x) > 90 || Math.abs(z) > 90) continue;
          const c = this.chunkAt(x >> 4, z >> 4);
          if (!c) continue;
          const h = c.heights[(z & 15) * 16 + (x & 15)];
          if (h < SEA_LEVEL || h > SEA_LEVEL + 34) continue;
          const top = this.getBlock(x, h, z);
          if (top !== this.ids.grass_block && top !== this.ids.sand) continue;
          const biome = this.getBiome(x, z);
          if (biome === BIOME.ocean || biome === BIOME.frozenOcean || biome === BIOME.mountains) continue;
          let clear = true;
          for (let dy = 1; dy <= 5; dy++) {
            const above = this.getBlock(x, h + dy, z);
            if (above !== 0 && this.rocks.solid[above]) { clear = false; break; }
          }
          if (!clear) continue;
          const toWaterX = waterCenterX - x, toWaterZ = waterCenterZ - z;
          const toWaterLen = Math.hypot(toWaterX, toWaterZ) || 1;
          const fwdX = toWaterX / toWaterLen, fwdZ = toWaterZ / toWaterLen;
          // Require a lenient downhill sight line toward the lake centre.
          let blocked = false;
          for (let t = 3; t <= 18; t += 3) {
            if (this.heightOfColumn(Math.round(x + fwdX * t), Math.round(z + fwdZ * t)) > h + 2) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
          let trees = 0;
          for (let dz = -3; dz <= 3; dz++) {
            for (let dx = -3; dx <= 3; dx++) {
              for (let dy = 1; dy <= 10; dy++) {
                const id = this.getBlock(x + dx, h + dy, z + dz);
                if (this.isLeaves(id)) trees++;
              }
            }
          }
          if (trees > 14) continue;
          let vistaTrees = 0;
          for (let t = 4; t <= 12; t += 2) {
            for (let o = -2; o <= 2; o += 2) {
              const px = Math.round(x + fwdX * t - fwdZ * o);
              const pz = Math.round(z + fwdZ * t + fwdX * o);
              for (let dy = 1; dy <= 9; dy++) {
                if (this.isTreeBlock(this.getBlock(px, h + dy, pz))) vistaTrees++;
              }
            }
          }
          const yaw = Math.atan2(-toWaterX, toWaterZ);
          const grassBonus = top === this.ids.grass_block ? 7 : 0;
          const heightBonus = h >= SEA_LEVEL + 3 && h <= SEA_LEVEL + 13 ? 8 : h > SEA_LEVEL + 13 ? 4 : 1;
          const distBonus = r >= 7 && r <= 18 ? 6 : 2;
          const score = grassBonus + heightBonus + distBonus + (top === this.ids.sand ? 2 : 0)
            - trees * 0.25 - vistaTrees * 0.4;
          if (!best || score > best.score) best = { x, z, y: h + 1, yaw, score };
        }
      }
    }
    if (!best) return null;
    this.setViewDirection(best.yaw);
    this.clearViewCorridor(best.x, best.y, best.z, best.yaw);
    return { x: best.x, y: best.y, z: best.z, yaw: best.yaw };
  }

  sulfurSpot: { x: number, z: number } | null = null;

  private inViewCorridor(x: number, z: number, fromX: number, fromZ: number, maxDist: number): boolean {
    const dx = x - fromX, dz = z - fromZ;
    const d = Math.hypot(dx, dz);
    if (d < 2) return true;
    if (d > maxDist) return false;
    return (dx * this.viewX + dz * this.viewZ) / d > 0.94;
  }

  decorateSpawn(spawn: { x: number, y: number, z: number }): void {
    const ids = this.ids;
    this.sulfurSpot = null;
    let chosen: { x: number, z: number, hs: number[][] } | null = null;
    for (let r = 6; r <= 17 && !chosen; r += 1) {
      for (let a = 0; a < 48 && !chosen; a++) {
        const ang = (a / 48) * Math.PI * 2;
        const x = Math.round(spawn.x + Math.cos(ang) * r);
        const z = Math.round(spawn.z + Math.sin(ang) * r);
        // Keep the feature out of the lake vista, on the side or behind the player.
        if (this.inViewCorridor(x, z, spawn.x, spawn.z, 18)) continue;
        const dSpawn = Math.max(1, Math.hypot(x - spawn.x, z - spawn.z));
        const frontal = ((x - spawn.x) * this.viewX + (z - spawn.z) * this.viewZ) / dSpawn;
        if (dSpawn < 14 && frontal > 0.25) continue;
        const hs: number[][] = [];
        let minH = 999, maxH = -999;
        let ok = true;
        for (let dz = -1; dz <= 1; dz++) {
          const row: number[] = [];
          for (let dx = -1; dx <= 1; dx++) {
            const c = this.chunkAt((x + dx) >> 4, (z + dz) >> 4);
            if (!c) { ok = false; break; }
            const h = c.heights[((z + dz) & 15) * 16 + ((x + dx) & 15)];
            const top = this.getBlock(x + dx, h, z + dz);
            if (top !== ids.grass_block && top !== ids.sand && top !== ids.dirt) { ok = false; break; }
            const above = this.getBlock(x + dx, h + 1, z + dz);
            if (above !== 0 && this.rocks.solid[above]) { ok = false; break; }
            row.push(h);
            minH = Math.min(minH, h);
            maxH = Math.max(maxH, h);
          }
          if (!ok) break;
          hs.push(row);
        }
        if (!ok || maxH - minH > 1) continue;
        chosen = { x, z, hs };
      }
    }
    if (chosen) {
      this.sulfurSpot = { x: chosen.x, z: chosen.z };
      const palette = [ids.sulfur, ids.cinnabar, ids.polished_sulfur, ids.chiseled_sulfur, ids.polished_cinnabar, ids.chiseled_cinnabar];
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const h = chosen.hs[dz + 1][dx + 1];
          this.setBlock(chosen.x + dx, h, chosen.z + dz, palette[n % palette.length]);
          this.setBlock(chosen.x + dx, h + 1, chosen.z + dz, 0);
          n++;
        }
      }
      this.setBlock(chosen.x, chosen.hs[1][1] + 1, chosen.z, ids.sulfur_spike);
      this.setBlock(chosen.x + 1, chosen.hs[1][2] + 1, chosen.z, ids.sulfur_spike);
    }
    this.decorateSpawnVegetation(spawn);
    this.relightAround(spawn.x, spawn.y + 1, spawn.z, 20);
  }

  private decorateSpawnVegetation(spawn: { x: number, y: number, z: number }): void {
    const ids = this.ids;
    let deadBushes = 0;

    // Gentle scattering in a 21-block radius, thinning (not clearing) toward the vista.
    for (let dz = -20; dz <= 20; dz++) {
      for (let dx = -20; dx <= 20; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 < 4 || d2 > 400) continue;
        const x = spawn.x + dx, z = spawn.z + dz;
        const c = this.chunkAt(x >> 4, z >> 4);
        if (!c) continue;
        const h = c.heights[(z & 15) * 16 + (x & 15)];
        if (h < SEA_LEVEL || this.getBlock(x, h + 1, z) !== 0) continue;
        const ground = this.getBlock(x, h, z);
        const corridor = this.inViewCorridor(x, z, spawn.x, spawn.z, 18);
        const rnd = hash2i(x, z, this.seed + 131);
        if (ground === ids.sand || ground === ids.red_sand) {
          if (!corridor && deadBushes < 4 && rnd < 0.035) {
            this.setBlock(x, h + 1, z, ids.dead_bush);
            deadBushes++;
          }
          continue;
        }
        if (ground !== ids.grass_block) continue;
        const patch = fbm2(x * 0.05, z * 0.05, 2, this.seed + 132);
        if (!corridor && patch > 0.42 && rnd < 0.05) {
          this.setBlock(x, h + 1, z, ids.fern);
          continue;
        }
        if (rnd < (corridor ? 0.08 : 0.2) * (patch > 0.4 ? 1.2 : 0.6)) {
          this.setBlock(x, h + 1, z, ids.short_grass);
        }
      }
    }

    // A few guaranteed flower clumps on both flanks, each of one species.
    const baseAng = Math.atan2(this.viewZ, this.viewX);
    const clusterAngles = [0.62, -0.62, 1.05, -1.05, 2.4];
    for (let i = 0; i < clusterAngles.length; i++) {
      const ang = baseAng + clusterAngles[i] + (hash2i(i, 7, this.seed + 133) - 0.5) * 0.25;
      const dist = 7 + hash2i(i, 11, this.seed + 134) * 10;
      const cx = Math.round(spawn.x + Math.cos(ang) * dist);
      const cz = Math.round(spawn.z + Math.sin(ang) * dist);
      const flower = this.flowerIds[(hash2i(i, 13, this.seed + 135) * this.flowerIds.length) | 0];
      const count = 4 + ((hash2i(i, 17, this.seed + 136) * 4) | 0);
      let placed = 0;
      for (let k = 0; k < count; k++) {
        const ox = ((hash2i(i, k, this.seed + 137) * 5) | 0) - 2;
        const oz = ((hash2i(k, i, this.seed + 138) * 5) | 0) - 2;
        const x = cx + ox, z = cz + oz;
        if (this.inViewCorridor(x, z, spawn.x, spawn.z, 16)) continue;
        const c = this.chunkAt(x >> 4, z >> 4);
        if (!c) continue;
        const h = c.heights[(z & 15) * 16 + (x & 15)];
        if (h < SEA_LEVEL || this.getBlock(x, h, z) !== ids.grass_block || this.getBlock(x, h + 1, z) !== 0) continue;
        this.setBlock(x, h + 1, z, flower);
        placed++;
      }
      if (placed > 0) {
        // A little grass tuft or fern next to each clump keeps it from floating in a bare lawn.
        const tx = cx + 2, tz = cz + 1;
        const tc = this.chunkAt(tx >> 4, tz >> 4);
        if (tc) {
          const th = tc.heights[(tz & 15) * 16 + (tx & 15)];
          if (th >= SEA_LEVEL && this.getBlock(tx, th, tz) === ids.grass_block && this.getBlock(tx, th + 1, tz) === 0) {
            this.setBlock(tx, th + 1, tz, hash2i(tx, tz, this.seed + 139) < 0.5 ? ids.short_grass : ids.fern);
          }
        }
      }
    }

    // Two small mossy boulders at the sides for silhouette interest.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      for (let attempt = 0; attempt < 8; attempt++) {
        const ang = baseAng + side * (0.9 + hash2i(i, 23, this.seed + 140) * 0.4 + attempt * 0.12);
        const dist = 7 + hash2i(i, 29, this.seed + 141) * 5 + attempt;
        const x = Math.round(spawn.x + Math.cos(ang) * dist);
        const z = Math.round(spawn.z + Math.sin(ang) * dist);
        if (this.inViewCorridor(x, z, spawn.x, spawn.z, 18)) continue;
        if (this.placeSpawnBoulder(x, z, i + attempt)) break;
      }
    }

    // Two full-crowned trees frame the shore at the edge of the view without
    // entering the open wedge toward the water.
    for (const side of [-1, 1]) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const ang = baseAng + side * (1.1 + (hash2i(side + 2, attempt, this.seed + 150) - 0.5) * 0.2)
          + side * attempt * 0.09;
        const dist = 10 + hash2i(attempt, side + 5, this.seed + 151) * 6;
        const x = Math.round(spawn.x + Math.cos(ang) * dist);
        const z = Math.round(spawn.z + Math.sin(ang) * dist);
        const c = this.chunkAt(x >> 4, z >> 4);
        if (!c) continue;
        const lx = x & 15, lz = z & 15;
        if (lx < 3 || lx > 12 || lz < 3 || lz > 12) continue;
        const h = c.heights[lz * 16 + lx];
        if (h < SEA_LEVEL || this.getBlock(x, h, z) !== ids.grass_block || this.getBlock(x, h + 1, z) !== 0) continue;
        let blocked = false;
        for (let dz = -3; dz <= 3 && !blocked; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (this.inViewCorridor(x + dx, z + dz, spawn.x, spawn.z, 20)) { blocked = true; break; }
          }
        }
        if (blocked) continue;
        let crowded = false;
        for (let dz = -2; dz <= 2 && !crowded; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = 1; dy <= 8; dy++) {
              if (this.isLog(this.getBlock(x + dx, h + dy, z + dz))) { crowded = true; break; }
            }
          }
        }
        if (crowded) continue;
        let species = c.biomes[lz * 16 + lx];
        if (!this.isTreeBiome(species)) species = BIOME.forest;
        this.placeTree(c, x, h + 1, z, species, hash2i(x, z, this.seed + 152));
        break;
      }
    }
  }

  private placeSpawnBoulder(x: number, z: number, salt: number): boolean {
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c) return false;
    const h = c.heights[(z & 15) * 16 + (x & 15)];
    if (h < SEA_LEVEL || this.getBlock(x, h, z) !== this.ids.grass_block || this.getBlock(x, h + 1, z) !== 0) return false;
    const mossy = hash2i(x, z, this.seed + 142 + salt) < 0.5;
    const block = mossy ? this.ids.mossy_cobblestone : this.ids.stone;
    this.setBlock(x, h + 1, z, block);
    const nx = x + (hash2i(x, z, this.seed + 143 + salt) < 0.5 ? 1 : -1);
    const nc = this.chunkAt(nx >> 4, z >> 4);
    if (nc) {
      const nh = nc.heights[(z & 15) * 16 + (nx & 15)];
      if (Math.abs(nh - h) <= 1 && this.getBlock(nx, nh, z) === this.ids.grass_block && this.getBlock(nx, nh + 1, z) === 0) {
        this.setBlock(nx, nh + 1, z, hash2i(nx, z, this.seed + 144) < 0.5 ? this.ids.stone : block);
      }
    }
    if (hash2i(x, z, this.seed + 145 + salt) < 0.5) this.setBlock(x, h + 2, z, block);
    return true;
  }

  suggestYaw(x: number, z: number): number {
    let bestWater = -1, bestYaw = 0;
    for (let k = 0; k < 32; k++) {
      const ang = (k / 32) * Math.PI * 2;
      let water = 0;
      for (let d = 6; d <= 56; d += 4) {
        if (this.getBlock(Math.round(x + Math.cos(ang) * d), SEA_LEVEL, Math.round(z + Math.sin(ang) * d)) === this.ids.water) water++;
      }
      if (water > bestWater) { bestWater = water; bestYaw = Math.atan2(-Math.cos(ang), Math.sin(ang)); }
    }
    if (bestWater <= 0) {
      let bestH = 1e9;
      for (let k = 0; k < 32; k++) {
        const ang = (k / 32) * Math.PI * 2;
        const px = x + Math.round(Math.cos(ang) * 24), pz = z + Math.round(Math.sin(ang) * 24);
        const c = this.chunkAt(px >> 4, pz >> 4);
        if (!c) continue;
        const hh = c.heights[(pz & 15) * 16 + (px & 15)];
        if (hh < bestH) { bestH = hh; bestYaw = Math.atan2(-Math.cos(ang), Math.sin(ang)); }
      }
    }
    return bestYaw;
  }
}
