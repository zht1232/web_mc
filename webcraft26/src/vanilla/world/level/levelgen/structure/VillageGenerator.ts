// Plains village generation, shaped after vanilla's jigsaw pipeline but with hand-built pieces
// instead of NBT structure templates (the vanilla plains/town_centers template pack is not in
// the browser asset set). What IS vanilla:
//   * placement  - structure_sets/villages.json random_spread (salt 10387312, spacing 34,
//                  separation 8) via RandomSpreadPlacement;
//   * start      - one village per candidate chunk, anchored at the chunk centre on the surface
//                  height (JigsawStructure.onTopOfChunkCenter uses WORLD_SURFACE_WG);
//   * biome gate - only in the village biomes, above sea level (Structure.generate's biome check);
//   * order      - pieces are laid out from a structure-seeded RNG (setLargeFeatureSeed), then
//                  every generated chunk materialises the SAME piece list and writes only the
//                  blocks inside its own 16x16 footprint, like vanilla's per-chunk piece fill;
//   * adaptation - each piece clears its box, sits its floor on the local surface height and
//                  fills the foundation down to ground (vanilla piece fillAndClear + dirt fill).
//
// Pieces: well, 4-6 houses, 1-2 farms, 0-1 animal pen, lamp posts, dirt paths. Paths only
// replace natural ground (grass/dirt/sand/gravel/podzol/stone) so they never cut into houses.

import { MinecraftData } from '../../block/state/BlockState.js';
import type { LevelChunk } from '../../chunk/LevelChunk.js';
import { ChunkBlockAccess } from '../ChunkBlockAccess.js';
import { LegacyRandomSource } from '../../../../core/Random.js';
import { WorldgenRandom } from '../feature/WorldgenRandom.js';
import { VILLAGE_PLACEMENT, structureRandom } from './RandomSpreadPlacement.js';

const VILLAGE_BIOMES = new Set(['minecraft:plains', 'plains', 'minecraft:sunflower_plains', 'sunflower_plains']);
const NATURAL_GROUND = new Set([
  'grass_block', 'dirt', 'sand', 'gravel', 'podzol', 'stone', 'coarse_dirt', 'mycelium', 'mud',
]);
/** A village's pieces reach at most this many chunks from the origin chunk. */
const PIECE_REACH = 4;

interface ChunkBounds { minBX: number; minBZ: number; minY: number; maxY: number }

interface VillageLayout {
  originX: number; originZ: number; anchorY: number;
  pieces: Piece[];
}

type Piece =
  | { kind: 'well'; x0: number; z0: number; x1: number; z1: number; y: number }
  | { kind: 'house'; x0: number; z0: number; x1: number; z1: number; y: number; facing: number }
  | { kind: 'farm'; x0: number; z0: number; x1: number; z1: number; y: number }
  | { kind: 'pen'; x0: number; z0: number; x1: number; z1: number; y: number }
  | { kind: 'lamp'; x: number; z: number; y: number }
  | { kind: 'path'; x0: number; z0: number; x1: number; z1: number; y: number };

export class VillageGenerator {
  private readonly st: {
    planks: number; cobble: number; cobbleSlab: number; log: number;
    stair: Record<string, number>; slab: number; pane: number; doorLower: Record<string, number>;
    doorUpper: Record<string, number>; fence: number; farmland: number; wheat: number;
    water: number; path: number; torch: number; lantern: number; hay: number; air: number;
  };
  private readonly seaLevel: number;
  private readonly minY: number;
  private readonly maxY: number;

