// Port of net.minecraft.world.level.levelgen.SurfaceRules + SurfaceSystem.
//
// The JSON rule tree is parsed once into a small AST (with block states already resolved),
// then instantiated per chunk into closures. That mirrors vanilla (`ruleSource.apply(context)`
// builds one rule tree per chunk) because every condition carries its own "last update"
// cache which has to be per chunk:
//   - LazyXZCondition caches per column      (biome, steep, hole)
//   - LazyYCondition  caches per block row   (stone_depth, water, y_above, temperature, ...)
// Without those caches the biome lookups and surface noise samples would run 384 times per
// column instead of once.

import type { NormalNoise } from '../synth/Noise.js';
import { LegacyRandomSource } from '../../../../core/Random.js';
import type { PositionalRandomFactory, RandomSource } from '../../../../core/Random.js';
import { XoroshiroRandomSource } from '../../../../core/Random.js';
import type { MinecraftData } from '../../block/state/BlockState.js';
import { index as sectionIndex } from '../../chunk/LevelChunk.js';
import type { LevelChunk } from '../../chunk/LevelChunk.js';
import type { ChunkBlockAccess } from '../ChunkBlockAccess.js';
import type { NoiseChunk } from '../density/NoiseChunk.js';
import { SimplexNoise } from '../synth/SimplexNoise.js';

const MIN_VALUE = -2147483648;

// ---------------------------------------------------------------- JSON AST

export interface VerticalAnchorJson { absolute?: number; above_bottom?: number; below_top?: number }

export interface ConditionJson {
  type: string;
  biome_is?: string | string[];
  noise?: string;
  min_threshold?: number;
  max_threshold?: number;
  is_3d?: boolean;
  random_name?: string;
  true_at_and_below?: VerticalAnchorJson;
  false_at_and_above?: VerticalAnchorJson;
  anchor?: VerticalAnchorJson;
  surface_depth_multiplier?: number;
  add_stone_depth?: boolean;
  offset?: number;
  invert?: ConditionJson;
  add_surface_depth?: boolean;
  secondary_depth_range?: number;
  surface_type?: 'floor' | 'ceiling';
}

export type RuleJson =
  | { type: 'minecraft:block'; result_state: { Name: string; Properties?: Record<string, string> } }
  | { type: 'minecraft:sequence'; sequence: RuleJson[] }
  | { type: 'minecraft:condition'; if_true: ConditionJson; then_run: RuleJson }
  | { type: 'minecraft:bandlands' }
  | { type: string };

/** Parsed rule node; block states are resolved once, at parse time. */
export type RuleNode =
  | { kind: 'block'; state: number }
  | { kind: 'sequence'; rules: RuleNode[] }
  | { kind: 'condition'; condition: ConditionJson; thenRun: RuleNode }
  | { kind: 'bandlands' };

/** A rule instance bound to one chunk's context. */
export interface SurfaceRule {
  /** returns a block state id, or null when this rule does not apply */
  tryApply(): number | null;
}

export interface SurfaceCondition {
  test(): boolean;
}

