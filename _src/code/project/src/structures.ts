import type { World } from './world.js';

/**
 * Deterministic, vanilla-flavoured surface structures: a small oak village
 * near spawn (houses, workshop, well, watchtower) and a handful of scattered
 * ruins. Everything is built from blocks already present in the manifest.
 *
 * The generator runs after the terrain chunks exist but before computeLighting,
 * so torches and lanterns inside the structures light the world correctly.
 */

export interface StructureSite {
  type: string;
  x: number;
  z: number;
}

/** Kept in sync with world.ts. Importing them would create a runtime cycle. */
const SEA_LEVEL = 63;
const MIN_Y = -64;
const MAX_Y = 320;

const BLOCK_NAMES = [
  'water', 'lava', 'ice', 'grass_block', 'dirt', 'coarse_dirt', 'gravel', 'sand',
  'stone', 'sandstone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks',
  'mossy_stone_bricks', 'cracked_stone_bricks', 'moss_block', 'oak_log',
  'oak_planks', 'oak_stairs', 'oak_slab', 'glass', 'torch', 'lantern',
  'crafting_table', 'bookshelf', 'obsidian',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'birch_log', 'spruce_log',
] as const;

type BlockName = typeof BLOCK_NAMES[number];
type Ids = Record<BlockName, number>;

function hash2(x: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 1103515245) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface RectInfo {
  g: number;
  lo: number;
  grass: number;
  cells: number;
}

interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const VILLAGE_BIOMES = new Set(['plains', 'birch_forest', 'forest', 'savanna', 'taiga']);
const PLANTS = new Set([
  'short_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'azure_bluet',
  'oxeye_daisy', 'allium', 'lily_of_the_valley', 'dead_bush',
]);
const TRUNKS = new Set(['oak_log', 'birch_log', 'spruce_log']);

class Builder {
  readonly sites: StructureSite[] = [];
  private readonly w: World;
  private readonly id: Ids;
  private readonly seed: number;
  private readonly occupied = new Set<string>();
  private spawn: Spawn = { x: 0, y: 0, z: 0, yaw: 0 };
  private viewX = 0;
  private viewZ = 1;

  constructor(world: World) {
    this.w = world;
    this.seed = world.seed;
    const ids = {} as Ids;
    for (const name of BLOCK_NAMES) ids[name] = world.rocks.id(name);
    this.id = ids;
  }

  run(): void {
    // A cheap coast-spawn estimate. The real findSpawn (called by main after
    // generate) does an expensive tree scan; this mirrors its topological
    // scoring only. Structures keep a wide margin, so a few blocks of
    // difference cannot put them inside the spawn bubble or the lake vista.
    this.spawn = this.estimateSpawn();
    this.viewX = -Math.sin(this.spawn.yaw);
    this.viewZ = Math.cos(this.spawn.yaw);

    const village = this.findVillageSite();
    if (village) {
      this.buildVillage(village.x, village.z);
      this.sites.push({ type: 'village', x: village.x, z: village.z });
    }
    this.placeRuins(village);
    this.placeDesertRuin();
  }