  constructor(private readonly mc: MinecraftData, seaLevel: number, minY: number, maxY: number) {
    const s = (name: string, props?: Record<string, string>) => mc.stateOf(name, props);
    const FACING = ['north', 'south', 'west', 'east'];
    const stair: Record<string, number> = {};
    const doorLower: Record<string, number> = {};
    const doorUpper: Record<string, number> = {};
    for (const f of FACING) {
      stair[f] = s('oak_stairs', { facing: f, half: 'bottom' });
      doorLower[f] = s('oak_door', { facing: f, half: 'lower' });
      doorUpper[f] = s('oak_door', { facing: f, half: 'upper' });
    }
    this.st = {
      planks: s('oak_planks'),
      cobble: s('cobblestone'),
      cobbleSlab: s('cobblestone_slab', { type: 'bottom' }),
      log: s('oak_log'),
      stair,
      slab: s('oak_slab', { type: 'bottom' }),
      pane: s('glass_pane'),
      doorLower,
      doorUpper,
      fence: s('oak_fence'),
      farmland: s('farmland', { moisture: '7' }),
      wheat: s('wheat', { age: '7' }),
      water: s('water'),
      path: s('dirt_path'),
      torch: s('torch'),
      lantern: s('lantern'),
      hay: s('hay_block'),
      air: s('air'),
    };
    this.seaLevel = seaLevel;
    this.minY = minY;
    this.maxY = maxY;
  }

  /**
   * The village whose pieces reach the chunk (cx, cz), or null. Deterministic per origin chunk:
   * every chunk that materialises pieces of the same village gets the identical list. A village
   * spans <= PIECE_REACH chunks from its origin, so only candidates within reach apply.
   * Layouts (and their exact-height column walks) are memoised per origin chunk.
   */
  private readonly layoutCache = new Map<number, VillageLayout | null>();

  layoutFor(seed: bigint, cx: number, cz: number, heightAt: (x: number, z: number) => number, biomeNameAt: (x: number, y: number, z: number) => string): VillageLayout | null {
    const cacheKey = (cx + 32768) * 65536 + (cz + 32768);
    const cached = this.layoutCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const random = structureRandom();
    const candidates = VILLAGE_PLACEMENT.candidateCells(seed, cx, cz, PIECE_REACH, random);
    let result: VillageLayout | null = null;
    for (const c of candidates) {
      if (Math.max(Math.abs(c.x - cx), Math.abs(c.z - cz)) > PIECE_REACH) continue;
      const layout = this.buildLayout(seed, c.x, c.z, heightAt, biomeNameAt);
      if (layout && layout.pieces.length > 1) { result = layout; break; }
    }
    if (this.layoutCache.size > 64) this.layoutCache.clear();
    this.layoutCache.set(cacheKey, result);
    return result;
  }

