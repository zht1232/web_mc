// Port of net.minecraft.world.level.levelgen.NoiseBasedChunkGenerator (the parts a browser
// client needs) plus the wiring that RandomState / NoiseRouterData do on the Java side.
//
// Pipeline for one chunk, in vanilla's order:
//   1. NoiseChunk          - 4x8x4 cell grid, interpolated density, aquifer
//   2. doFill              - per block: final density -> aquifer -> block state (or default)
//   3. fillBiomesFromNoise - climate sampler at 4x4x4 quart resolution
//   4. buildSurface        - SurfaceSystem column pass with the surface rule tree
//   5. recalcHeightmaps
//
// Not ported (see the report for the visual impact):
//   * OreVeinifier  - ore veins are part of fillFromNoise, not of the density graph
//   * carvers       - caves already come from the density function; carvers only add the
//                     "carved" overhangs that 1.18+ expresses in density anyway
//   * Beardifier    - structure pieces do not exist yet at this stage
//   * Blender       - no neighbouring chunks in a fresh world (blend_density is a pass-through)
//   * biome zoom    - surface rules read the raw quart-cell biome (see getBiome)

import { MinecraftData } from '../block/state/BlockState.js';
import { LevelChunk, index as sectionIndex } from '../chunk/LevelChunk.js';
import { mixStafford13, XoroshiroRandomSource } from '../../../core/Random.js';
import type { PositionalRandomFactory } from '../../../core/Random.js';
import { NormalNoise } from './synth/Noise.js';
import { BlendedNoise } from './synth/BlendedNoise.js';
import { SimplexNoise } from './synth/SimplexNoise.js';
import { LegacyRandomSource } from '../../../core/Random.js';
import {
  ColumnCacheDF,
  DensityFunction,
  DensityFunctionFactory,
  DensityNodeJson,
  EndIslands,
  InterpolatedDF,
  Mapped,
  Min,
} from './density/DensityFunction.js';
import { NoiseChunk } from './density/NoiseChunk.js';
import { ChunkBlockAccess } from './ChunkBlockAccess.js';
import {
  buildParameterList,
  ClimateSampler,
  MultiNoiseBiomeSource,
} from './biome/Climate.js';
import { parseSurfaceRule, RuleJson, RuleNode, SurfaceSystem } from './surface/SurfaceRules.js';
import { FluidPicker, FluidStatus } from './aquifer/Aquifer.js';
import { FeatureGenerator } from './feature/FeatureGenerator.js';

const MASK64 = (1n << 64n) - 1n;

/**
 * final_density has the shape `min(squeeze(interpolated(base)), ...)`. Returns that
 * `interpolated` node so NoiseChunk can prove whole cells are air, or null when the graph has
 * a different shape (in which case the optimisation is simply off).
 */
function findSqueezedInterpolator(finalDensity: DensityFunction): InterpolatedDF | null {
  if (!(finalDensity instanceof Min)) return null;
  let node: DensityFunction = finalDensity.argument1;
  if (!(node instanceof Mapped) || node.type !== 'squeeze') return null;
  node = node.input;
  return node instanceof InterpolatedDF ? node : null;
}

// ---------------------------------------------------------------- data shapes

export interface NoiseJson { firstOctave: number; amplitudes: number[] }

export interface BiomeJson {
  id: number;
  name: string;
  temperature: number;
  downfall: number;
  hasPrecipitation: boolean;
  effects?: Record<string, unknown>;
  carvers?: string[];
  features?: string[][];
  spawners?: Record<string, unknown>;
}

export interface BiomeParameterPointsJson {
  source: string;
  note: string;
  rowLayout: string[];
  points: number[][];
}

export interface NoiseSettingsJson {
  aquifers_enabled: boolean;
  disable_mob_generation?: boolean;
  ore_veins_enabled?: boolean;
  legacy_random_source?: boolean;
  default_block: { Name: string; Properties?: Record<string, string> };
  default_fluid: { Name: string; Properties?: Record<string, string> };
  sea_level: number;
  noise: { height: number; min_y: number; size_horizontal: number; size_vertical: number };
  noise_router: Record<string, DensityNodeJson>;
  surface_rule: RuleJson;
  spawn_target?: unknown[];
}