  /**
   * Fast approximation of World.findCoastSpawn: same scoring, but candidate
   * radii/angles and the tree/vista scans are subsampled. It lands within a
   * few blocks of the real spawn, and all structures keep >34 blocks of
   * clearance, so it cannot affect the player's spawn or first view.
   */
  private estimateSpawn(): Spawn {
    const water: [number, number][] = [];
    for (const c of this.w.chunks.values()) {
      for (let lz = 0; lz < 16; lz += 3) {
        for (let lx = 0; lx < 16; lx += 3) {
          const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
          if (this.get(x, SEA_LEVEL, z) === this.id.water && this.get(x, SEA_LEVEL + 1, z) === 0) {
            water.push([x, z]);
          }
        }
      }
    }
    if (!water.length) {
      return { x: 0, y: SEA_LEVEL + 4, z: 0, yaw: 0 };
    }
    let sumX = 0, sumZ = 0;
    for (const [x, z] of water) { sumX += x; sumZ += z; }
    const cx = sumX / water.length, cz = sumZ / water.length;
    const leaves = new Set([this.id.oak_leaves, this.id.birch_leaves, this.id.spruce_leaves]);
    const treeBlocks = new Set([this.id.oak_log, this.id.birch_log, this.id.spruce_log,
      this.id.oak_leaves, this.id.birch_leaves, this.id.spruce_leaves]);

    let best: { x: number, y: number, z: number, score: number } | null = null;
    for (let wi = 0; wi < water.length; wi += 5) {
      const [wx, wz] = water[wi];
      for (let r = 6; r <= 26; r += 4) {
        const steps = Math.max(12, r);
        for (let a = 0; a < steps; a++) {
          const ang = (a / steps) * Math.PI * 2;
          const x = Math.round(wx + Math.cos(ang) * r);
          const z = Math.round(wz + Math.sin(ang) * r);
          if (Math.abs(x) > 90 || Math.abs(z) > 90) continue;
          const h = this.h(x, z);
          if (h < SEA_LEVEL || h > SEA_LEVEL + 34) continue;
          const top = this.get(x, h, z);
          const grass = top === this.id.grass_block;
          if (!grass && top !== this.id.sand) continue;
          const biome = this.w.biomeNameAt(x, z);
          if (biome === 'ocean' || biome === 'frozen_ocean' || biome === 'mountains') continue;
          let clear = true;
          for (let dy = 1; dy <= 5; dy++) {
            const above = this.get(x, h + dy, z);
            if (above !== 0 && this.w.rocks.solid[above]) { clear = false; break; }
          }
          if (!clear) continue;

          const toWaterX = cx - x, toWaterZ = cz - z;
          const len = Math.hypot(toWaterX, toWaterZ) || 1;
          const fx = toWaterX / len, fz = toWaterZ / len;
          let blocked = false;
          for (let t = 3; t <= 18; t += 3) {
            if (this.h(Math.round(x + fx * t), Math.round(z + fz * t)) > h + 2) { blocked = true; break; }
          }
          if (blocked) continue;

          // Subsample the canopy scan and scale the count (actual count is 4x).
          let trees = 0;
          for (let dz = -3; dz <= 3; dz += 2) {
            for (let dx = -3; dx <= 3; dx += 2) {
              for (let dy = 1; dy <= 10; dy += 2) {
                if (leaves.has(this.get(x + dx, h + dy, z + dz))) trees += 4;
              }
            }
          }
          if (trees > 14) continue;
          let vistaTrees = 0;
          for (let t = 4; t <= 12; t += 4) {
            for (let o = -2; o <= 2; o += 2) {
              const px = Math.round(x + fx * t - fz * o);
              const pz = Math.round(z + fz * t + fx * o);
              for (let dy = 1; dy <= 9; dy += 3) {
                if (treeBlocks.has(this.get(px, h + dy, pz))) vistaTrees += 6;
              }
            }
          }
          const heightBonus = h >= SEA_LEVEL + 3 && h <= SEA_LEVEL + 13 ? 8 : h > SEA_LEVEL + 13 ? 4 : 1;
          const distBonus = r >= 7 && r <= 18 ? 6 : 2;
          const score = (grass ? 7 : 0) + heightBonus + distBonus + (top === this.id.sand ? 2 : 0)
            - trees * 0.25 - vistaTrees * 0.4;
          if (!best || score > best.score) best = { x, y: h + 1, z, score };
        }
      }
    }
    if (!best) best = { x: 0, y: SEA_LEVEL + 4, z: 0, score: 0 };
    const yaw = Math.atan2(-(cx - best.x), cz - best.z);
    return { x: best.x, y: best.y, z: best.z, yaw };
  }

  // ---------------- helpers ----------------

  private inside(x: number, z: number): boolean {
    return x >= this.w.minWorldX && x <= this.w.maxWorldX && z >= this.w.minWorldZ && z <= this.w.maxWorldZ;
  }

  private h(x: number, z: number): number {
    const c = this.w.chunkAt(x >> 4, z >> 4);
    if (!c) return -999;
    return c.heights[((z & 15) << 4) | (x & 15)];
  }

  private put(x: number, y: number, z: number, block: number): void {
    if (y < MIN_Y || y >= MAX_Y || !this.inside(x, z)) return;
    this.w.setBlock(x, y, z, block);
  }

  private get(x: number, y: number, z: number): number {
    if (y < MIN_Y || y >= MAX_Y || !this.inside(x, z)) return 0;
    return this.w.getBlock(x, y, z);
  }

  private isLiquid(id: number): boolean {
    return id === this.id.water || id === this.id.lava || id === this.id.ice;
  }

  private rectInfo(x0: number, z0: number, wid: number, dep: number): RectInfo | null {
    let g = -9999, lo = 9999, grass = 0, cells = 0;
    for (let z = z0; z < z0 + dep; z++) {
      for (let x = x0; x < x0 + wid; x++) {
        if (!this.inside(x, z)) return null;
        const h = this.h(x, z);
        if (h < SEA_LEVEL + 1 || h > 150) return null;
        const top = this.w.getBlock(x, h, z);
        if (top === 0 || this.isLiquid(top)) return null;
        const isGrass = top === this.id.grass_block || top === this.id.dirt || top === this.id.coarse_dirt;
        const isRuinGround = isGrass || top === this.id.sand || top === this.id.gravel ||
          top === this.id.stone || top === this.id.sandstone || top === this.id.moss_block;
        if (!isRuinGround) return null;
        if (isGrass) grass++;
        cells++;
        if (h > g) g = h;
        if (h < lo) lo = h;
      }
    }
    return { g, lo, grass, cells };
  }