  /** Build the whole village layout for an origin chunk (well at the chunk centre). */
  private buildLayout(seed: bigint, cx: number, cz: number, heightAt: (x: number, z: number) => number, biomeNameAt: (x: number, y: number, z: number) => string): VillageLayout | null {
    const centerX = cx * 16 + 8;
    const centerZ = cz * 16 + 8;
    // exact-height walks cost a density pass per column: memoise per layout build
    const heightMemo = new Map<number, number>();
    const heightOf = (x: number, z: number): number => {
      const k = (x + 33554432) * 65536 + (z + 33554432);
      let v = heightMemo.get(k);
      if (v === undefined) { v = heightAt(x, z); heightMemo.set(k, v); }
      return v;
    };
    const anchorY = heightOf(centerX, centerZ);
    // Site gate: above the sea, on village ground (Structure.generate biome check).
    if (anchorY <= this.seaLevel + 1 || anchorY >= this.maxY - 12) return null;
    if (!VILLAGE_BIOMES.has(biomeNameAt(centerX, anchorY, centerZ)) && !VILLAGE_BIOMES.has(biomeNameAt(centerX, anchorY + 1, centerZ))) {
      return null;
    }

    const random = new WorldgenRandom(0n);
    random.setLargeFeatureSeed(seed, cx, cz);
    // decouple from the placement RNG stream (vanilla starts each structure's RNG fresh too)
    void random.nextInt(64);

    const pieces: Piece[] = [];
    // Well: 5x5 cobble ring around a 1x1 water shaft.
    pieces.push({ kind: 'well', x0: centerX - 2, z0: centerZ - 2, x1: centerX + 2, z1: centerZ + 2, y: anchorY });

    // Plots: seeded houses on 4 directions with jitter, min spacing to avoid overlap.
    const houseCount = 4 + random.nextInt(3);
    const plots: { x: number; z: number; w: number; d: number; dir: number }[] = [];
    const farmCount = 1 + random.nextInt(2);
    const penWanted = random.nextBoolean();

    const tryPlot = (w: number, d: number): { x: number; z: number; dir: number } | null => {
      const dir = random.nextInt(4);
      const dist = 9 + random.nextInt(6); // 9..14 from the well centre
      const halfW = Math.floor(w / 2) + 1;
      const halfD = Math.floor(d / 2) + 1;
      const px = centerX + (dir === 2 ? -(dist + halfW) : dir === 3 ? dist + halfW : random.nextInt(2 * dist) - dist);
      const pz = centerZ + (dir === 0 ? -(dist + halfD) : dir === 1 ? dist + halfD : random.nextInt(2 * dist) - dist);
      for (const q of plots) {
        if (Math.abs(q.x - px) < (q.w + w) / 2 + 2 && Math.abs(q.z - pz) < (q.d + d) / 2 + 2) return null;
      }
      plots.push({ x: px, z: pz, w, d, dir });
      return { x: px, z: pz, dir };
    };

    for (let i = 0; i < houseCount; i++) {
      const p = tryPlot(6, 5);
      if (p) pieces.push({ kind: 'house', x0: p.x - 2, z0: p.z - 2, x1: p.x + 3, z1: p.z + 2, y: 0, facing: p.dir });
    }
    for (let i = 0; i < farmCount; i++) {
      const p = tryPlot(7, 9);
      if (p) pieces.push({ kind: 'farm', x0: p.x - 3, z0: p.z - 4, x1: p.x + 3, z1: p.z + 4, y: 0 });
    }
    if (penWanted) {
      const p = tryPlot(7, 5);
      if (p) pieces.push({ kind: 'pen', x0: p.x - 3, z0: p.z - 2, x1: p.x + 3, z1: p.z + 2, y: 0 });
    }

    // Anchor every piece to its own ground height, reject pieces that fall into water.
    const settled: Piece[] = [];
    for (const piece of pieces) {
      if (piece.kind === 'lamp') continue;
      const px = Math.floor((piece.x0 + piece.x1) / 2);
      const pz = Math.floor((piece.z0 + piece.z1) / 2);
      const y = heightOf(px, pz);
      if (y <= this.seaLevel) continue;
      if (piece.kind === 'well') piece.y = anchorY;
      else piece.y = y;
      settled.push(piece);
    }

    // Lamp posts along the well axes.
    const lamps = 2 + random.nextInt(3);
    for (let i = 0; i < lamps; i++) {
      const dir = random.nextInt(4);
      const dist = 5 + random.nextInt(8);
      const lx = centerX + (dir === 2 ? -dist : dir === 3 ? dist : random.nextInt(7) - 3);
      const lz = centerZ + (dir === 0 ? -dist : dir === 1 ? dist : random.nextInt(7) - 3);
      settled.push({ kind: 'lamp', x: lx, z: lz, y: 0 });
    }

    // Paths from the well edge toward each piece, 1 wide, following the ground.
    for (const piece of settled) {
      if (piece.kind === 'well' || piece.kind === 'path' || piece.kind === 'lamp') continue;
      const px = Math.floor((piece.x0 + piece.x1) / 2);
      const pz = Math.floor((piece.z0 + piece.z1) / 2);
      const steps = Math.max(Math.abs(px - centerX), Math.abs(pz - centerZ));
      for (let s = 4; s <= steps; s++) {
        const t = s / steps;
        const x = Math.round(centerX + (px - centerX) * t);
        const z = Math.round(centerZ + (pz - centerZ) * t);
        settled.push({ kind: 'path', x0: x, z0: z, x1: x, z1: z, y: 0 });
      }
    }

    return { originX: centerX, originZ: centerZ, anchorY, pieces: settled };
  }

