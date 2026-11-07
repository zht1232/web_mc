// Spawn point selection. Pure functions over the noise generator: no chunk is generated, so this
// costs a few thousand `getSurfaceHeight` / `getBiome` calls (~20 ms warm, ~200 ms on the first
// cold call) instead of minutes of terrain generation, and it is deterministic for a given seed.
//
// Recipe (measured numbers in REPORTS/overnight/work-biome.md):
//   1. land hunt: outward Chebyshev rings from the search origin. A cell whose `getSurfaceHeight`
//      is at or above sea level is land; its biome is read with `getBiome`. Stop at the first land
//      cell in a preferred biome (plains / sunflower_plains / forest / flower_forest /
//      birch_forest / old_growth_birch_forest / meadow), keeping the first land cell as fallback.
//      The stride doubles past `fineRadius` so far-away land stays affordable.
//   2. window: sample a `windowRadius` square around that cell on a `gridStep` grid (surface +
//      biome per cell, reused by both steps below) and build a Chebyshev water distance field.
//   3. score every land candidate: preferred biome rank, water within `waterRadius` (default 24),
//      low relief over the 3x3 neighbours, short distance from the search origin.
//   4. refine the winner on a 1 block grid (a 9x9 patch) and take the flattest column there.
//
// Water detection: `getSurfaceHeight` is the *preliminary* surface from the noise router, and the
// chunk generator's real (interpolated) terrain sits 6..30 blocks ABOVE it - measured on this
// seed, min +6, max +30, mean +17 over 289 columns (shots/world/_probe-water-verify). So
// "height < sea level" alone produces ~170 false positives per 289 columns and must NOT be used
// as a water test. A column counts as water only when it is both below sea level AND its biome is
// an ocean/river/swamp biome: measured 0 false positives (predicted water is always really water,
// so the reported distance is a safe upper bound), 9 false negatives per 289 (ponds inside a land
// biome are invisible before generation, they only make the real spawn better than reported).
//
// "Not inside a tree canopy" cannot be answered before the chunk exists (trees are placed by the
// feature pass). `refineSpawnColumn()` is the post-generation half: call it from Game.spawnPlayer()
// once generateSpawnArea() has run and the column top block is known.

/** The part of NoiseChunkGenerator the spawn search needs (keeps this file node-testable). */
export interface SpawnWorldSource {
  readonly seaLevel: number;
  /** Highest non-air y for a column, from the noise surface (no chunk needed). */
  getSurfaceHeight(x: number, z: number): number;
  /** Biome id at a position, from the multi-noise biome source (no chunk needed). */
  getBiome(x: number, y: number, z: number): number;
  biomeName(id: number): string;
}

export interface SpawnOptions {
  /** Search origin in block coordinates; Game used (8,8) before. */
  originX?: number;
  originZ?: number;
  /** How far from the origin to look for land, in blocks. */
  maxRadius?: number;
  /** Stride of the land hunt rings near the origin. */
  landStep?: number;
  /** Beyond this distance the land hunt stride doubles. */
  fineRadius?: number;
  /** Radius of the scoring window around the land cell that was found. */
  windowRadius?: number;
  /** Stride of the window grid (surface + biome are sampled once per cell). */
  gridStep?: number;
  /** Biome names in priority order (namespace optional). */
  preferredBiomes?: readonly string[];
  /** Water must be found at most this many blocks away. */
  waterRadius?: number;
  /** Preferred distance to that water, in blocks. */
  idealWaterDistance?: number;
  /** Maximum terrain relief (max height - min height) over the 3x3 grid neighbours. */
  maxRelief?: number;
}

export interface SpawnSpot {
  /** Block column chosen; `y` is the noise surface, not the final block height. */
  x: number;
  y: number;
  z: number;
  /** Biome name (namespace kept, e.g. "minecraft:plains"). */
  biome: string;
  biomeId: number;
  /** True when the chosen biome is one of the preferred ones. */
  preferred: boolean;
  /** Chebyshev distance to the nearest detected water column, in blocks; Infinity when none. */
  waterDistance: number;
  /** Terrain relief over the 3x3 grid neighbours of the chosen column. */
  relief: number;
  /** Lower is better; the chosen spot is the minimum over all candidates. */
  score: number;
  /** Wall clock cost in milliseconds (diagnostic, not part of the deterministic result). */
  elapsedMs: number;
  /** Diagnostics: number of getSurfaceHeight / getBiome calls. */
  columnsSampled: number;
  biomeQueries: number;
}

export const DEFAULT_PREFERRED_BIOMES: readonly string[] = [
  'minecraft:plains',
  'minecraft:sunflower_plains',
  'minecraft:forest',
  'minecraft:flower_forest',
  'minecraft:birch_forest',
  'minecraft:old_growth_birch_forest',
  'minecraft:meadow',
];