  /** Approximate distance to open water, sampled from the terrain height grid. */
  private waterDistance(x: number, z: number, maxR = 60): number {
    let best = maxR + 1;
    for (let r = 6; r <= maxR; r += 5) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const px = Math.round(x + Math.cos(ang) * r);
        const pz = Math.round(z + Math.sin(ang) * r);
        const h = this.h(px, pz);
        if (h !== -999 && h < SEA_LEVEL) {
          if (r < best) best = r;
          break;
        }
      }
    }
    return best;
  }

  /** Cheap 3x3 height probe used to skip obviously sloped site candidates. */
  private roughFlat(x0: number, z0: number, wid: number, dep: number): boolean {
    let lo = 9999, hi = -9999;
    for (const fz of [0, 0.5, 1]) {
      for (const fx of [0, 0.5, 1]) {
        const h = this.h(x0 + Math.round((wid - 1) * fx), z0 + Math.round((dep - 1) * fz));
        if (h < SEA_LEVEL + 1) return false;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return hi - lo <= 3;
  }

  private clearColumn(x: number, z: number, from: number, to: number): void {
    for (let y = from; y <= to && y < MAX_Y; y++) this.put(x, y, z, 0);
  }

  /**
   * Clear trees/plants over a rectangle and fill a level foundation up to g.
   * Heights are read before any writes, so this is deterministic.
   */
  private prepare(x0: number, z0: number, wid: number, dep: number, g: number, clearHeight: number): void {
    for (let z = z0; z < z0 + dep; z++) {
      for (let x = x0; x < x0 + wid; x++) {
        const h = this.h(x, z);
        this.occupied.add(`${x},${z}`);
        this.clearColumn(x, z, h + 1, h + clearHeight);
        for (let y = h + 1; y < g; y++) this.put(x, y, z, this.id.cobblestone);
        this.put(x, g, z, this.id.dirt);
      }
    }
  }

  private ruinBlock(x: number, y: number, z: number): number {
    const r = hash3(x, y, z, this.seed + 1207);
    if (r < 0.3) return this.id.cobblestone;
    if (r < 0.48) return this.id.mossy_cobblestone;
    if (r < 0.72) return this.id.stone_bricks;
    if (r < 0.88) return this.id.mossy_stone_bricks;
    return this.id.cracked_stone_bricks;
  }

  // ---------------- village ----------------

  private findVillageSite(): { x: number; z: number } | null {
    const pass = (relaxed: boolean): { x: number; z: number; score: number } | null => {
      let best: { x: number; z: number; score: number } | null = null;
      for (let z = this.w.minWorldZ + 10; z <= this.w.maxWorldZ - 10; z += 2) {
        for (let x = this.w.minWorldX + 12; x <= this.w.maxWorldX - 12; x += 2) {
          const dx = x - this.spawn.x, dz = z - this.spawn.z;
          const d = Math.hypot(dx, dz);
          const minD = relaxed ? 45 : 50;
          const maxD = relaxed ? 88 : 82;
          if (d < minD || d > maxD) continue;
          const frontal = (dx * this.viewX + dz * this.viewZ) / Math.max(1, d);
          if (frontal > (relaxed ? 0.4 : 0.2)) continue;
          if (!this.roughFlat(x - 10, z - 8, 21, 18)) continue;
          const info = this.rectInfo(x - 10, z - 8, 21, 18);
          if (!info) continue;
          const spread = info.g - info.lo;
          if (spread > (relaxed ? 3 : 2)) continue;
          if (!relaxed && info.grass < info.cells * 0.85) continue;
          const biome = this.w.biomeNameAt(x, z);
          if (relaxed ? (biome === 'ocean' || biome === 'frozen_ocean' || biome === 'snowy_plains') : !VILLAGE_BIOMES.has(biome)) continue;
          if (this.waterDistance(x, z, 58) < (relaxed ? 36 : 46)) continue;
          const mid = (info.g + info.lo) / 2;
          let score = spread * 10;
          score += Math.abs(d - 66) * 0.22;
          score += Math.abs(mid - 78) * 0.05;
          score += Math.max(0, frontal) * 5;
          if (biome === 'plains') score -= 2;
          else if (biome === 'birch_forest') score -= 0.8;
          else if (biome === 'forest') score += 0.8;
          else if (biome === 'taiga') score += 1.8;
          score += hash2(x, z, this.seed + 501) * 1.1;
          if (!best || score < best.score) best = { x, z, score };
        }
      }
      return best;
    };
    let best = pass(false);
    if (!best) best = pass(true);
    return best ? { x: best.x, z: best.z } : null;
  }

  private buildVillage(ax: number, az: number): void {
    // The four buildings face the central street; all offsets stay within the
    // flat 21x18 plot checked by findVillageSite.
    if (this.buildHouse(ax - 9, az - 7, 7, 5, 3, 1, 1)) {
      this.sites.push({ type: 'house', x: ax - 6, z: az - 5 });
    }
    if (this.buildHouse(ax + 3, az - 7, 7, 5, 3, 2, 2)) {
      this.sites.push({ type: 'workshop', x: ax + 6, z: az - 5 });
    }
    if (this.buildWell(ax - 3, az + 2)) this.sites.push({ type: 'well', x: ax - 2, z: az + 3 });
    if (this.buildTower(ax + 4, az + 3)) this.sites.push({ type: 'watchtower', x: ax + 6, z: az + 5 });

    const street: [number, number][] = [];
    for (let z = az - 2; z <= az + 6; z++) { street.push([ax, z]); street.push([ax + 1, z]); }
    for (let x = ax - 6; x <= ax - 1; x++) street.push([x, az - 2]);
    for (let x = ax + 2; x <= ax + 6; x++) street.push([x, az - 2]);
    for (let x = ax + 2; x <= ax + 3; x++) street.push([x, az + 5]);
    for (const [x, z] of street) this.pathCell(x, z);

    this.lanternPost(ax - 2, az - 1);
    this.lanternPost(ax + 2, az + 7);
  }

  private buildHouse(
    x0: number, z0: number, wid: number, dep: number, wallH: number,
    tables: number, shelves: number,
  ): boolean {
    const info = this.rectInfo(x0, z0, wid, dep);
    if (!info || info.g - info.lo > 2) return false;
    const g = info.g;
    this.prepare(x0, z0, wid, dep, g, wallH + 16);

    const frontZ = z0 + dep - 1;
    const doorX = x0 + (wid >> 1);

    // Foundation/floor: cobble edge, plank interior.
    for (let z = z0; z < z0 + dep; z++) {
      for (let x = x0; x < x0 + wid; x++) {
        const edge = x === x0 || x === x0 + wid - 1 || z === z0 || z === z0 + dep - 1;
        this.put(x, g, z, edge ? this.id.cobblestone : this.id.oak_planks);
      }
    }

    // Corner logs and plank walls.
    for (let y = g + 1; y <= g + wallH; y++) {
      for (let x = x0; x < x0 + wid; x++) {
        const corner = x === x0 || x === x0 + wid - 1;
        this.put(x, y, z0, corner ? this.id.oak_log : this.id.oak_planks);
        this.put(x, y, frontZ, corner ? this.id.oak_log : this.id.oak_planks);
      }
      for (let z = z0 + 1; z < frontZ; z++) {
        this.put(x0, y, z, y === g + 1 ? this.id.oak_log : this.id.oak_planks);
        this.put(x0 + wid - 1, y, z, y === g + 1 ? this.id.oak_log : this.id.oak_planks);
      }
    }

    // Door opening (two blocks high) and glass windows.
    this.put(doorX, g + 1, frontZ, 0);
    this.put(doorX, g + 2, frontZ, 0);
    this.put(x0 + 1, g + 2, frontZ, this.id.glass);
    this.put(x0 + wid - 2, g + 2, frontZ, this.id.glass);
    this.put(x0 + 1, g + 2, z0, this.id.glass);
    this.put(x0 + wid - 2, g + 2, z0, this.id.glass);
    this.put(x0, g + 2, z0 + 2, this.id.glass);
    this.put(x0 + wid - 1, g + 2, z0 + 2, this.id.glass);

    // Interior furniture along the back wall.
    this.put(x0 + 1, g + 1, z0 + 1, this.id.crafting_table);
    this.put(x0 + 2, g + 1, z0 + 1, this.id.bookshelf);
    for (let i = 0; i < tables; i++) this.put(x0 + 3 + i, g + 1, z0 + 1, this.id.crafting_table);
    for (let i = 0; i < shelves; i++) this.put(x0 + 1 + i, g + 1, z0 + 2, this.id.bookshelf);
    const torchX = x0 + wid - 2, torchZ = z0 + 2;
    if (this.get(torchX, g + 1, torchZ) === 0) this.put(torchX, g + 1, torchZ, this.id.torch);

    // Stepped hip roof: stair eaves, slab courses, one overhang.
    // Clear the overhang ring too, otherwise a tree can poke through the eaves.
    for (let z = z0 - 1; z <= z0 + dep; z++) {
      for (let x = x0 - 1; x <= x0 + wid; x++) {
        const outside = x < x0 || x > x0 + wid - 1 || z < z0 || z > z0 + dep - 1;
        if (outside) this.clearColumn(x, z, this.h(x, z) + 1, this.h(x, z) + wallH + 16);
        const dx = x < x0 || x > x0 + wid - 1 ? -1 : Math.min(x - x0, x0 + wid - 1 - x);
        const dz = z < z0 || z > z0 + dep - 1 ? -1 : Math.min(z - z0, z0 + dep - 1 - z);
        const dmin = Math.max(0, Math.min(dx, dz));
        const y = g + wallH + 1 + dmin;
        // Stairs always ascend +X, so they form the west slope correctly.
        // The mirrored east slope uses slabs to avoid upside-down steps.
        const stair = x < x0 + wid / 2;
        this.put(x, y, z, stair ? this.id.oak_stairs : this.id.oak_slab);
      }
    }

    // Torch on a cobble sconce beside the door.
    this.put(doorX - 2, g + 2, frontZ + 1, this.id.cobblestone);
    this.put(doorX - 2, g + 3, frontZ + 1, this.id.torch);
    return true;
  }

  private buildWell(x0: number, z0: number): boolean {
    const info = this.rectInfo(x0, z0, 3, 3);
    if (!info || info.g - info.lo > 2) return false;
    const g = info.g;
    this.prepare(x0, z0, 3, 3, g, 10);

    for (let z = z0; z < z0 + 3; z++) {
      for (let x = x0; x < x0 + 3; x++) {
        const rim = x === x0 || x === x0 + 2 || z === z0 || z === z0 + 2;
        this.put(x, g, z, this.id.cobblestone);
        if (rim) this.put(x, g + 1, z, this.id.cobblestone);
      }
    }
    this.put(x0 + 1, g, z0 + 1, this.id.water);
    for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
      this.put(x0 + dx, g + 2, z0 + dz, this.id.oak_log);
    }
    for (let z = z0; z < z0 + 3; z++) {
      for (let x = x0; x < x0 + 3; x++) this.put(x, g + 3, z, this.id.oak_slab);
    }
    this.put(x0 + 1, g + 2, z0, this.id.torch);
    return true;
  }

  private buildTower(x0: number, z0: number): boolean {
    const info = this.rectInfo(x0, z0, 5, 5);
    if (!info || info.g - info.lo > 2) return false;
    const g = info.g;
    this.prepare(x0, z0, 5, 5, g, 22);
    const frontZ = z0 + 4;

    for (let z = z0; z < z0 + 5; z++) {
      for (let x = x0; x < x0 + 5; x++) this.put(x, g, z, this.id.cobblestone);
    }
    for (let y = g + 1; y <= g + 8; y++) {
      for (let x = x0; x < x0 + 5; x++) {
        const corner = x === x0 || x === x0 + 4;
        const block = y <= g + 2 ? this.id.cobblestone : this.id.oak_planks;
        this.put(x, y, z0, corner ? this.id.oak_log : block);
        this.put(x, y, frontZ, corner ? this.id.oak_log : block);
      }
      for (let z = z0 + 1; z < frontZ; z++) {
        const block = y <= g + 2 ? this.id.cobblestone : this.id.oak_planks;
        this.put(x0, y, z, y === g + 1 || y === g + 2 ? this.id.oak_log : block);
        this.put(x0 + 4, y, z, y === g + 1 || y === g + 2 ? this.id.oak_log : block);
      }
    }
    // Door on the west face, facing the village street.
    this.put(x0, g + 1, z0 + 2, 0);
    this.put(x0, g + 2, z0 + 2, 0);
    this.put(x0 + 2, g + 5, z0, this.id.glass);
    this.put(x0 + 2, g + 5, frontZ, this.id.glass);
    this.put(x0, g + 5, z0 + 2, this.id.glass);
    this.put(x0 + 4, g + 5, z0 + 2, this.id.glass);
    this.put(x0 + 2, g + 1, z0 + 2, this.id.torch);

    // Open watch platform with a crenellated parapet and a lantern.
    for (let z = z0; z < z0 + 5; z++) {
      for (let x = x0; x < x0 + 5; x++) this.put(x, g + 9, z, this.id.oak_planks);
    }
    for (let z = z0; z < z0 + 5; z++) {
      for (let x = x0; x < x0 + 5; x++) {
        const rim = x === x0 || x === x0 + 4 || z === z0 || z === z0 + 4;
        if (!rim) continue;
        if (hash2(x, z, this.seed + 822) < 0.28) continue;
        this.put(x, g + 10, z, this.id.cobblestone);
        if ((x + z) % 3 === 0) this.put(x, g + 11, z, this.id.cobblestone);
      }
    }
    this.put(x0 + 2, g + 10, z0 + 2, this.id.lantern);
    return true;
  }

  private pathCell(x: number, z: number): void {
    if (!this.inside(x, z) || this.occupied.has(`${x},${z}`)) return;
    const h = this.h(x, z);
    if (h < SEA_LEVEL + 1) return;
    const top = this.get(x, h, z);
    if (top !== this.id.grass_block && top !== this.id.dirt && top !== this.id.coarse_dirt &&
      top !== this.id.gravel && top !== this.id.sand) return;
    const above = this.get(x, h + 1, z);
    if (above !== 0) {
      const name = this.w.rocks.get(above).name;
      if (TRUNKS.has(name)) {
        // A trunk intersects the path: remove the whole tree column.
        this.clearColumn(x, z, h + 1, h + 15);
      } else if (PLANTS.has(name)) {
        this.put(x, h + 1, z, 0);
      }
      // Anything else (roof eave, sconce, torch) is structure and stays.
    }
    const r = hash2(x, z, this.seed + 733);
    const block = r < 0.7 ? this.id.coarse_dirt : r < 0.9 ? this.id.gravel : this.id.dirt;
    this.put(x, h, z, block);
  }

  private lanternPost(x: number, z: number): void {
    if (!this.inside(x, z) || this.occupied.has(`${x},${z}`)) return;
    const h = this.h(x, z);
    if (h < SEA_LEVEL + 1) return;
    const top = this.get(x, h, z);
    if (top !== this.id.grass_block && top !== this.id.dirt && top !== this.id.coarse_dirt && top !== this.id.gravel) return;
    const above = this.get(x, h + 1, z);
    if (above !== 0) {
      const name = this.w.rocks.get(above).name;
      if (TRUNKS.has(name)) this.clearColumn(x, z, h + 1, h + 15);
      else if (!PLANTS.has(name)) return;
      else this.put(x, h + 1, z, 0);
    }
    this.put(x, h + 1, z, this.id.oak_log);
    this.put(x, h + 2, z, this.id.oak_log);
    this.put(x, h + 3, z, this.id.lantern);
  }

  // ---------------- ruins ----------------

  private placeRuins(village: { x: number; z: number } | null): void {
    const candidates: { x: number; z: number; score: number }[] = [];
    for (let z = this.w.minWorldZ + 5; z <= this.w.maxWorldZ - 5; z += 3) {
      for (let x = this.w.minWorldX + 5; x <= this.w.maxWorldX - 5; x += 3) {
        const dx = x - this.spawn.x, dz = z - this.spawn.z;
        const d = Math.hypot(dx, dz);
        if (d < 34 || d > 92) continue;
        const frontal = (dx * this.viewX + dz * this.viewZ) / Math.max(1, d);
        if (d < 54 && frontal > 0.45) continue;
        if (village && Math.hypot(x - village.x, z - village.z) < 24) continue;
        if (!this.roughFlat(x - 4, z - 3, 9, 7)) continue;
        const info = this.rectInfo(x - 4, z - 3, 9, 7);
        if (!info || info.g - info.lo > 2) continue;
        if (this.waterDistance(x, z, 54) < 44) continue;
        const score = hash2(x, z, this.seed + 901) + (info.g - info.lo) * 0.4 + (info.cells - info.grass) * 0.02;
        candidates.push({ x, z, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);

    const chosen: { x: number; z: number }[] = [];
    for (const c of candidates) {
      if (chosen.length >= 4) break;
      if (village && Math.hypot(c.x - village.x, c.z - village.z) < 20) continue;
      if (chosen.some(s => Math.hypot(s.x - c.x, s.z - c.z) < 18)) continue;
      chosen.push({ x: c.x, z: c.z });
    }

    const types = ['ruined_portal', 'campsite', 'ruined_wall', 'ruined_hut'];
    for (let i = 0; i < chosen.length; i++) {
      const { x, z } = chosen[i];
      const type = types[i % types.length];
      let ok = false;
      if (type === 'ruined_portal') ok = this.buildPortal(x - 3, z - 3);
      else if (type === 'campsite') ok = this.buildCampsite(x - 3, z - 3);
      else if (type === 'ruined_wall') ok = this.buildRuinWalls(x - 3, z - 2, 7, 5, 0);
      else ok = this.buildRuinWalls(x - 3, z - 2, 7, 5, 1);
      if (ok) this.sites.push({ type, x, z });
    }
  }

  /** Flatten and clear a roughly square ruin pad, returning its floor height. */
  private ruinPad(x0: number, z0: number, wid: number, dep: number, desert = false): number | null {
    const info = this.rectInfo(x0, z0, wid, dep);
    if (!info || info.g - info.lo > 2) return null;
    const g = info.g;
    for (let z = z0; z < z0 + dep; z++) {
      for (let x = x0; x < x0 + wid; x++) {
        const h = this.h(x, z);
        this.clearColumn(x, z, h + 1, h + 16);
        for (let y = h + 1; y < g; y++) this.put(x, y, z, desert ? this.id.sand : this.id.dirt);
        const r = hash2(x, z, this.seed + 955);
        if (h === g) {
          if (desert) {
            if (r < 0.2) this.put(x, g, z, this.id.sandstone);
          } else if (r < 0.16) {
            this.put(x, g, z, this.id.moss_block);
          } else if (r < 0.28) {
            this.put(x, g, z, r < 0.22 ? this.id.gravel : this.id.coarse_dirt);
          }
        } else {
          this.put(x, g, z, desert ? this.id.sand : (r < 0.3 ? this.id.moss_block : this.id.coarse_dirt));
        }
      }
    }
    return g;
  }

  private buildPortal(x0: number, z0: number): boolean {
    const g = this.ruinPad(x0, z0, 7, 6);
    if (g === null) return false;
    const zf = z0 + 3;
    for (let x = x0; x < x0 + 7; x++) {
      for (let z = z0 + 2; z <= z0 + 4; z++) this.put(x, g, z, this.id.stone_bricks);
    }
    // 4x5 obsidian frame with a missing top corner and one shattered side.
    for (let y = g + 1; y <= g + 5; y++) {
      for (let x = x0 + 1; x <= x0 + 4; x++) {
        const frame = y === g + 1 || y === g + 5 || x === x0 + 1 || x === x0 + 4;
        if (!frame) continue;
        if (y === g + 5 && x === x0 + 4) continue;
        if (x === x0 + 1 && y === g + 3) continue;
        this.put(x, y, zf, this.id.obsidian);
      }
    }
    // Broken obsidian debris and rubble on the pad.
    for (let i = 0; i < 9; i++) {
      const dx = x0 + ((hash2(x0, z0, this.seed + 1010 + i) * 7) | 0);
      const dz = z0 + ((hash2(x0, z0, this.seed + 1030 + i) * 6) | 0);
      if (dz === z0 + 3 && dx >= x0 + 1 && dx <= x0 + 4) continue;
      const block = i < 2 ? this.id.obsidian : this.ruinBlock(dx, g + 1, dz);
      this.put(dx, g + 1, dz, block);
    }
    this.put(x0, g + 1, zf, this.id.torch);
    this.put(x0 + 5, g + 1, zf, this.id.torch);
    return true;
  }

  private buildCampsite(x0: number, z0: number): boolean {
    const g = this.ruinPad(x0, z0, 7, 7);
    if (g === null) return false;
    // Slab tent on four log posts.
    for (const [dx, dz] of [[1, 1], [3, 1], [1, 3], [3, 3]]) {
      this.put(x0 + dx, g + 1, z0 + dz, this.id.oak_log);
      this.put(x0 + dx, g + 2, z0 + dz, this.id.oak_log);
    }
    for (let z = z0 + 1; z <= z0 + 3; z++) {
      for (let x = x0 + 1; x <= x0 + 3; x++) this.put(x, g + 3, z, this.id.oak_slab);
    }
    this.put(x0 + 2, g + 1, z0 + 2, this.id.moss_block);

    // Fire ring with a lantern, log seats, and supplies.
    this.put(x0 + 4, g, z0 + 3, this.id.cobblestone);
    this.put(x0 + 4, g + 1, z0 + 3, this.id.lantern);
    this.put(x0 + 3, g + 1, z0 + 4, this.id.oak_log);
    this.put(x0 + 5, g + 1, z0 + 3, this.id.oak_log);
    this.put(x0 + 5, g + 1, z0 + 2, this.id.bookshelf);
    this.put(x0 + 4, g + 1, z0 + 5, this.id.crafting_table);
    this.put(x0 + 2, g + 1, z0 + 5, this.id.torch);
    this.put(x0 + 6, g + 1, z0 + 4, this.id.torch);
    return true;
  }

  private buildRuinWalls(x0: number, z0: number, wid: number, dep: number, shape: number): boolean {
    const g = this.ruinPad(x0, z0, wid, dep);
    if (g === null) return false;

    const wallCell = (x: number, z: number, salt: number): void => {
      if (hash2(x, z, this.seed + 1100 + salt) < 0.16) return;
      const maxH = 1 + ((hash2(x, z, this.seed + 1130 + salt) * 3) | 0);
      for (let y = g + 1; y <= g + maxH; y++) {
        if (y > g + 1 && hash3(x, y, z, this.seed + 1160) < 0.12) continue;
        this.put(x, y, z, this.ruinBlock(x, y, z));
      }
    };

    for (let x = x0; x < x0 + wid; x++) wallCell(x, z0, 1);
    for (let z = z0 + 1; z < z0 + dep; z++) wallCell(x0, z, 2);
    if (shape === 1) {
      for (let x = x0 + 1; x < x0 + wid; x++) wallCell(x, z0 + dep - 1, 3);
    } else {
      // A broken interior spur makes the L-shaped ruin read as a former room.
      for (let z = z0 + 2; z < z0 + dep; z++) wallCell(x0 + 3, z, 4);
    }
    // Rubble and mossy patches.
    for (let i = 0; i < 8; i++) {
      const rx = x0 + ((hash2(x0, z0, this.seed + 1200 + i) * wid) | 0);
      const rz = z0 + ((hash2(x0, z0, this.seed + 1230 + i) * dep) | 0);
      if (rx === x0 || rz === z0) continue;
      this.put(rx, g + 1, rz, i < 2 ? this.id.moss_block : this.ruinBlock(rx, g + 1, rz));
    }
    return true;
  }

  private placeDesertRuin(): void {
    let best: { x: number; z: number; score: number } | null = null;
    for (let z = this.w.minWorldZ + 6; z <= this.w.maxWorldZ - 6; z += 6) {
      for (let x = this.w.minWorldX + 6; x <= this.w.maxWorldX - 6; x += 6) {
        if (this.w.biomeNameAt(x, z) !== 'desert') continue;
        const d = Math.hypot(x - this.spawn.x, z - this.spawn.z);
        if (d < 40 || d > 115) continue;
        if (this.sites.some(s => Math.hypot(s.x - x, s.z - z) < 22)) continue;
        const info = this.rectInfo(x - 3, z - 3, 7, 7);
        if (!info || info.g - info.lo > 2) continue;
        if (this.waterDistance(x, z, 54) < 44) continue;
        const score = hash2(x, z, this.seed + 1401) + Math.abs(d - 72) * 0.01;
        if (!best || score < best.score) best = { x, z, score };
      }
    }
    if (!best) return;
    const g = this.ruinPad(best.x - 3, best.z - 3, 7, 7, true);
    if (g === null) return;
    const x0 = best.x - 3, z0 = best.z - 3;
    // Low sandstone walls with collapsed gaps and a short slab lintel.
    for (let x = x0 + 1; x <= x0 + 5; x++) {
      if (hash2(x, z0 + 1, this.seed + 1440) < 0.3) continue;
      const hgt = 1 + ((hash2(x, z0 + 1, this.seed + 1450) * 3) | 0);
      for (let y = g + 1; y <= g + hgt; y++) this.put(x, y, z0 + 1, this.id.sandstone);
    }
    for (let z = z0 + 2; z <= z0 + 5; z++) {
      if (hash2(x0 + 1, z, this.seed + 1460) < 0.35) continue;
      const hgt = 1 + ((hash2(x0 + 1, z, this.seed + 1470) * 2) | 0);
      for (let y = g + 1; y <= g + hgt; y++) this.put(x0 + 1, y, z, this.id.sandstone);
    }
    this.put(x0 + 4, g + 3, z0 + 2, this.id.sandstone);
    this.put(x0 + 5, g + 3, z0 + 2, this.id.sandstone);
    this.put(x0 + 5, g + 3, z0 + 3, this.id.sandstone);
    // Support the lintel with a short pillar so nothing floats.
    this.put(x0 + 5, g + 1, z0 + 2, this.id.sandstone);
    this.put(x0 + 5, g + 2, z0 + 2, this.id.sandstone);
    this.put(x0 + 4, g + 1, z0 + 4, this.id.sandstone);
    this.put(x0 + 5, g + 1, z0 + 4, this.id.sandstone);
    this.sites.push({ type: 'desert_ruin', x: best.x, z: best.z });
  }
}

export function generateStructures(world: World): StructureSite[] {
  const builder = new Builder(world);
  builder.run();
  return builder.sites;
}