  /**
   * Materialises every village piece that intersects `chunk`. Deterministic: the layout comes
   * from the origin chunk's seed, so all chunks write consistent halves.
   */
  generateInto(seed: bigint, chunk: LevelChunk, access: ChunkBlockAccess, heightAt: (x: number, z: number) => number, biomeNameAt: (x: number, y: number, z: number) => string): boolean {
    const layout = this.layoutFor(seed, chunk.x, chunk.z, heightAt, biomeNameAt);
    if (!layout) return false;
    const bounds: ChunkBounds = {
      minBX: chunk.x * 16, minBZ: chunk.z * 16,
      minY: this.minY, maxY: this.maxY,
    };
    let wrote = false;
    for (const piece of layout.pieces) {
      if (!intersects(piece, bounds)) continue;
      if (this.placePiece(piece, bounds, access, heightAt)) wrote = true;
    }
    return wrote;
  }

  // ------------------------------------------------------------------ writers

  /** Clipped block write: only inside the target chunk + build height. */
  private set(bounds: ChunkBounds, access: ChunkBlockAccess, x: number, y: number, z: number, state: number): void {
    if (x < bounds.minBX || x >= bounds.minBX + 16 || z < bounds.minBZ || z >= bounds.minBZ + 16) return;
    if (y < bounds.minY || y > bounds.maxY) return;
    access.set(x, y, z, state);
  }

  private name(access: ChunkBlockAccess, x: number, y: number, z: number): string {
    const st = access.get(x, y, z);
    const block = this.mc.blocks[this.mc.stateBlock[st]];
    return block ? block.name.replace('minecraft:', '') : '';
  }

  /** Clear the piece box to air (vanilla fillAndClear), floor at y, foundation down to ground. */
  private clearBox(piece: { x0: number; z0: number; x1: number; z1: number; y: number }, bounds: ChunkBounds, access: ChunkBlockAccess, heightAt: (x: number, z: number) => number, clearTop: number): void {
    for (let x = piece.x0; x <= piece.x1; x++) {
      for (let z = piece.z0; z <= piece.z1; z++) {
        for (let y = piece.y + 1; y <= piece.y + clearTop; y++) {
          this.set(bounds, access, x, y, z, this.st.air);
        }
        // foundation: cobblestone down until solid natural ground
        const ground = heightAt(x, z);
        for (let y = piece.y - 1; y >= Math.max(bounds.minY, ground - 8); y--) {
          const n = this.name(access, x, y, z);
          if (n === 'air' || n === 'water' || n === 'leaves' || n.endsWith('_leaves')) {
            this.set(bounds, access, x, y, z, this.st.cobble);
          } else break;
        }
      }
    }
  }

  private placePiece(piece: Piece, bounds: ChunkBounds, access: ChunkBlockAccess, heightAt: (x: number, z: number) => number): boolean {
    switch (piece.kind) {
      case 'well': return this.placeWell(piece, bounds, access);
      case 'house': return this.placeHouse(piece, bounds, access);
      case 'farm': return this.placeFarm(piece, bounds, access);
      case 'pen': return this.placePen(piece, bounds, access);
      case 'lamp': return this.placeLamp(piece, bounds, access, heightAt);
      case 'path': return this.placePath(piece, bounds, access);
    }
  }

  private placeWell(p: { x0: number; z0: number; x1: number; z1: number; y: number }, bounds: ChunkBounds, access: ChunkBlockAccess): boolean {
    const { st } = this;
    for (let x = p.x0; x <= p.x1; x++) {
      for (let z = p.z0; z <= p.z1; z++) {
        this.set(bounds, access, x, p.y, z, st.cobble); // cobble platform at ground
        const rim = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        if (rim) {
          for (let y = p.y + 1; y <= p.y + 2; y++) this.set(bounds, access, x, y, z, st.cobble);
        } else {
          // water shaft
          for (let y = p.y; y >= p.y - 7 && y >= bounds.minY; y--) this.set(bounds, access, x, y, z, st.water);
        }
      }
    }
    // corner posts + slab roof
    for (const [cx, cz] of [[p.x0, p.z0], [p.x1, p.z0], [p.x0, p.z1], [p.x1, p.z1]] as const) {
      this.set(bounds, access, cx, p.y + 3, cz, st.fence);
    }
    for (let x = p.x0; x <= p.x1; x++) {
      for (let z = p.z0; z <= p.z1; z++) {
        this.set(bounds, access, x, p.y + 4, z, st.cobbleSlab);
      }
    }
    return true;
  }