/** "minecraft:grass_block" -> "grass_block" (blocks.json uses plain ids) */
export function blockId(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function lower(type: string): string {
  return type.startsWith('minecraft:') ? type.slice('minecraft:'.length) : type;
}

/** Parses the JSON rule tree once. */
export function parseSurfaceRule(json: RuleJson, mc: MinecraftData): RuleNode {
  const type = lower(json.type);
  if (type === 'block') {
    const st = (json as { result_state: { Name: string; Properties?: Record<string, string> } }).result_state;
    return { kind: 'block', state: mc.stateOf(blockId(st.Name), st.Properties) };
  }
  if (type === 'sequence') {
    const seq = (json as { sequence: RuleJson[] }).sequence;
    return { kind: 'sequence', rules: seq.map((r) => parseSurfaceRule(r, mc)) };
  }
  if (type === 'condition') {
    const c = json as { if_true: ConditionJson; then_run: RuleJson };
    return { kind: 'condition', condition: c.if_true, thenRun: parseSurfaceRule(c.then_run, mc) };
  }
  if (type === 'bandlands') return { kind: 'bandlands' };
  throw new Error(`unsupported surface rule ${json.type}`);
}

// ---------------------------------------------------------------- anchors

export interface Anchor { kind: 'absolute' | 'above_bottom' | 'below_top'; value: number }

function resolveAnchor(anchor: VerticalAnchorJson | undefined): Anchor {
  if (anchor?.absolute !== undefined) return { kind: 'absolute', value: anchor.absolute };
  if (anchor?.above_bottom !== undefined) return { kind: 'above_bottom', value: anchor.above_bottom };
  if (anchor?.below_top !== undefined) return { kind: 'below_top', value: anchor.below_top };
  return { kind: 'absolute', value: 0 };
}

function anchorY(anchor: Anchor, minGenY: number, genDepth: number): number {
  switch (anchor.kind) {
    case 'absolute': return anchor.value;
    case 'above_bottom': return minGenY + anchor.value;
    case 'below_top': return genDepth - 1 + minGenY - anchor.value;
  }
}

// ---------------------------------------------------------------- conditions

abstract class LazyCondition implements SurfaceCondition {
  private lastUpdate = -2;
  private result = false;
  constructor(protected readonly ctx: SurfaceContext) {}

  test(): boolean {
    const update = this.updateCounter();
    if (update !== this.lastUpdate) {
      this.lastUpdate = update;
      this.result = this.compute();
    }
    return this.result;
  }

  protected abstract updateCounter(): number;
  protected abstract compute(): boolean;
}

abstract class LazyXZCondition extends LazyCondition {
  protected updateCounter(): number { return this.ctx.xzUpdate; }
}

abstract class LazyYCondition extends LazyCondition {
  protected updateCounter(): number { return this.ctx.yUpdate; }
}

/** Port of SurfaceRules.Context: the per-chunk state the condition tree reads. */
export class SurfaceContext {
  xzUpdate = 0;
  yUpdate = 0;
  blockX = 0;
  blockY = 0;
  blockZ = 0;
  surfaceDepth = 0;
  waterHeight = MIN_VALUE;
  stoneDepthAbove = 0;
  stoneDepthBelow = 0;

  private biomeId = -1;
  private biomeY = Number.NaN;
  private lastSurfaceSecondaryUpdate = -2;
  private surfaceSecondaryValue = 0;
  private lastMinSurfaceLevelUpdate = -2;
  private minSurfaceLevelValue = 0;
  private lastPreliminaryCell = Number.NaN;
  private readonly preliminaryCorners = [0, 0, 0, 0];
  private readonly samplers2d = new Map<string, { last: number; value: number }>();
  private readonly samplers3d = new Map<string, { last: number; value: number }>();
  private readonly randomFactories = new Map<string, PositionalRandomFactory>();

  constructor(
    private readonly system: SurfaceSystem,
    private readonly chunk: LevelChunk,
    private readonly access: ChunkBlockAccess,
    private readonly wgHeight: Int16Array,
    private readonly noiseChunk: NoiseChunk,
    private readonly minGenY: number,
    private readonly genDepth: number,
  ) {}

  updateXZ(blockX: number, blockZ: number): void {
    this.xzUpdate++;
    this.yUpdate++;
    this.blockX = blockX;
    this.blockZ = blockZ;
    this.surfaceDepth = this.system.getSurfaceDepth(blockX, blockZ);
  }

  updateY(stoneDepthAbove: number, stoneDepthBelow: number, waterHeight: number, blockY: number): void {
    this.yUpdate++;
    this.blockY = blockY;
    this.waterHeight = waterHeight;
    this.stoneDepthBelow = stoneDepthBelow;
    this.stoneDepthAbove = stoneDepthAbove;
  }

  /**
   * SurfaceRules.Context.getBiome. Vanilla reads it through BiomeManager -> WorldGenRegion,
   * i.e. out of the chunk's (already filled) biome container, not by re-running the climate
   * search. Our container stores the biome per block, so this is a plain palette read.
   */
  getBiome(): number {
    // The biome is constant inside one 4x4x4 quart cell (that is the granularity vanilla
    // stores it at), so caching on blockY >> 2 is exact and saves three quarter of the reads.
    const qy = this.blockY >> 2;
    if (qy !== this.biomeY) {
      this.biomeY = qy;
      const section = this.chunk.getSection(this.blockY >> 4);
      this.biomeId = section
        ? section.biomes.get(sectionIndex(this.blockX & 15, this.blockY & 15, this.blockZ & 15))
        : 0;
    }
    return this.biomeId;
  }

  getSeaLevel(): number { return this.system.seaLevel; }

  getSurfaceSecondary(): number {
    if (this.lastSurfaceSecondaryUpdate !== this.xzUpdate) {
      this.lastSurfaceSecondaryUpdate = this.xzUpdate;
      this.surfaceSecondaryValue = this.system.getSurfaceSecondary(this.blockX, this.blockZ);
    }
    return this.surfaceSecondaryValue;
  }

  getMinSurfaceLevel(): number {
    if (this.lastMinSurfaceLevelUpdate !== this.xzUpdate) {
      this.lastMinSurfaceLevelUpdate = this.xzUpdate;
      const cellX = this.blockX >> 4;
      const cellZ = this.blockZ >> 4;
      const key = (cellX + 33554432) * 67108864 + (cellZ + 33554432);
      if (key !== this.lastPreliminaryCell) {
        this.lastPreliminaryCell = key;
        this.preliminaryCorners[0] = this.noiseChunk.preliminarySurfaceLevel(cellX << 4, cellZ << 4);
        this.preliminaryCorners[1] = this.noiseChunk.preliminarySurfaceLevel((cellX + 1) << 4, cellZ << 4);
        this.preliminaryCorners[2] = this.noiseChunk.preliminarySurfaceLevel(cellX << 4, (cellZ + 1) << 4);
        this.preliminaryCorners[3] = this.noiseChunk.preliminarySurfaceLevel((cellX + 1) << 4, (cellZ + 1) << 4);
      }
      const fx = (this.blockX & 15) / 16;
      const fz = (this.blockZ & 15) / 16;
      const y0 = this.preliminaryCorners[0] + fx * (this.preliminaryCorners[1] - this.preliminaryCorners[0]);
      const y1 = this.preliminaryCorners[2] + fx * (this.preliminaryCorners[3] - this.preliminaryCorners[2]);
      const preliminary = Math.floor(y0 + fz * (y1 - y0));
      this.minSurfaceLevelValue = preliminary + this.surfaceDepth - 8;
    }
    return this.minSurfaceLevelValue;
  }

  getNoise2d(id: string): number {
    let s = this.samplers2d.get(id);
    if (s === undefined) { s = { last: -2, value: 0 }; this.samplers2d.set(id, s); }
    if (s.last !== this.xzUpdate) {
      s.last = this.xzUpdate;
      s.value = this.system.noise(id).getValue(this.blockX, 0, this.blockZ);
    }
    return s.value;
  }

  getNoise3d(id: string): number {
    let s = this.samplers3d.get(id);
    if (s === undefined) { s = { last: -2, value: 0 }; this.samplers3d.set(id, s); }
    if (s.last !== this.yUpdate) {
      s.last = this.yUpdate;
      s.value = this.system.noise(id).getValue(this.blockX, this.blockY, this.blockZ);
    }
    return s.value;
  }

  /** SurfaceRules.Context.SteepMaterialCondition: a >= 4 block step within the chunk. */
  isSteep(): boolean {
    const lx = this.blockX & 15;
    const lz = this.blockZ & 15;
    const zNorth = Math.max(lz - 1, 0);
    const zSouth = Math.min(lz + 1, 15);
    const heightNorth = this.wgHeight[(zNorth << 4) | lx];
    const heightSouth = this.wgHeight[(zSouth << 4) | lx];
    if (heightSouth >= heightNorth + 4) return true;
    const xWest = Math.max(lx - 1, 0);
    const xEast = Math.min(lx + 1, 15);
    const heightWest = this.wgHeight[(lz << 4) | xWest];
    const heightEast = this.wgHeight[(lz << 4) | xEast];
    return heightWest >= heightEast + 4;
  }

  isColdEnoughToSnow(): boolean {
    return this.system.coldEnoughToSnow(this.getBiome(), this.blockX, this.blockY, this.blockZ);
  }

  /** SurfaceRules.Context.getOrCreateRandomFactory(name).at(x, y, z) */
  randomAt(name: string): RandomSource {
    let factory = this.randomFactories.get(name);
    if (!factory) {
      factory = this.system.randomFactory(name);
      this.randomFactories.set(name, factory);
    }
    return factory.at(this.blockX, this.blockY, this.blockZ);
  }
}

// ---------------------------------------------------------------- compilation

function compileCondition(
  json: ConditionJson, ctx: SurfaceContext,
  minGenY: number, genDepth: number, biomeIds: Map<string, number>,
): SurfaceCondition {
  const type = lower(json.type);
  switch (type) {
    case 'above_preliminary_surface':
      return { test: () => ctx.blockY >= ctx.getMinSurfaceLevel() };

    case 'biome': {
      const names = Array.isArray(json.biome_is) ? json.biome_is : json.biome_is ? [json.biome_is] : [];
      const ids = new Set<number>();
      for (const n of names) {
        const id = biomeIds.get(n);
        if (id !== undefined) ids.add(id);
      }
      if (ids.size === 0) return { test: () => false };
      return new (class extends LazyYCondition {
        protected compute(): boolean { return ids.has(ctx.getBiome()); }
      })(ctx);
    }

    case 'noise_threshold': {
      const noiseId = json.noise ?? '';
      const min = json.min_threshold ?? -Infinity;
      const max = json.max_threshold ?? Infinity;
      if (json.is_3d ?? false) {
        return new (class extends LazyYCondition {
          protected compute(): boolean {
            const v = ctx.getNoise3d(noiseId);
            return v >= min && v <= max;
          }
        })(ctx);
      }
      return new (class extends LazyXZCondition {
        protected compute(): boolean {
          const v = ctx.getNoise2d(noiseId);
          return v >= min && v <= max;
        }
      })(ctx);
    }

    case 'vertical_gradient': {
      const trueAt = anchorY(resolveAnchor(json.true_at_and_below), minGenY, genDepth);
      const falseAt = anchorY(resolveAnchor(json.false_at_and_above), minGenY, genDepth);
      const name = json.random_name ?? 'minecraft:bedrock_floor';
      return new (class extends LazyYCondition {
        protected compute(): boolean {
          const y = ctx.blockY;
          if (y <= trueAt) return true;
          if (y >= falseAt) return false;
          const probability = (falseAt - y) / (falseAt - trueAt);
          return ctx.randomAt(name).nextFloat() < probability;
        }
      })(ctx);
    }

    case 'y_above': {
      const y = anchorY(resolveAnchor(json.anchor), minGenY, genDepth);
      const mult = json.surface_depth_multiplier ?? 0;
      const addStoneDepth = json.add_stone_depth ?? false;
      return new (class extends LazyYCondition {
        protected compute(): boolean {
          return ctx.blockY + (addStoneDepth ? ctx.stoneDepthAbove : 0) >= y + ctx.surfaceDepth * mult;
        }
      })(ctx);
    }

    case 'water': {
      const offset = json.offset ?? 0;
      const mult = json.surface_depth_multiplier ?? 0;
      const addStoneDepth = json.add_stone_depth ?? false;
      return new (class extends LazyYCondition {
        protected compute(): boolean {
          return ctx.waterHeight === MIN_VALUE
            || ctx.blockY + (addStoneDepth ? ctx.stoneDepthAbove : 0)
              >= ctx.waterHeight + offset + ctx.surfaceDepth * mult;
        }
      })(ctx);
    }

    case 'temperature':
      return new (class extends LazyYCondition {
        protected compute(): boolean { return ctx.isColdEnoughToSnow(); }
      })(ctx);

    case 'steep':
      return new (class extends LazyXZCondition {
        protected compute(): boolean { return ctx.isSteep(); }
      })(ctx);

    case 'hole':
      return new (class extends LazyXZCondition {
        protected compute(): boolean { return ctx.surfaceDepth <= 0; }
      })(ctx);

    case 'not': {
      const target = compileCondition(json.invert as ConditionJson, ctx, minGenY, genDepth, biomeIds);
      return { test: () => !target.test() };
    }

    case 'stone_depth': {
      const offset = json.offset ?? 0;
      const addSurfaceDepth = json.add_surface_depth ?? false;
      const secondaryDepthRange = json.secondary_depth_range ?? 0;
      const ceiling = (json.surface_type ?? 'floor') === 'ceiling';
      return new (class extends LazyYCondition {
        protected compute(): boolean {
          const stoneDepth = ceiling ? ctx.stoneDepthBelow : ctx.stoneDepthAbove;
          const sd = addSurfaceDepth ? ctx.surfaceDepth : 0;
          const secondary = secondaryDepthRange === 0
            ? 0
            : Math.trunc(((ctx.getSurfaceSecondary() + 1) / 2) * secondaryDepthRange);
          return stoneDepth <= 1 + offset + sd + secondary;
        }
      })(ctx);
    }

    default:
      throw new Error(`unsupported surface condition ${json.type}`);
  }
}

function compileRule(
  node: RuleNode, ctx: SurfaceContext, system: SurfaceSystem,
  minGenY: number, genDepth: number, biomeIds: Map<string, number>,
): SurfaceRule {
  switch (node.kind) {
    case 'block': {
      const state = node.state;
      return { tryApply: () => state };
    }
    case 'sequence': {
      const rules = node.rules.map((r) => compileRule(r, ctx, system, minGenY, genDepth, biomeIds));
      return {
        tryApply(): number | null {
          for (const r of rules) {
            const s = r.tryApply();
            if (s !== null) return s;
          }
          return null;
        },
      };
    }
    case 'condition': {
      const condition = compileCondition(node.condition, ctx, minGenY, genDepth, biomeIds);
      const thenRun = compileRule(node.thenRun, ctx, system, minGenY, genDepth, biomeIds);
      return { tryApply: () => (condition.test() ? thenRun.tryApply() : null) };
    }
    case 'bandlands':
      return { tryApply: () => system.getBand(ctx.blockX, ctx.blockY, ctx.blockZ) };
  }
}

// ---------------------------------------------------------------- rule analysis

/**
 * Splits the top level of the rule tree into the part gated by
 * `above_preliminary_surface` (= "y >= minSurfaceLevel") and the part that is not, and
 * computes the highest y at which the ungated part can still match.
 *
 * Every condition we know how to bound is bounded from above; anything unbounded returns
 * Infinity, which makes the split fall back to vanilla's "walk the whole column" behaviour.
 * For the shipped overworld data the ungated part is exactly
 *   [vertical_gradient -> bedrock, vertical_gradient -> deepslate]
 * so the deep pass only has to visit y in [-64, 7].
 */
interface RuleLayout {
  readonly shallow: RuleNode;
  readonly deep: RuleNode;
  /** highest y at which `deep` can produce a block; -Infinity when it never can */
  readonly deepCeiling: number;
  /** true when `deep` only contains vertical_gradient gates, so column state is unused */
  readonly deepNeedsColumnState: boolean;
}

function conditionCeiling(c: ConditionJson, minGenY: number, genDepth: number): number {
  if (lower(c.type) === 'vertical_gradient') {
    return anchorY(resolveAnchor(c.false_at_and_above), minGenY, genDepth) - 1;
  }
  return Infinity;
}

function ruleCeiling(node: RuleNode, minGenY: number, genDepth: number): number {
  switch (node.kind) {
    case 'block':
    case 'bandlands':
      return Infinity;
    case 'sequence': {
      let max = -Infinity;
      for (const r of node.rules) max = Math.max(max, ruleCeiling(r, minGenY, genDepth));
      return max;
    }
    case 'condition':
      return Math.min(conditionCeiling(node.condition, minGenY, genDepth), ruleCeiling(node.thenRun, minGenY, genDepth));
  }
}

/** True when every condition in the subtree is a vertical_gradient (state free). */
function isStateFree(node: RuleNode): boolean {
  switch (node.kind) {
    case 'block':
    case 'bandlands':
      return true;
    case 'sequence':
      return node.rules.every(isStateFree);
    case 'condition':
      return lower(node.condition.type) === 'vertical_gradient' && isStateFree(node.thenRun);
  }
}

function containsAbovePreliminary(node: RuleNode): boolean {
  switch (node.kind) {
    case 'block':
    case 'bandlands':
      return false;
    case 'sequence':
      return node.rules.some(containsAbovePreliminary);
    case 'condition':
      return lower(node.condition.type) === 'above_preliminary_surface'
        || containsAbovePreliminary(node.thenRun);
  }
}

export function analyzeRule(node: RuleNode, minGenY: number, genDepth: number): RuleLayout {
  const unsplittable: RuleLayout = {
    shallow: node, deep: node, deepCeiling: Infinity, deepNeedsColumnState: true,
  };
  if (node.kind !== 'sequence') return unsplittable;

  const shallow: RuleNode[] = [];
  const deep: RuleNode[] = [];
  for (const r of node.rules) {
    const gated = r.kind === 'condition' && lower(r.condition.type) === 'above_preliminary_surface';
    if (gated) { shallow.push(r); continue; }
    if (containsAbovePreliminary(r)) return unsplittable;
    shallow.push(r);
    deep.push(r);
  }
  const deepNode: RuleNode = deep.length === 1 ? deep[0] : { kind: 'sequence', rules: deep };
  return {
    shallow: { kind: 'sequence', rules: shallow },
    deep: deepNode,
    deepCeiling: deep.length === 0 ? -Infinity : ruleCeiling(deepNode, minGenY, genDepth),
    deepNeedsColumnState: !deep.every(isStateFree),
  };
}

// ---------------------------------------------------------------- surface system

export interface SurfaceSystemOptions {
  readonly mc: MinecraftData;
  readonly seaLevel: number;
  readonly defaultBlockName: string;
  readonly noiseRandom: PositionalRandomFactory;
  readonly noise: (id: string) => NormalNoise;
  readonly minGenY: number;
  readonly genDepth: number;
  readonly biomeIdsByName: Map<string, number>;
  readonly biomeTemperature: (id: number) => number;
  readonly erodedBadlandsId: number;
  readonly frozenOceanIds: ReadonlySet<number>;
}

/**
 * Port of SurfaceSystem: owns the band/clay noises, the surface depth noises, the badlands
 * and frozen-ocean special cases, and runs the per-column top-down rule pass.
 */
export class SurfaceSystem {
  readonly seaLevel: number;
  private readonly mc: MinecraftData;
  private readonly defaultBlock: number;
  private readonly defaultBlockId: number;
  private readonly waterBlockId: number;
  private readonly noiseRandom: PositionalRandomFactory;
  private readonly noiseFactory: (id: string) => NormalNoise;
  private readonly minGenY: number;
  private readonly genDepth: number;
  private readonly biomeIdsByName: Map<string, number>;
  private readonly biomeTemp: (id: number) => number;
  private readonly erodedBadlandsId: number;
  private readonly frozenOceanIds: ReadonlySet<number>;

  private readonly surfaceNoise: NormalNoise;
  private readonly surfaceSecondaryNoise: NormalNoise;
  private readonly clayBandsOffsetNoise: NormalNoise;
  private readonly badlandsPillarNoise: NormalNoise;
  private readonly badlandsPillarRoofNoise: NormalNoise;
  private readonly badlandsSurfaceNoise: NormalNoise;
  private readonly icebergPillarNoise: NormalNoise;
  private readonly icebergPillarRoofNoise: NormalNoise;
  private readonly icebergSurfaceNoise: NormalNoise;
  private readonly clayBands: number[];
  /** Biome.TEMPERATURE_NOISE: a single simplex octave seeded with 1234. */
  private readonly temperatureNoise: SimplexNoise;

  private readonly packedIce: number;
  private readonly snowBlock: number;
  private readonly randomFactories = new Map<string, PositionalRandomFactory>();

  constructor(opts: SurfaceSystemOptions) {
    this.mc = opts.mc;
    this.seaLevel = opts.seaLevel;
    this.noiseRandom = opts.noiseRandom;
    this.noiseFactory = opts.noise;
    this.minGenY = opts.minGenY;
    this.genDepth = opts.genDepth;
    this.biomeIdsByName = opts.biomeIdsByName;
    this.biomeTemp = opts.biomeTemperature;
    this.erodedBadlandsId = opts.erodedBadlandsId;
    this.frozenOceanIds = opts.frozenOceanIds;

    this.defaultBlock = opts.mc.stateOf(opts.defaultBlockName);
    this.defaultBlockId = opts.mc.blockIdOf(this.defaultBlock);
    this.waterBlockId = opts.mc.blockIdOf(opts.mc.stateOf('water'));

    this.surfaceNoise = opts.noise('minecraft:surface');
    this.surfaceSecondaryNoise = opts.noise('minecraft:surface_secondary');
    this.clayBandsOffsetNoise = opts.noise('minecraft:clay_bands_offset');
    this.badlandsPillarNoise = opts.noise('minecraft:badlands_pillar');
    this.badlandsPillarRoofNoise = opts.noise('minecraft:badlands_pillar_roof');
    this.badlandsSurfaceNoise = opts.noise('minecraft:badlands_surface');
    this.icebergPillarNoise = opts.noise('minecraft:iceberg_pillar');
    this.icebergPillarRoofNoise = opts.noise('minecraft:iceberg_pillar_roof');
    this.icebergSurfaceNoise = opts.noise('minecraft:iceberg_surface');

    this.clayBands = this.generateBands(opts.noiseRandom.fromHashOf('minecraft:clay_bands'));
    this.temperatureNoise = new SimplexNoise(new LegacyRandomSource(1234n));
    this.packedIce = opts.mc.stateOf('packed_ice');
    this.snowBlock = opts.mc.stateOf('snow_block');
  }

  noise(id: string): NormalNoise { return this.noiseFactory(id); }

  /** RandomState.getOrCreateRandomFactory(name) */
  randomFactory(name: string): PositionalRandomFactory {
    let f = this.randomFactories.get(name);
    if (!f) {
      // RandomSource does not expose forkPositional(), but every generator-side source is an
      // xoroshiro source (RandomState builds the factories from XoroshiroRandomSource).
      f = (this.noiseRandom.fromHashOf(name) as XoroshiroRandomSource).forkPositional();
      this.randomFactories.set(name, f);
    }
    return f;
  }

  getSurfaceDepth(blockX: number, blockZ: number): number {
    const v = this.surfaceNoise.getValue(blockX, 0, blockZ);
    return Math.trunc(v * 2.75 + 3 + this.noiseRandom.at(blockX, 0, blockZ).nextDouble() * 0.25);
  }

  getSurfaceSecondary(blockX: number, blockZ: number): number {
    return this.surfaceSecondaryNoise.getValue(blockX, 0, blockZ);
  }

  getBand(worldX: number, y: number, worldZ: number): number {
    const offset = Math.round(this.clayBandsOffsetNoise.getValue(worldX, 0, worldZ) * 4);
    const n = this.clayBands.length;
    return this.clayBands[((y + offset) % n + n) % n];
  }

  private generateBands(random: RandomSource): number[] {
    const white = this.mc.stateOf('white_terracotta');
    const orange = this.mc.stateOf('orange_terracotta');
    const terracotta = this.mc.stateOf('terracotta');
    const yellow = this.mc.stateOf('yellow_terracotta');
    const brown = this.mc.stateOf('brown_terracotta');
    const red = this.mc.stateOf('red_terracotta');
    const lightGray = this.mc.stateOf('light_gray_terracotta');

    const bands = new Array<number>(192).fill(terracotta);
    for (let i = 0; i < bands.length; i++) {
      i += random.nextInt(5) + 1;
      if (i < bands.length) bands[i] = orange;
    }
    this.makeBands(random, bands, 1, yellow);
    this.makeBands(random, bands, 2, brown);
    this.makeBands(random, bands, 1, red);
    const whiteBandCount = random.nextInt(15 - 9 + 1) + 9;
    let placed = 0;
    for (let start = 0; placed < whiteBandCount && start < bands.length; start += random.nextInt(16) + 4) {
      bands[start] = white;
      if (start - 1 > 0 && random.nextBoolean()) bands[start - 1] = lightGray;
      if (start + 1 < bands.length && random.nextBoolean()) bands[start + 1] = lightGray;
      placed++;
    }
    return bands;
  }

  private makeBands(random: RandomSource, bands: number[], baseWidth: number, state: number): void {
    const count = random.nextInt(15 - 6 + 1) + 6;
    for (let i = 0; i < count; i++) {
      const width = baseWidth + random.nextInt(3);
      const start = random.nextInt(bands.length);
      for (let p = 0; start + p < bands.length && p < width; p++) bands[start + p] = state;
    }
  }

  /**
   * Biome.getHeightAdjustedTemperature + warmEnoughToRain. The biome temperature modifier
   * (noise driven, for frozen/dry biomes) is not ported; it only shifts the snow line by a
   * fraction of a degree, see the report.
   */
  coldEnoughToSnow(biomeId: number, x: number, y: number, z: number): boolean {
    let temperature = this.biomeTemp(biomeId);
    const snowLevel = this.seaLevel + 17;
    if (y > snowLevel) {
      const v = this.temperatureNoise.getValue2d(x / 8, z / 8) * 8;
      temperature -= ((v + y - snowLevel) * 0.05) / 40;
    }
    return temperature < 0.15;
  }

  /** Runs the vanilla SurfaceSystem.buildSurface column loop. */
  buildSurface(
    chunk: LevelChunk,
    wgHeight: Int16Array,
    noiseChunk: NoiseChunk,
    ruleAst: RuleNode,
    access: ChunkBlockAccess,
  ): void {
    const ctx = new SurfaceContext(this, chunk, access, wgHeight, noiseChunk, this.minGenY, this.genDepth);
    const layout = analyzeRule(ruleAst, this.minGenY, this.genDepth);
    const shallowRule = compileRule(layout.shallow, ctx, this, this.minGenY, this.genDepth, this.biomeIdsByName);
    const deepRule = layout.deepCeiling === -Infinity
      ? null
      : compileRule(layout.deep, ctx, this, this.minGenY, this.genDepth, this.biomeIdsByName);
    const deepCeiling = layout.deepCeiling;
    const deepNeedsState = layout.deepNeedsColumnState;

    const minBlockX = chunk.x * 16;
    const minBlockZ = chunk.z * 16;
    const endY = this.minGenY;

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const blockX = minBlockX + x;
        const blockZ = minBlockZ + z;
        const column = (z << 4) | x;
        const wg = wgHeight[column];
        const startingHeight = wg + 1;
        const startingSection = chunk.getSection(startingHeight >> 4);
        const surfaceBiome = startingSection
          ? startingSection.biomes.get(sectionIndex(x, startingHeight & 15, z))
          : 0;

        if (surfaceBiome === this.erodedBadlandsId) {
          this.erodedBadlandsExtension(access, x, z, blockX, blockZ, startingHeight);
        }

        ctx.updateXZ(blockX, blockZ);
        const minSurfaceLevel = ctx.getMinSurfaceLevel();
        let stoneAboveDepth = 0;
        let waterHeight = MIN_VALUE;
        let nextCeilingStoneY = Number.MAX_SAFE_INTEGER;

        // Shallow pass: blocks at/above the preliminary surface, where the
        // above_preliminary_surface gated half of the tree is live.
        let y = wg + 1;
        for (; y >= minSurfaceLevel && y >= endY; y--) {
          const old = access.get(x, y, z);
          if (this.mc.isAir(old)) {
            stoneAboveDepth = 0;
            waterHeight = MIN_VALUE;
          } else if (this.mc.hasFluid(old)) {
            if (waterHeight === MIN_VALUE) waterHeight = y + 1;
          } else {
            if (nextCeilingStoneY >= y) {
              nextCeilingStoneY = endY;
              for (let lookaheadY = y - 1; lookaheadY >= endY - 1; lookaheadY--) {
                if (!this.isStone(access.get(x, lookaheadY, z))) {
                  nextCeilingStoneY = lookaheadY + 1;
                  break;
                }
              }
            }
            stoneAboveDepth++;
            const stoneBelowDepth = y - nextCeilingStoneY + 1;
            ctx.updateY(stoneAboveDepth, stoneBelowDepth, waterHeight, y);
            if (old === this.defaultBlock) {
              const state = shallowRule.tryApply();
              if (state !== null) access.set(x, y, z, state);
            }
          }
        }

        // Deep pass: only the ungated rules can still match, and only down to deepCeiling.
        if (deepRule !== null) {
          const firstDeepY = Math.min(y, deepCeiling);
          if (deepNeedsState) {
            for (y = firstDeepY; y >= endY; y--) {
              const old = access.get(x, y, z);
              if (this.mc.isAir(old)) { stoneAboveDepth = 0; waterHeight = MIN_VALUE; continue; }
              if (this.mc.hasFluid(old)) { if (waterHeight === MIN_VALUE) waterHeight = y + 1; continue; }
              stoneAboveDepth++;
              ctx.updateY(stoneAboveDepth, 0, waterHeight, y);
              if (old === this.defaultBlock) {
                const state = deepRule.tryApply();
                if (state !== null) access.set(x, y, z, state);
              }
            }
          } else {
            for (y = firstDeepY; y >= endY; y--) {
              const old = access.get(x, y, z);
              if (old !== this.defaultBlock) continue;
              ctx.updateY(0, 0, waterHeight, y);
              const state = deepRule.tryApply();
              if (state !== null) access.set(x, y, z, state);
            }
          }
        }

        if (this.frozenOceanIds.has(surfaceBiome)) {
          this.frozenOceanExtension(ctx, access, x, z, blockX, blockZ, wg + 1);
        }
      }
    }
  }

  private isStone(state: number): boolean {
    return !this.mc.isAir(state) && !this.mc.hasFluid(state);
  }

  private setBlock(access: ChunkBlockAccess, x: number, y: number, z: number, state: number): void {
    if (y >= this.minGenY && y < this.minGenY + this.genDepth) access.set(x, y, z, state);
  }

  /** SurfaceSystem.erodedBadlandsExtension. */
  private erodedBadlandsExtension(access: ChunkBlockAccess, x: number, z: number, blockX: number, blockZ: number, height: number): void {
    const pillarBuffer = Math.min(
      Math.abs(this.badlandsSurfaceNoise.getValue(blockX, 0, blockZ) * 8.25),
      this.badlandsPillarNoise.getValue(blockX * 0.2, 0, blockZ * 0.2) * 15,
    );
    if (!(pillarBuffer > 0)) return;

    const pillarFloor = Math.abs(this.badlandsPillarRoofNoise.getValue(blockX * 0.75, 0, blockZ * 0.75) * 1.5);
    const extensionTop = 64 + Math.min(pillarBuffer * pillarBuffer * 2.5, Math.ceil(pillarFloor * 50) + 24);
    const startY = Math.floor(extensionTop);
    if (height > startY) return;

    for (let y = startY; y >= this.minGenY; y--) {
      const oldState = access.get(x, y, z);
      if (this.mc.blockIdOf(oldState) === this.defaultBlockId) break;
      if (this.mc.blockIdOf(oldState) === this.waterBlockId) return;
    }
    for (let y = startY; y >= this.minGenY && this.mc.isAir(access.get(x, y, z)); y--) {
      this.setBlock(access, x, y, z, this.defaultBlock);
    }
  }

  /** SurfaceSystem.frozenOceanExtension. */
  private frozenOceanExtension(ctx: SurfaceContext, access: ChunkBlockAccess, x: number, z: number, blockX: number, blockZ: number, height: number): void {
    const iceberg = Math.min(
      Math.abs(this.icebergSurfaceNoise.getValue(blockX, 0, blockZ) * 8.25),
      this.icebergPillarNoise.getValue(blockX * 1.28, 0, blockZ * 1.28) * 15,
    );
    if (!(iceberg > 1.8)) return;

    const icebergRoof = Math.abs(this.icebergPillarRoofNoise.getValue(blockX * 1.17, 0, blockZ * 1.17) * 1.5);
    let top = Math.min(iceberg * iceberg * 1.2, Math.ceil(icebergRoof * 40) + 14);
    // Biome.TemperatureModifier.FROZEN.shouldMeltFrozenOceanIcebergSlightly always returns
    // true, and only frozen oceans reach this code, so vanilla always subtracts 2 here.
    top -= 2;

    let extensionBottom: number;
    if (top > 2) {
      extensionBottom = this.seaLevel - top - 7;
      top += this.seaLevel;
    } else {
      top = 0;
      extensionBottom = 0;
    }

    const extensionTop = top;
    const random = this.noiseRandom.at(blockX, 0, blockZ);
    const maxSnowDepth = 2 + random.nextInt(4);
    const minSnowHeight = this.seaLevel + 18 + random.nextInt(10);
    let snowDepth = 0;
    const minSurfaceLevel = ctx.getMinSurfaceLevel();

    for (let y = Math.max(height, extensionTop + 1); y >= minSurfaceLevel; y--) {
      const state = access.get(x, y, z);
      const airHere = this.mc.isAir(state);
      const fluidHere = this.mc.hasFluid(state);
      const replaceAir = airHere && y < extensionTop && random.nextDouble() > 0.01;
      const replaceWater = !replaceAir && fluidHere && y > extensionBottom && y < this.seaLevel
        && extensionBottom !== 0 && random.nextDouble() > 0.15;
      if (replaceAir || replaceWater) {
        if (snowDepth <= maxSnowDepth && y > minSnowHeight) {
          this.setBlock(access, x, y, z, this.snowBlock);
          snowDepth++;
        } else {
          this.setBlock(access, x, y, z, this.packedIce);
        }
      }
    }
  }
}