/** Leaves / logs: a column whose top block is one of these is under a canopy, not on the floor. */
const TREE_COLUMN = /(_leaves$)|(_log$)|(_wood$)|(^vine$)|(^mangrove_roots$)|(^cocoa$)/;

/** True for block names that make a column top a tree/canopy rather than standable ground. */
export function isTreeBlock(blockName: string): boolean {
  return TREE_COLUMN.test(blockName.replace(/^minecraft:/, ''));
}

/**
 * Biome names whose surface is water: ocean / river / swamp families. Used with the height test,
 * see the header note: this combination had 0 false positives in the verification probe.
 */
const WATER_BIOME = /(ocean)|(river)|(swamp)/;

/** True when a biome name is a water-surface biome. */
export function isWaterBiome(biomeName: string): boolean {
  return WATER_BIOME.test(biomeName);
}

function shortName(name: string): string {
  return name.replace(/^minecraft:/, '');
}

const NONE = Number.POSITIVE_INFINITY;

interface Candidate {
  x: number;
  z: number;
  y: number;
  biomeId: number;
  biome: string;
  rank: number;
  relief: number;
  waterDistance: number;
  score: number;
  originDistance: number;
}

/**
 * Picks a spawn column. Costs ~1500-2000 generator calls: ~20 ms warm, ~150-250 ms on the very
 * first cold call (JIT). Defaults aim at plains/forest within 1024 blocks of the origin with water
 * within 24 blocks.
 */