  private placeHouse(p: { x0: number; z0: number; x1: number; z1: number; y: number; facing: number }, bounds: ChunkBounds, access: ChunkBlockAccess, heightAt?: (x: number, z: number) => number): boolean {
    void heightAt;
    const { st } = this;
    const w = p.x1 - p.x0 + 1;
    const d = p.z1 - p.z0 + 1;
    this.clearBox(p, bounds, access, () => p.y, 8);
    // plank floor
    for (let x = p.x0; x <= p.x1; x++) {
      for (let z = p.z0; z <= p.z1; z++) this.set(bounds, access, x, p.y, z, st.planks);
    }
    // walls: log corners, planks sides, glass panes, door toward the facing direction
    const wallTop = p.y + 4;
    const facingDoor: string[] = ['north', 'south', 'west', 'east'];
    for (let x = p.x0; x <= p.x1; x++) {
      for (let z = p.z0; z <= p.z1; z++) {
        const edgeX = x === p.x0 || x === p.x1;
        const edgeZ = z === p.z0 || z === p.z1;
        if (!edgeX && !edgeZ) continue;
        const corner = edgeX && edgeZ;
        for (let y = p.y + 1; y <= wallTop; y++) {
          let state = corner ? st.log : st.planks;
          // door: middle of the facing wall, 2 high
          const midX = x === Math.floor((p.x0 + p.x1) / 2);
          const midZ = z === Math.floor((p.z0 + p.z1) / 2);
          if (facingDoor[p.facing] === 'north' && edgeZ && z === p.z0 && midX) state = y <= p.y + 2 ? st.doorLower.north : st.doorUpper.north;
          else if (facingDoor[p.facing] === 'south' && edgeZ && z === p.z1 && midX) state = y <= p.y + 2 ? st.doorLower.south : st.doorUpper.south;
          else if (facingDoor[p.facing] === 'west' && edgeX && x === p.x0 && midZ) state = y <= p.y + 2 ? st.doorLower.west : st.doorUpper.west;
          else if (facingDoor[p.facing] === 'east' && edgeX && x === p.x1 && midZ) state = y <= p.y + 2 ? st.doorLower.east : st.doorUpper.east;
          // windows on the two side walls
          else if (!corner && y === p.y + 2) {
            const onSideWall = (facingDoor[p.facing] === 'north' || facingDoor[p.facing] === 'south') ? edgeX : edgeZ;
            if (onSideWall) state = st.pane;
          }
          this.set(bounds, access, x, y, z, state);
        }
      }
    }
    // gable roof along the long axis: stairs stepping out from the ridge
    const alongX = w >= d;
    const ridgeY = wallTop + 1;
    const halfShort = Math.floor((alongX ? d : w) / 2);
    for (let s = 0; s <= halfShort; s++) {
      const y = ridgeY + s;
      for (let a = p.x0; a <= p.x1; a++) {
        for (let b = p.z0; b <= p.z1; b++) {
          if (alongX && b !== p.z0 + s && b !== p.z1 - s) continue;
          if (!alongX && a !== p.x0 + s && a !== p.x1 - s) continue;
          if (s === halfShort && (alongX ? d : w) % 2 === 1) {
            // ridge row: full planks
            this.set(bounds, access, a, y, b, st.planks);
            continue;
          }
          const near0 = alongX ? b === p.z0 + s : a === p.x0 + s;
          const facing = alongX ? (near0 ? 'south' : 'north') : (near0 ? 'east' : 'west');
          this.set(bounds, access, a, y, b, st.stair[facing]);
        }
      }
    }
    // torch inside
    this.set(bounds, access, Math.floor((p.x0 + p.x1) / 2), p.y + 3, Math.floor((p.z0 + p.z1) / 2), st.torch);
    return true;
  }