/** The parsed public/mc/worldgen.json. */
export interface WorldgenData {
  noiseSettings: Record<string, NoiseSettingsJson>;
  densityFunctions: Record<string, DensityNodeJson>;
  noises: Record<string, NoiseJson>;
  biomeParameterPoints: BiomeParameterPointsJson;
  biomes: Record<string, BiomeJson> | BiomeJson[];
  /** public/mc/tags.json -> block, attached by loadWorldgenData for feature generation. */
  blockTags?: Record<string, string[]>;
  [key: string]: unknown;
}

/** Loads worldgen.json with fetch (browser) - pass a directory or the .json file itself. */
export async function loadWorldgenData(base = '/mc'): Promise<WorldgenData> {
  const url = base.endsWith('.json') ? base : `${base}/worldgen.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as WorldgenData;
  // Feature decoration needs the block tags (ore replaceables, replaceable_by_trees, ...). It is
  // optional: FeatureGenerator falls back to built-in copies when tags.json is not reachable.
  const dir = base.endsWith('.json') ? base.slice(0, base.lastIndexOf('/')) : base;
  try {
    const tagRes = await fetch(`${dir}/tags.json`);
    if (tagRes.ok) {
      const tags = await tagRes.json() as { block?: Record<string, string[]> };
      data.blockTags = tags.block ?? {};
    }
  } catch { /* optional data: features use the built-in tag table */ }
  return data;
}

// ---------------------------------------------------------------- generator

export interface NoiseChunkGeneratorOptions {
  /** preset key inside `noiseSettings`, defaults to "overworld" */
  preset?: string;
  /** run feature decoration (trees, grass, ore, snow); defaults to true */
  features?: boolean;
}

interface BiomeTable {
  byName: Map<string, number>;
  temperature: Float64Array;
  names: string[];
}

function biomeTable(data: WorldgenData): BiomeTable {
  const list: BiomeJson[] = Array.isArray(data.biomes) ? data.biomes : Object.values(data.biomes);
  let maxId = 0;
  for (const b of list) maxId = Math.max(maxId, b.id);
  const byName = new Map<string, number>();
  const temperature = new Float64Array(maxId + 1).fill(1);
  const names = new Array<string>(maxId + 1).fill('');
  for (const b of list) {
    byName.set(b.name, b.id);
    temperature[b.id] = b.temperature;
    names[b.id] = b.name;
  }
  return { byName, temperature, names };
}

/**
 * Port of NoiseBasedChunkGenerator for the overworld multi-noise preset.
 */
export class NoiseChunkGenerator {
  readonly minY: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly cellWidth: number;
  readonly cellHeight: number;

  private readonly mc: MinecraftData;
  private readonly data: WorldgenData;
  private readonly settings: NoiseSettingsJson;
  private readonly factory: DensityFunctionFactory;
  private readonly noiseChunkFactory: {
    barrier: DensityFunction;
    fluidLevelFloodedness: DensityFunction;
    fluidLevelSpread: DensityFunction;
    lava: DensityFunction;
    erosion: DensityFunction;
    depth: DensityFunction;
  };
  private readonly finalDensity: DensityFunction;
  /** the `interpolated` node inside final_density's `squeeze`, when the graph has that shape */
  private readonly baseInterpolated: InterpolatedDF | null;
  private readonly preliminarySurfaceLevel: DensityFunction;
  private readonly sampler: ClimateSampler;
  private readonly biomeSource: MultiNoiseBiomeSource;
  private readonly biomes: BiomeTable;
  private readonly surface: SurfaceSystem;
  private readonly surfaceRule: RuleNode;
  private readonly aquiferRandom: PositionalRandomFactory;

  private readonly defaultBlock: number;
  private readonly airState: number;
  private readonly fluidPicker: FluidPicker;
  private readonly fluidLookup: {
    air: number;
    water: number;
    lava: number;
    waterBlock: number;
    lavaBlock: number;
    blockIdOf(state: number): number;
  };

  /** heights of the chunks this generator produced, for getSurfaceHeight() */
  private readonly heightCache = new Map<number, Int16Array>();

  /** feature decoration pipeline; null when disabled for tests */
  private readonly featureGenerator: FeatureGenerator | null;

  /** tiny memo for getBiome() (exact position, no hashing) */
  private lastBiomeX = Number.NaN;
  private lastBiomeY = Number.NaN;
  private lastBiomeZ = Number.NaN;
  private lastBiomeId = 0;

  constructor(mc: MinecraftData, data: WorldgenData, seed: bigint, preset = 'overworld', features = true) {
    this.mc = mc;
    this.data = data;
    const key = preset.includes(':') ? preset : `minecraft:${preset}`;
    const settings = data.noiseSettings[preset] ?? data.noiseSettings[key];
    if (!settings) throw new Error(`unknown noise preset ${preset}`);
    this.settings = settings;

    this.minY = settings.noise.min_y;
    this.height = settings.noise.height;
    this.seaLevel = settings.sea_level;
    this.cellWidth = settings.noise.size_horizontal * 4;
    this.cellHeight = settings.noise.size_vertical * 4;

    this.biomes = biomeTable(data);
    this.defaultBlock = mc.stateOf(settings.default_block.Name.replace('minecraft:', ''), settings.default_block.Properties);
    this.airState = mc.stateOf('air');

    // RandomState: settings.getRandomSource().newInstance(seed).forkPositional().
    // Random.ts's one-argument XoroshiroRandomSource has the GOLDEN/SILVER constants swapped
    // relative to RandomSupport.upgradeSeedTo128bit, so the 128 bit upgrade is done here.
    const lowBits = (seed ^ 0x6a09e667f3bcc909n) & MASK64;
    const highBits = (lowBits + 0x9e3779b97f4a7c15n) & MASK64;
    const rootRandom = new XoroshiroRandomSource(mixStafford13(lowBits), mixStafford13(highBits));
    const positional = rootRandom.forkPositional();
    const terrainRandom = positional.fromHashOf('minecraft:terrain');
    this.aquiferRandom = (positional.fromHashOf('minecraft:aquifer') as XoroshiroRandomSource).forkPositional();

    const noises = data.noises;
    const noiseFactory = (id: string): NormalNoise => {
      const params = noises[id];
      if (!params) throw new Error(`missing noise ${id}`);
      return new NormalNoise(positional.fromHashOf(id), params.firstOctave, params.amplitudes);
    };

    this.factory = new DensityFunctionFactory(
      data.densityFunctions,
      noiseFactory,
      (node) => new BlendedNoise(
        terrainRandom, node.xz_scale, node.y_scale, node.xz_factor, node.y_factor, node.smear_scale_multiplier,
      ),
      () => {
        // DensityFunctions.EndIslandDensityFunction(seed)
        const random = new LegacyRandomSource(seed);
        random.consumeCount(17292);
        return new EndIslands(new SimplexNoise(random));
      },
    );

    const router = settings.noise_router;
    const df = (name: string): DensityFunction => {
      const node = router[name];
      if (node === undefined) throw new Error(`noise router has no ${name}`);
      return this.factory.parse(node);
    };

    this.noiseChunkFactory = {
      barrier: df('barrier'),
      fluidLevelFloodedness: df('fluid_level_floodedness'),
      fluidLevelSpread: df('fluid_level_spread'),
      lava: df('lava'),
      erosion: df('erosion'),
      depth: df('depth'),
    };
    this.finalDensity = df('final_density');
    this.preliminarySurfaceLevel = df('preliminary_surface_level');
    this.baseInterpolated = findSqueezedInterpolator(this.finalDensity);

    // The climate sampler is evaluated once per 4x4x4 quart cell (1536 times per chunk), but
    // five of its six inputs are y-independent (temperature/vegetation are shifted noise with
    // y_scale 0, the rest are already cached upstream). Vanilla gets the same short circuit out
    // of its FlatCache wrappers; caching per (x, z) here is exactly equivalent.
    const colCache = (fn: DensityFunction): DensityFunction => new ColumnCacheDF('cache_2d', fn);
    this.sampler = new ClimateSampler(
      colCache(df('temperature')), colCache(df('vegetation')), colCache(df('continents')),
      colCache(df('erosion')), df('depth'), colCache(df('ridges')),
    );
    this.biomeSource = new MultiNoiseBiomeSource(
      buildParameterList(data.biomeParameterPoints.rowLayout, data.biomeParameterPoints.points),
    );

    // createFluidPicker
    const lavaState = mc.stateOf('lava');
    const waterState = mc.stateOf(settings.default_fluid.Name.replace('minecraft:', ''), settings.default_fluid.Properties);
    const lavaStatus = new FluidStatus(-54, lavaState);
    const seaStatus = new FluidStatus(this.seaLevel, waterState);
    this.fluidPicker = {
      computeFluid: (_x: number, y: number, _z: number) => (y < Math.min(-54, this.seaLevel) ? lavaStatus : seaStatus),
    };
    this.fluidLookup = {
      air: this.airState,
      water: waterState,
      lava: lavaState,
      waterBlock: mc.blockIdOf(waterState),
      lavaBlock: mc.blockIdOf(lavaState),
      blockIdOf: (state: number) => mc.blockIdOf(state),
    };

    this.surface = new SurfaceSystem({
      mc,
      seaLevel: this.seaLevel,
      defaultBlockName: settings.default_block.Name.replace('minecraft:', ''),
      noiseRandom: positional,
      noise: (id) => this.factory.noise(id),
      minGenY: this.minY,
      genDepth: this.height,
      biomeIdsByName: this.biomes.byName,
      biomeTemperature: (id) => (id < this.biomes.temperature.length ? this.biomes.temperature[id] : 1),
      erodedBadlandsId: this.biomes.byName.get('minecraft:eroded_badlands') ?? -1,
      frozenOceanIds: new Set([
        this.biomes.byName.get('minecraft:frozen_ocean') ?? -1,
        this.biomes.byName.get('minecraft:deep_frozen_ocean') ?? -1,
      ]),
    });
    this.surfaceRule = parseSurfaceRule(settings.surface_rule, mc);

    this.featureGenerator = features
      ? new FeatureGenerator(mc, data, seed, { getBiome: (x, y, z) => this.getBiome(x, y, z) })
      : null;
  }

  get seaLevelY(): number { return this.seaLevel; }

  /** Fills one chunk: block states, biomes, surface rules and heightmaps. */
  generateChunk(chunk: LevelChunk): void {
    if (chunk.minY !== this.minY || chunk.height !== this.height) {
      throw new Error(`chunk height ${chunk.minY}/${chunk.height} does not match the noise settings`);
    }

    const noiseChunk = new NoiseChunk(
      this.factory.interpolated,
      {
        minY: this.minY,
        height: this.height,
        cellWidth: this.cellWidth,
        cellHeight: this.cellHeight,
        chunkX: chunk.x,
        chunkZ: chunk.z,
        aquifersEnabled: this.settings.aquifers_enabled,
        defaultBlock: this.defaultBlock,
        airAboveY: Math.max(this.seaLevel - 1, this.minY),
        airProbeNode: this.baseInterpolated,
        fluidPicker: this.fluidPicker,
        fluidLookup: this.fluidLookup,
        aquiferRandom: this.aquiferRandom,
      },
      this.preliminarySurfaceLevel,
      this.finalDensity,
      this.noiseChunkFactory,
      () => this.factory.resetCaches(),
    );

    const access = new ChunkBlockAccess(chunk);
    noiseChunk.fillInterpolators();
    const wgHeight = this.fillBlocks(chunk, noiseChunk, access);
    noiseChunk.release();

    this.fillBiomes(chunk);
    this.surface.buildSurface(chunk, wgHeight, noiseChunk, this.surfaceRule, access);

    // Feature decoration (trees, grass, flowers, ore, springs, snow). It runs after the surface
    // rules and before the final recalcHeightmaps; FeatureGenerator primes the heightmaps itself.
    if (this.featureGenerator) {
      this.featureGenerator.generate(chunk, (x, z) => this.getSurfaceHeight(x, z) + 1);
    }
    chunk.recalcHeightmaps();

    this.heightCache.set(this.chunkKey(chunk.x, chunk.z), chunk.surfaceHeight.slice());
  }

  private chunkKey(x: number, z: number): number {
    return (x + 32768) * 65536 + (z + 32768);
  }

  /**
   * Port of NoiseBasedChunkGenerator.doFill: walks the cell grid exactly like vanilla, so the
   * interpolators are selected/incremented in vanilla's order.
   */
  private fillBlocks(chunk: LevelChunk, noiseChunk: NoiseChunk, access: ChunkBlockAccess): Int16Array {
    const ctx = noiseChunk.ctx;
    const cellCountXZ = noiseChunk.cellCountXZ;
    const cellCountY = noiseChunk.cellCountY;
    const cellHeight = noiseChunk.cellHeight;
    const cellWidth = noiseChunk.cellWidth;
    const chunkMinX = chunk.x * 16;
    const chunkMinZ = chunk.z * 16;
    const cellMinY = noiseChunk.cellNoiseMinY;
    const wgHeight = new Int16Array(256).fill(this.minY - 1);

    for (let cellXIndex = 0; cellXIndex < cellCountXZ; cellXIndex++) {
      for (let cellZIndex = 0; cellZIndex < cellCountXZ; cellZIndex++) {
        for (let cellYIndex = cellCountY - 1; cellYIndex >= 0; cellYIndex--) {
          const cellStartBlockY = (cellYIndex + cellMinY) * cellHeight;
          noiseChunk.beginCell(cellXIndex, cellYIndex, cellZIndex);
          if (noiseChunk.trySkipAirCell(cellStartBlockY)) continue;
          for (let yInCell = cellHeight - 1; yInCell >= 0; yInCell--) {
            const blockY = cellStartBlockY + yInCell;
            noiseChunk.updateY(yInCell / cellHeight);
            for (let xInCell = 0; xInCell < cellWidth; xInCell++) {
              const localX = cellXIndex * cellWidth + xInCell;
              noiseChunk.updateX(xInCell / cellWidth);
              for (let zInCell = 0; zInCell < cellWidth; zInCell++) {
                const localZ = cellZIndex * cellWidth + zInCell;
                noiseChunk.updateZ(zInCell / cellWidth);
                ctx.blockX = chunkMinX + localX;
                ctx.blockY = blockY;
                ctx.blockZ = chunkMinZ + localZ;
                const density = noiseChunk.computeDensity();
                const state = noiseChunk.computeState(density);
                if (state !== this.airState) {
                  access.set(localX, blockY, localZ, state);
                  const column = (localZ << 4) | localX;
                  if (blockY > wgHeight[column]) wgHeight[column] = blockY;
                }
              }
            }
          }
        }
      }
    }
    return wgHeight;
  }

  /** Port of ChunkAccess.fillBiomesFromNoise at 4x4x4 quart resolution. */
  private fillBiomes(chunk: LevelChunk): void {
    const qMinY = this.minY >> 2;
    const qMaxY = (this.minY + this.height - 1) >> 2;
    const baseQuartX = chunk.x * 4;
    const baseQuartZ = chunk.z * 4;
    const cellCountY = qMaxY - qMinY + 1;

    // 4 x 4 quart columns per chunk, cellCountY quart layers.
    const ids = new Uint8Array(4 * cellCountY * 4);
    for (let qx = 0; qx < 4; qx++) {
      for (let qz = 0; qz < 4; qz++) {
        for (let iy = 0; iy < cellCountY; iy++) {
          const biome = this.biomeSource.getNoiseBiome(baseQuartX + qx, qMinY + iy, baseQuartZ + qz, this.sampler);
          ids[(iy * 4 + qz) * 4 + qx] = biome & 0xff;
        }
      }
    }

    const minY = this.minY;
    for (let y = minY; y < minY + this.height; y++) {
      const iy = (y >> 2) - qMinY;
      const sectionY = y >> 4;
      const section = chunk.getOrCreateSection(sectionY);
      const localY = y & 15;
      for (let qz = 0; qz < 4; qz++) {
        for (let qx = 0; qx < 4; qx++) {
          const biome = ids[(iy * 4 + qz) * 4 + qx];
          for (let dz = 0; dz < 4; dz++) {
            const z = qz * 4 + dz;
            for (let dx = 0; dx < 4; dx++) {
              const x = qx * 4 + dx;
              const idx = sectionIndex(x, localY, z);
              if (section.biomes.get(idx) !== biome) section.biomes.set(idx, biome);
            }
          }
        }
      }
    }
  }

  /** Biome id (0..65) at world coordinates. */
  getBiome(x: number, y: number, z: number): number {
    if (x === this.lastBiomeX && y === this.lastBiomeY && z === this.lastBiomeZ) return this.lastBiomeId;
    const id = this.biomeSource.getNoiseBiomeAtTarget(this.sampler.sample(x >> 2, y >> 2, z >> 2));
    this.lastBiomeX = x;
    this.lastBiomeY = y;
    this.lastBiomeZ = z;
    this.lastBiomeId = id;
    return id;
  }

  /** Highest non-air y for a column: exact for generated chunks, preliminary otherwise. */
  getSurfaceHeight(x: number, z: number): number {
    const cached = this.heightCache.get(this.chunkKey(x >> 4, z >> 4));
    if (cached) return cached[((z & 15) << 4) | (x & 15)];
    return Math.floor(this.preliminarySurfaceLevel.compute({
      blockX: x, blockY: 0, blockZ: z,
    }));
  }

  /** Biome name for an id (0..65); handy for the renderer/debug overlay. */
  biomeName(id: number): string {
    return this.biomes.names[id] ?? '';
  }

  /** The density function graph, exposed for debugging/tests. */
  densityFunction(name: string): DensityFunction {
    return this.factory.get(name);
  }
}
