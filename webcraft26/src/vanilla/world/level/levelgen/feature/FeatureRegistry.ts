// Port of net.minecraft.world.level.levelgen.placement.PlacedFeature /
// PlacementModifier chain and the placement modifier implementations, plus the
// net.minecraft.world.level.biome.Biome.BIOME_INFO_NOISE used by the count placements.
//
// PlacedFeature.placeWithContext builds a lazy Stream<BlockPos> by flatMap-ing the placement
// modifiers left-to-right and calls ConfiguredFeature.place for each terminal position. Java
// streams are lazy, so positions are processed DEPTH-FIRST: one origin travels through the whole
// chain (and into the feature, which consumes the SAME RandomSource) before the next origin is
// produced. runChain reproduces that order exactly, which is what keeps feature seeds
// deterministic and matches vanilla's random consumption.

import type { WorldgenData } from '../NoiseChunkGenerator.js';
import { LegacyRandomSource } from '../../../../core/Random.js';
import { SimplexNoise } from '../synth/SimplexNoise.js';
import type { CfJson, Cfg, FeatureApi, FeatureContext, PfJson } from './FeaturePlacer.js';
import type { FeatureRandom } from './WorldgenRandom.js';
import { dispatchFeature } from './features/index.js';
import { sampleHeight, sampleInt, testPredicate } from './features/shared.js';

/** Biome.BIOME_INFO_NOISE = PerlinSimplexNoise(WorldgenRandom(LegacyRandomSource(2345)), [0]). */
function makeBiomeInfoNoise(): SimplexNoise {
  return new SimplexNoise(new LegacyRandomSource(2345));
}

/**
 * Bounding box used to skip feature.place for terminal positions that cannot possibly write
 * into the target chunk. A placement chain can scatter up to 7 blocks horizontally and a tree
 * canopy reaches ~8, so 16 is a safe margin. Only neighbour source runs are affected.
 */
const REACH = 10;

function mayReach(ctx: FeatureContext, x: number, z: number): boolean {
  return x >= ctx.minBlockX - REACH && x < ctx.minBlockX + 16 + REACH &&
    z >= ctx.minBlockZ - REACH && z < ctx.minBlockZ + 16 + REACH;
}

export class FeatureRegistry implements FeatureApi {
  private readonly configured: Record<string, CfJson>;
  private readonly placed: Record<string, PfJson>;
  private readonly biomeNoise: SimplexNoise;
  private ambientTop = '';

  constructor(data: WorldgenData) {
    this.configured = data.configuredFeatures as Record<string, CfJson>;
    this.placed = data.placedFeatures as Record<string, PfJson>;
    this.biomeNoise = makeBiomeInfoNoise();
  }

  private resolveConfigured(ref: string | CfJson): CfJson | null {
    if (typeof ref === 'string') return this.configured[ref] ?? null;
    return ref && typeof ref.type === 'string' ? ref : null;
  }

  private resolvePlaced(ref: string | PfJson): PfJson | null {
    if (typeof ref === 'string') return this.placed[ref] ?? null;
    return ref && ref.feature ? ref : null;
  }

  /** FeatureApi: run a placed feature from an arbitrary origin. */
  runPlaced(
    ctx: FeatureContext, pf: string | PfJson, random: FeatureRandom,
    topFeature: string, x: number, y: number, z: number,
  ): boolean {
    const resolved = this.resolvePlaced(pf);
    if (!resolved) return false;
    const saved = this.ambientTop;
    const top = topFeature || this.ambientTop || (typeof pf === 'string' ? pf : '');
    this.ambientTop = top;
    try {
      return this.runChain(ctx, resolved.placement ?? [], random, x, y, z, 0, top, resolved.feature);
    } finally {
      this.ambientTop = saved;
    }
  }

  private placeConfigured(
    ctx: FeatureContext, cfRef: string | CfJson, random: FeatureRandom, x: number, y: number, z: number,
  ): boolean {
    const cf = this.resolveConfigured(cfRef);
    if (!cf) return false;
    return dispatchFeature(cf.type, ctx, cf.config ?? {}, random, x, y, z, this);
  }

  /** RepeatingPlacement.count for the four count-like modifiers. */
  private repeatCount(ctx: FeatureContext, mod: Cfg, random: FeatureRandom, x: number, z: number): number {
    switch (mod.type) {
      case 'minecraft:count':
        return Math.max(0, sampleInt(mod.count ?? 0, random));
      case 'minecraft:noise_based_count': {
        const factor = mod.noise_factor ?? 1;
        const noise = this.biomeNoise.getValue2d(x / factor, z / factor);
        return Math.max(0, Math.ceil((noise + (mod.noise_offset ?? 0)) * (mod.noise_to_count_ratio ?? 1)));
      }
      case 'minecraft:noise_threshold_count': {
        const noise = this.biomeNoise.getValue2d(x / 200, z / 200);
        return noise < (mod.noise_level ?? 0) ? (mod.below_noise ?? 0) : (mod.above_noise ?? 0);
      }
      case 'minecraft:count_on_every_layer':
        return Math.max(0, sampleInt(mod.count ?? 0, random));
      default:
        return 0;
    }
  }