export function findSpawnSpot(source: SpawnWorldSource, options: SpawnOptions = {}): SpawnSpot {
  const started = performance.now();
  const seaLevel = source.seaLevel;
  const originX = Math.trunc(options.originX ?? 8);
  const originZ = Math.trunc(options.originZ ?? 8);
  const maxRadius = Math.max(16, Math.trunc(options.maxRadius ?? 1024));
  const landStep = Math.max(4, Math.trunc(options.landStep ?? 24));
  const fineRadius = Math.max(landStep, Math.trunc(options.fineRadius ?? 256));
  const windowRadius = Math.max(8, Math.trunc(options.windowRadius ?? 64));
  const gridStep = Math.max(1, Math.trunc(options.gridStep ?? 8));
  const waterRadius = Math.max(gridStep, Math.trunc(options.waterRadius ?? 24));
  const idealWaterDistance = Math.max(0, Math.trunc(options.idealWaterDistance ?? 16));
  const maxRelief = Math.max(0, Math.trunc(options.maxRelief ?? 3));
  const preferred = (options.preferredBiomes ?? DEFAULT_PREFERRED_BIOMES).map(shortName);
  const rankOf = new Map<string, number>();
  preferred.forEach((name, index) => { if (!rankOf.has(name)) rankOf.set(name, index); });

  let columnsSampled = 0;
  let biomeQueries = 0;
  const surfaceAt = (x: number, z: number): number => {
    columnsSampled++;
    return source.getSurfaceHeight(x, z);
  };
  const biomeAt = (x: number, y: number, z: number): number => {
    biomeQueries++;
    return source.getBiome(x, y, z);
  };
  /** The preliminary surface for a water column is the sea/lake floor, always below sea level. */
  const isWaterHeight = (h: number): boolean => h < seaLevel;

  // ---- 1. land hunt --------------------------------------------------------------------
  let landX = originX;
  let landZ = originZ;
  let landH = seaLevel + 1;
  let landBiomeId = 0;
  let preferredFound = false;
  let foundLand = false;
  let firstLand: { x: number; z: number; h: number; biomeId: number } | null = null;
  let highest: { x: number; z: number; h: number } | null = null;

  for (let r = 0; r <= maxRadius; r += (r < fineRadius ? landStep : landStep * 2)) {
    for (let dz = -r; dz <= r; dz += landStep) {
      for (let dx = -r; dx <= r; dx += landStep) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = originX + dx;
        const z = originZ + dz;
        const h = surfaceAt(x, z);
        if (highest === null || h > highest.h) highest = { x, z, h };
        if (isWaterHeight(h)) continue;
        const biomeId = biomeAt(x, h, z);
        const isPreferred = rankOf.has(shortName(source.biomeName(biomeId)));
        if (!foundLand) {
          foundLand = true;
          firstLand = { x, z, h, biomeId };
        }
        if (isPreferred) {
          landX = x; landZ = z; landH = h; landBiomeId = biomeId;
          preferredFound = true;
          break;
        }
      }
      if (preferredFound) break;
    }
    if (preferredFound) break;
  }

  if (!foundLand) {
    // No land at all inside maxRadius: report the highest sampled column (it may be ocean).
    const x = highest?.x ?? originX;
    const z = highest?.z ?? originZ;
    const h = surfaceAt(x, z);
    const fallbackBiome = biomeAt(x, h, z);
    return {
      x, y: h, z,
      biome: source.biomeName(fallbackBiome), biomeId: fallbackBiome, preferred: false,
      waterDistance: 0, relief: 0, score: NONE, elapsedMs: performance.now() - started,
      columnsSampled, biomeQueries,
    };
  }
  if (!preferredFound && firstLand !== null) {
    landX = firstLand.x; landZ = firstLand.z; landH = firstLand.h; landBiomeId = firstLand.biomeId;
  }

  // ---- 2. window grid: surface + biome + water distance field --------------------------
  const baseX = landX - windowRadius;
  const baseZ = landZ - windowRadius;
  const count = Math.floor((windowRadius * 2) / gridStep) + 1;
  const heights = new Int32Array(count * count);
  const biomeIds = new Int32Array(count * count);
  const water = new Uint8Array(count * count);
  const cellIndex = (gx: number, gz: number): number => gz * count + gx;
  for (let gz = 0; gz < count; gz++) {
    const z = baseZ + gz * gridStep;
    for (let gx = 0; gx < count; gx++) {
      const x = baseX + gx * gridStep;
      const h = surfaceAt(x, z);
      const index = cellIndex(gx, gz);
      heights[index] = h;
      const biomeId = biomeAt(x, h, z); // reused by the candidate scoring below
      biomeIds[index] = biomeId;
      // See the header note: height alone is not a water test, the biome has to agree as well.
      water[index] = isWaterHeight(h) && isWaterBiome(source.biomeName(biomeId)) ? 1 : 0;
    }
  }

  // Multi-source BFS over the 8-neighbourhood: Chebyshev distance in grid cells.
  const distance = new Int32Array(count * count).fill(-1);
  const queue = new Int32Array(count * count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < water.length; i++) {
    if (water[i] === 1) { distance[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const index = queue[head++];
    const gx = index % count;
    const gz = (index / count) | 0;
    const next = distance[index] + 1;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = gx + ox;
        const nz = gz + oz;
        if (nx < 0 || nz < 0 || nx >= count || nz >= count) continue;
        const ni = cellIndex(nx, nz);
        if (distance[ni] !== -1) continue;
        distance[ni] = next;
        queue[tail++] = ni;
      }
    }
  }

  const reliefOf = (gx: number, gz: number): number => {
    let lo = NONE;
    let hi = -NONE;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oz === 0) continue;
        const nx = gx + ox;
        const nz = gz + oz;
        if (nx < 0 || nz < 0 || nx >= count || nz >= count) continue;
        const h = heights[cellIndex(nx, nz)];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return lo === NONE ? 0 : hi - lo;
  };

  // ---- 3. score candidates -------------------------------------------------------------
  const candidates: Candidate[] = [];
  for (let gz = 0; gz < count; gz++) {
    for (let gx = 0; gx < count; gx++) {
      const index = cellIndex(gx, gz);
      const h = heights[index];
      if (isWaterHeight(h)) continue;
      const x = baseX + gx * gridStep;
      const z = baseZ + gz * gridStep;
      const originDistance = Math.max(Math.abs(x - originX), Math.abs(z - originZ));
      if (originDistance > maxRadius + windowRadius) continue;

      const biomeId = biomeIds[index];
      const biome = source.biomeName(biomeId);
      const rank = rankOf.get(shortName(biome));
      const cellDistance = distance[index];
      const waterDistance = cellDistance < 0 ? NONE : cellDistance * gridStep;
      const relief = reliefOf(gx, gz);

      // Lower is better: preference dominates, then water distance, relief, height and centrality.
      const score =
        (rank === undefined ? 10000 : rank * 1000) +
        (waterDistance === NONE ? 100000 : Math.abs(waterDistance - idealWaterDistance) * 6) +
        relief * 40 +
        Math.max(0, h - (seaLevel + 1)) * 2 +
        0;
      candidates.push({
        x, z, y: h, biomeId, biome,
        rank: rank === undefined ? Number.MAX_SAFE_INTEGER : rank,
        relief, waterDistance, score, originDistance,
      });
    }
  }

  const better = (a: Candidate, b: Candidate): boolean => {
    if (a.score !== b.score) return a.score < b.score;
    if (a.originDistance !== b.originDistance) return a.originDistance < b.originDistance;
    if (a.x !== b.x) return a.x < b.x;
    return a.z < b.z;
  };
  const pick = (predicate: (c: Candidate) => boolean): Candidate | null => {
    let best: Candidate | null = null;
    for (const candidate of candidates) {
      if (!predicate(candidate)) continue;
      if (best === null || better(candidate, best)) best = candidate;
    }
    return best;
  };

  const isPreferred = (c: Candidate): boolean => c.rank !== Number.MAX_SAFE_INTEGER;
  const nearWater = (c: Candidate): boolean => c.waterDistance <= waterRadius;
  const chosen =
    pick((c) => isPreferred(c) && nearWater(c) && c.relief <= maxRelief) ??
    pick((c) => isPreferred(c) && nearWater(c) && c.relief <= maxRelief * 3) ??
    pick((c) => isPreferred(c) && nearWater(c)) ??
    pick((c) => nearWater(c) && c.relief <= maxRelief) ??
    pick((c) => nearWater(c)) ??
    pick((c) => isPreferred(c)) ??
    pick(() => true) ?? {
      x: landX, y: landH, z: landZ, biomeId: landBiomeId,
      biome: source.biomeName(landBiomeId), rank: Number.MAX_SAFE_INTEGER,
      relief: 0, waterDistance: NONE, score: NONE, originDistance: 0,
    };

  // ---- 4. local refinement: flattest 1-block column inside the winning grid cell ---------
  let finalX = chosen.x;
  let finalZ = chosen.z;
  let finalH = chosen.y;
  let finalRelief = chosen.relief;
  {
    const half = Math.floor(gridStep / 2);
    let bestRelief = Number.MAX_SAFE_INTEGER;
    let bestDeviation = Number.MAX_SAFE_INTEGER;
    const patch: number[] = [];
    for (let oz = -half; oz <= half; oz++) {
      for (let ox = -half; ox <= half; ox++) {
        patch.push(surfaceAt(chosen.x + ox, chosen.z + oz));
      }
    }
    // relief of a column = max - min over its 8 in-patch neighbours (patch is 3x3 or 5x5)
    const side = half * 2 + 1;
    for (let oz = 0; oz < side; oz++) {
      for (let ox = 0; ox < side; ox++) {
        const h = patch[oz * side + ox];
        if (isWaterHeight(h)) continue;
        let lo = h;
        let hi = h;
        for (let nz = Math.max(0, oz - 1); nz <= Math.min(side - 1, oz + 1); nz++) {
          for (let nx = Math.max(0, ox - 1); nx <= Math.min(side - 1, ox + 1); nx++) {
            const nh = patch[nz * side + nx];
            if (nh < lo) lo = nh;
            if (nh > hi) hi = nh;
          }
        }
        const relief = hi - lo;
        const deviation = Math.abs(h - chosen.y);
        if (relief < bestRelief || (relief === bestRelief && deviation < bestDeviation)) {
          bestRelief = relief;
          bestDeviation = deviation;
          finalX = chosen.x + ox - half;
          finalZ = chosen.z + oz - half;
          finalH = h;
        }
      }
    }
    if (bestRelief === Number.MAX_SAFE_INTEGER) {
      finalX = chosen.x; finalZ = chosen.z; finalH = chosen.y; finalRelief = chosen.relief;
    } else {
      finalRelief = bestRelief;
    }
  }

  return {
    x: finalX,
    y: finalH,
    z: finalZ,
    biome: chosen.biome,
    biomeId: chosen.biomeId,
    preferred: isPreferred(chosen),
    waterDistance: chosen.waterDistance,
    relief: finalRelief,
    score: chosen.score,
    elapsedMs: performance.now() - started,
    columnsSampled,
    biomeQueries,
  };
}

/**
 * Post-generation half of the "not inside a tree canopy" rule, and the only reliable way to
 * measure water distance (the pre-generation estimate can only see ocean/river/swamp water).
 *
 * Returns the nearest column in `maxShift` rings for which `isClear` reports standable ground that
 * is not a tree; the input column is returned unchanged when it is already clear, so calling this
 * unconditionally is safe.
 */
export function refineSpawnColumn(
  x: number,
  z: number,
  isClear: (x: number, z: number) => boolean,
  maxShift = 4,
): { x: number; z: number } {
  if (isClear(x, z)) return { x, z };
  for (let r = 1; r <= maxShift; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isClear(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
  }
  return { x, z };
}

/**
 * Chebyshev distance to the nearest water column, reading real block states (needs the chunks to
 * be loaded). `isWater(x, z)` should look at the column's top block. Used by the post-generation
 * check in the report; `radius` caps the scan so this stays cheap (±radius at 1 block steps).
 */
export function nearestWaterDistance(
  x: number,
  z: number,
  isWater: (x: number, z: number) => boolean,
  radius = 24,
): number {
  let best = NONE;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d >= best) continue;
      if (isWater(x + dx, z + dz)) best = d;
    }
  }
  return best;
}