  private placeFarm(p: { x0: number; z0: number; x1: number; z1: number; y: number }, bounds: ChunkBounds, access: ChunkBlockAccess): boolean {
    const { st } = this;
    this.clearBox(p, bounds, access, () => p.y, 5);
    for (let x = p.x0; x <= p.x1; x++) {
      for (let z = p.z0; z <= p.z1; z++) {
        const rim = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        if (rim) {
          this.set(bounds, access, x, p.y, z, st.log);
        } else if (z === Math.floor((p.z0 + p.z1) / 2)) {
          this.set(bounds, access, x, p.y, z, st.water); // irrigation channel
        } else {
          this.set(bounds, access, x, p.y, z, st.farmland);
          this.set(bounds, access, x, p.y + 1, z, st.wheat);
        }
      }
    }
    return true;
  }

  private placePen(p: { x0: number; z0: number; x1: number; z1: number; y: number }, bounds: ChunkBounds, access: ChunkBlockAccess): boolean {
    const { st } = this;
    for (let x = p.x0; x <= p.x1; x++) {
      for (let z = p.z0; z <= p.z1; z++) {
        const rim = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        if (!rim) continue;
        const midX = x === Math.floor((p.x0 + p.x1) / 2) && z === p.z0;
        for (let y = p.y + 1; y <= p.y + 2; y++) {
          this.set(bounds, access, x, y, z, midX && y === p.y + 1 ? st.fence : st.fence); // gate simplified to fence
        }
        this.set(bounds, access, x, p.y, z, st.hay); // feed line
      }
    }
    return true;
  }

  private placeLamp(p: { x: number; z: number; y: number }, bounds: ChunkBounds, access: ChunkBlockAccess, heightAt: (x: number, z: number) => number): boolean {
    const { st } = this;
    // lamp pieces are anchored lazily to the local ground height (stable across chunks: the
    // layout RNG is the same, and getSurfaceHeight is deterministic per column)
    const y = heightAt(p.x, p.z);
    if (y <= this.seaLevel) return false;
    for (let dy = 1; dy <= 3; dy++) this.set(bounds, access, p.x, y + dy, p.z, st.fence);
    this.set(bounds, access, p.x, y + 4, p.z, st.lantern);
    return true;
  }

  private placePath(p: { x0: number; z0: number; x1: number; z1: number; y: number }, bounds: ChunkBounds, access: ChunkBlockAccess): boolean {
    const { st } = this;
    const x = p.x0, z = p.z0;
    // anchor to the local surface: walk down from the village anchor height to find ground
    for (let y = Math.min(bounds.maxY - 1, this.seaLevel + 24); y >= bounds.minY; y--) {
      const n = this.name(access, x, y, z);
      if (!NATURAL_GROUND.has(n)) continue;
      this.set(bounds, access, x, y, z, st.path);
      // fill small dips so the path does not hang over the next block
      const nBelow = this.name(access, x, y - 1, z);
      if (nBelow === 'air' || nBelow === 'water') this.set(bounds, access, x, y - 1, z, st.cobble);
      return true;
    }
    return false;
  }
}

function intersects(piece: Piece, b: ChunkBounds): boolean {
  const x0 = piece.kind === 'lamp' ? piece.x : piece.x0;
  const z0 = piece.kind === 'lamp' ? piece.z : piece.z0;
  const x1 = piece.kind === 'lamp' ? piece.x : piece.x1;
  const z1 = piece.kind === 'lamp' ? piece.z : piece.z1;
  return x1 >= b.minBX && x0 < b.minBX + 16 && z1 >= b.minBZ && z0 < b.minBZ + 16;
}