  private runChain(
    ctx: FeatureContext, mods: Cfg[], random: FeatureRandom,
    x: number, y: number, z: number, mi: number, topFeature: string, cfRef: string | CfJson,
  ): boolean {
    if (mi >= mods.length) {
      if (!mayReach(ctx, x, z)) return false;
      return this.placeConfigured(ctx, cfRef, random, x, y, z);
    }
    const mod = mods[mi];
    const type: string = mod.type ?? '';
    const next = (nx: number, ny: number, nz: number): boolean =>
      this.runChain(ctx, mods, random, nx, ny, nz, mi + 1, topFeature, cfRef);

    switch (type) {
      // ---- repeating placements (one count() draw, then N origins) --------------------
      case 'minecraft:count':
      case 'minecraft:noise_based_count':
      case 'minecraft:noise_threshold_count': {
        const n = this.repeatCount(ctx, mod, random, x, z);
        let placedAny = false;
        for (let i = 0; i < n; i++) placedAny = next(x, y, z) || placedAny;
        return placedAny;
      }
      case 'minecraft:count_on_every_layer': {
        // Simplified: one "layer" of `count` surface positions (vanilla walks cave layers).
        const n = this.repeatCount(ctx, mod, random, x, z);
        let placedAny = false;
        for (let i = 0; i < n; i++) {
          const nx = x + random.nextInt(16);
          const nz = z + random.nextInt(16);
          const ny = ctx.getHeight('MOTION_BLOCKING', nx, nz) - 1;
          placedAny = next(nx, ny, nz) || placedAny;
        }
        return placedAny;
      }

      // ---- position transforms -----------------------------------------------------
      case 'minecraft:in_square':
        return next(x + random.nextInt(16), y, z + random.nextInt(16));
      case 'minecraft:random_offset':
        return next(
          x + sampleInt(mod.xz_spread ?? 0, random),
          y + sampleInt(mod.y_spread ?? 0, random),
          z + sampleInt(mod.xz_spread ?? 0, random),
        );
      case 'minecraft:heightmap': {
        const ny = ctx.getHeight(mod.heightmap ?? 'WORLD_SURFACE_WG', x, z);
        return ny > ctx.minY ? next(x, ny, z) : false;
      }
      case 'minecraft:height_range':
        return next(x, sampleHeight(ctx, mod.height ?? {}, random), z);
      case 'minecraft:fixed_placement': {
        const cx = x >> 4, cz = z >> 4;
        let placedAny = false;
        for (const p of mod.positions ?? []) {
          if ((p[0] >> 4) === cx && (p[2] >> 4) === cz) placedAny = next(p[0], p[1], p[2]) || placedAny;
        }
        return placedAny;
      }
      case 'minecraft:environment_scan': {
        const dir = mod.direction_of_search === 'up' ? 1 : -1;
        const steps = mod.max_steps ?? 8;
        const allowed = mod.allowed_search_condition;
        let cy = y;
        if (allowed && !testPredicate(ctx, allowed, x, cy, z)) return false;
        for (let i = 0; i < steps; i++) {
          if (testPredicate(ctx, mod.target_condition, x, cy, z)) return next(x, cy, z);
          cy += dir;
          if (cy < ctx.minY || cy > ctx.maxY) return false;
          if (allowed && !testPredicate(ctx, allowed, x, cy, z)) break;
        }
        return testPredicate(ctx, mod.target_condition, x, cy, z) ? next(x, cy, z) : false;
      }

      // ---- filters (no random consumed except rarity) ------------------------------
      case 'minecraft:rarity_filter':
        return random.nextFloat() < 1 / (mod.chance ?? 1) ? next(x, y, z) : false;
      case 'minecraft:block_predicate_filter':
        return testPredicate(ctx, mod.predicate, x, y, z) ? next(x, y, z) : false;
      case 'minecraft:biome':
        return ctx.biomeHasFeature(ctx.biomeAt(x, z), topFeature) ? next(x, y, z) : false;
      case 'minecraft:surface_water_depth_filter': {
        const depth = ctx.getHeight('WORLD_SURFACE', x, z) - ctx.getHeight('OCEAN_FLOOR', x, z);
        return depth <= (mod.max_water_depth ?? 0) ? next(x, y, z) : false;
      }
      case 'minecraft:surface_relative_threshold_filter': {
        const s = ctx.getHeight(mod.heightmap ?? 'WORLD_SURFACE_WG', x, z);
        const lo = s + (mod.min_inclusive ?? -1e9);
        const hi = s + (mod.max_inclusive ?? 1e9);
        return y >= lo && y <= hi ? next(x, y, z) : false;
      }
      default:
        // Unknown modifier: pass the position through (deterministic, keeps features alive).
        return next(x, y, z);
    }
  }
}
