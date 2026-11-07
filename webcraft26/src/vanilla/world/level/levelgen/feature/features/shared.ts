// Shared glue for net.minecraft.world.level.levelgen.feature.* :
//   * state providers  (stateproviders/*)          -> parse {Name,Properties} into a state id
//   * block predicates (blockpredicates/*)         -> test a predicate at a world position
//   * IntProvider / HeightProvider sampling        -> exact vanilla random consumption order
// These are helpers, not a Java class; the individual feature files own the actual algorithms.

import type { Cfg, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

// ---------------------------------------------------------------- names / states

function bare(name: string): string {
  const s = name.startsWith('#') ? name.slice(1) : name;
  return s.startsWith('minecraft:') ? s.slice('minecraft:'.length) : s;
}

/** Parse a vanilla {Name, Properties} state node into a runtime state id. */
export function stateOf(ctx: FeatureContext, node: Cfg): number {
  if (typeof node === 'string') return safeState(ctx, bare(node));
  const name = bare(node.Name ?? 'air');
  return safeState(ctx, name, node.Properties as Record<string, string> | undefined);
}

/** stateOf that never throws on blocks/properties absent from the runtime registry. */
export function safeState(ctx: FeatureContext, name: string, props?: Record<string, string>): number {
  try {
    if (ctx.mc.blockByName.has(name)) return ctx.mc.stateOf(name, props);
  } catch { /* fall through */ }
  return ctx.air;
}

export function blockName(ctx: FeatureContext, state: number): string { return ctx.mc.blockOf(state).name; }
export function isAir(ctx: FeatureContext, state: number): boolean { return ctx.mc.isAir(state); }
export function isReplaceableByTrees(ctx: FeatureContext, state: number): boolean {
  return ctx.mc.isAir(state) || ctx.tags.has('replaceable_by_trees', blockName(ctx, state));
}
export function isLeaves(ctx: FeatureContext, state: number): boolean {
  return ctx.tags.has('leaves', blockName(ctx, state));
}
export function inTag(ctx: FeatureContext, tag: string, state: number): boolean {
  return ctx.tags.has(tag, blockName(ctx, state));
}

// ---------------------------------------------------------------- state providers

/**
 * Port of net.minecraft.world.level.levelgen.feature.stateproviders.* (the subset the shipped
 * feature data uses). Returns null when the provider deliberately has no state.
 */
export function sampleStateProvider(
  ctx: FeatureContext, provider: Cfg, random: FeatureRandom, x: number, y: number, z: number,
): number | null {
  if (!provider || typeof provider !== 'object') return null;
  const type: string = provider.type ?? '';
  switch (type) {
    case 'minecraft:simple_state_provider':
    case 'minecraft:rotated_block_provider':
      return stateOf(ctx, provider.state);
    case 'minecraft:weighted_state_provider': {
      const entries: Cfg[] = provider.entries ?? [];
      let total = 0;
      for (const e of entries) total += e.weight ?? 1;
      if (total <= 0) return null;
      let r = random.nextInt(total);
      for (const e of entries) {
        r -= e.weight ?? 1;
        if (r < 0) return stateOf(ctx, e.data);
      }
      return stateOf(ctx, entries[entries.length - 1]?.data);
    }
    case 'minecraft:randomized_int_state_provider': {
      const base = sampleStateProvider(ctx, provider.source, random, x, y, z);
      if (base === null) return null;
      const prop: string = provider.property ?? '';
      const value = sampleInt(provider.values, random);
      return ctx.mc.withProp(base, prop, String(value));
    }
    case 'minecraft:noise_threshold_provider': {
      // Simplified: a fixed random draw mixed with the noise parameters. The default state
      // (dandelion for flower_plain) is returned often enough to keep flower patches varied.
      const r = random.nextFloat();
      const pool: Cfg[] = [];
      if (provider.default_state) pool.push(provider.default_state);
      for (const s of provider.high_states ?? []) pool.push(s);
      for (const s of provider.low_states ?? []) pool.push(s);
      if (pool.length === 0) return null;
      if (provider.default_state && r < 0.4) return stateOf(ctx, provider.default_state);
      return stateOf(ctx, pool[random.nextInt(pool.length)]);
    }
    case 'minecraft:dual_noise_provider': {
      const states: Cfg[] = provider.states ?? [];
      if (states.length === 0) return null;
      return stateOf(ctx, states[random.nextInt(states.length)]);
    }
    case 'minecraft:noise_based_state_provider': {
      const states: Cfg[] = provider.states ?? [];
      if (states.length === 0) return null;
      return stateOf(ctx, states[random.nextInt(states.length)]);
    }
    default:
      // rule_based_state_provider etc.: take the first concrete state we can find.
      if (provider.state) return stateOf(ctx, provider.state);
      if (provider.default_state) return stateOf(ctx, provider.default_state);
      if (provider.fallback) return sampleStateProvider(ctx, provider.fallback, random, x, y, z);
      return null;
  }
}

// ---------------------------------------------------------------- block predicates

function offsetPos(p: Cfg, x: number, y: number, z: number): [number, number, number] {
  const o = p.offset;
  return Array.isArray(o) ? [x + (o[0] | 0), y + (o[1] | 0), z + (o[2] | 0)] : [x, y, z];
}

/**
 * Port of net.minecraft.world.level.levelgen.blockpredicates.* (subset). Predicates come from
 * block_predicate_filter placements, environment_scan conditions and ore `target` rules.
 */
export function testPredicate(ctx: FeatureContext, p: Cfg, x: number, y: number, z: number): boolean {
  if (!p || typeof p !== 'object') return true;
  const type: string = p.type ?? p.predicate_type ?? '';
  const [px, py, pz] = offsetPos(p, x, y, z);
  switch (type) {
    case 'minecraft:true':
    case 'minecraft:always_true':
    case 'minecraft:tag_match': // ore target handled separately; treated as a tag test here
      return true;
    case 'minecraft:matching_block_tag': {
      const state = ctx.getBlockState(px, py, pz);
      return ctx.tags.has(p.tag, blockName(ctx, state));
    }
    case 'minecraft:matching_blocks': {
      const state = ctx.getBlockState(px, py, pz);
      const name = blockName(ctx, state);
      const blocks = p.blocks;
      if (typeof blocks === 'string') return name === bare(blocks);
      if (Array.isArray(blocks)) {
        for (const b of blocks) if (name === bare(b)) return true;
      }
      return false;
    }
    case 'minecraft:matching_fluids': {
      const state = ctx.getBlockState(px, py, pz);
      const name = blockName(ctx, state);
      const fluids = p.fluids;
      if (typeof fluids === 'string') return name === bare(fluids);
      if (Array.isArray(fluids)) for (const f of fluids) if (name === bare(f)) return true;
      return false;
    }
    case 'minecraft:would_survive': {
      const here = ctx.getBlockState(px, py, pz);
      const below = ctx.getBlockState(px, py - 1, pz);
      return ctx.mc.isAir(here) && !ctx.mc.isAir(below) && !ctx.mc.isLiquid(below);
    }
    case 'minecraft:replaceable':
    case 'minecraft:replaceable_by_trees':
      return isReplaceableByTrees(ctx, ctx.getBlockState(px, py, pz));
    case 'minecraft:solid':
      return ctx.mc.isSolid(ctx.getBlockState(px, py, pz));
    case 'minecraft:air':
      return ctx.mc.isAir(ctx.getBlockState(px, py, pz));
    case 'minecraft:not':
      return !testPredicate(ctx, p.predicate, px, py, pz);
    case 'minecraft:all_of': {
      for (const sub of p.predicates ?? []) if (!testPredicate(ctx, sub, px, py, pz)) return false;
      return true;
    }
    case 'minecraft:any_of': {
      for (const sub of p.predicates ?? []) if (testPredicate(ctx, sub, px, py, pz)) return true;
      return false;
    }
    case 'minecraft:inside_world_bounds':
      return py >= ctx.minY && py <= ctx.maxY;
    case 'minecraft:has_sturdy_face':
      return true;
    default:
      return true; // lenient: unknown predicates must not silently suppress whole features
  }
}

// ---------------------------------------------------------------- IntProvider

function randomBetween(random: FeatureRandom, min: number, max: number): number {
  return min + random.nextInt(max - min + 1);
}

/** Port of net.minecraft.util.valueproviders.* (subset), exact random consumption. */
export function sampleInt(provider: Cfg, random: FeatureRandom): number {
  if (typeof provider === 'number') return provider | 0; // ConstantInt
  if (!provider || typeof provider !== 'object') return 0;
  const type: string = provider.type ?? '';
  switch (type) {
    case '': // bare number already handled
    case 'minecraft:constant':
      return (provider.value ?? 0) | 0;
    case 'minecraft:uniform':
      return randomBetween(random, provider.min_inclusive | 0, provider.max_inclusive | 0);
    case 'minecraft:trapezoid': {
      const min = provider.min | 0;
      const max = provider.max | 0;
      const plateau = provider.plateau | 0;
      if (plateau === 0 && max === -min) return random.nextInt(max + 1) - random.nextInt(max + 1);
      const range = max - min;
      if (plateau >= range) return randomBetween(random, min, max);
      const plateauStart = Math.floor((range - plateau) / 2);
      const plateauEnd = range - plateauStart;
      return min + randomBetween(random, 0, plateauEnd) + randomBetween(random, 0, plateauStart);
    }
    case 'minecraft:clamped': {
      const v = sampleInt(provider.source, random);
      return Math.max(provider.min_inclusive | 0, Math.min(provider.max_inclusive | 0, v));
    }
    case 'minecraft:biased_to_bottom':
      return (provider.min_inclusive | 0) +
        random.nextInt(random.nextInt((provider.max_inclusive | 0) - (provider.min_inclusive | 0) + 1) + 1);
    case 'minecraft:weighted_list': {
      const dist: Cfg[] = provider.distribution ?? [];
      let total = 0;
      for (const e of dist) total += e.weight ?? 1;
      if (total <= 0) return 0;
      let r = random.nextInt(total);
      for (const e of dist) {
        r -= e.weight ?? 1;
        if (r < 0) return sampleInt(e.data, random);
      }
      return 0;
    }
    case 'minecraft:clamped_normal':
      return Math.max(provider.min_inclusive | 0, Math.min(provider.max_inclusive | 0,
        (provider.mean ?? 0) + Math.round((random.nextFloat() - 0.5) * (provider.deviation ?? 1) * 2)));
    default:
      return (provider.value ?? 0) | 0;
  }
}

// ---------------------------------------------------------------- HeightProvider

export function resolveAnchor(ctx: FeatureContext, anchor: Cfg): number {
  if (typeof anchor === 'number') return anchor | 0;
  if (!anchor || typeof anchor !== 'object') return ctx.minY;
  if (anchor.absolute !== undefined) return anchor.absolute | 0;
  if (anchor.above_bottom !== undefined) return ctx.minY + (anchor.above_bottom | 0);
  if (anchor.below_top !== undefined) return ctx.maxY - (anchor.below_top | 0);
  return ctx.minY;
}

/** Port of net.minecraft.world.level.levelgen.heightproviders.* (subset). */
export function sampleHeight(ctx: FeatureContext, provider: Cfg, random: FeatureRandom): number {
  const min = resolveAnchor(ctx, provider.min_inclusive);
  const max = resolveAnchor(ctx, provider.max_inclusive);
  const type: string = provider.type ?? '';
  if (min >= max) return min;
  switch (type) {
    case 'minecraft:uniform':
      return randomBetween(random, min, max);
    case 'minecraft:trapezoid': {
      const range = max - min;
      const plateau = provider.plateau | 0;
      if (plateau >= range) return randomBetween(random, min, max);
      const plateauStart = Math.floor((range - plateau) / 2);
      const plateauEnd = range - plateauStart;
      return min + randomBetween(random, 0, plateauEnd) + randomBetween(random, 0, plateauStart);
    }
    case 'minecraft:biased_to_bottom': {
      const inner = provider.inner ?? 1;
      const limit = random.nextInt(max - min - inner + 1);
      return min + random.nextInt(limit + inner);
    }
    case 'minecraft:very_biased_to_bottom': {
      const inner = provider.inner ?? 1;
      const upper = randomBetween(random, min + inner, max);
      const biasedUpper = randomBetween(random, min, upper - 1);
      return randomBetween(random, min, biasedUpper - 1 + inner);
    }
    case 'minecraft:constant':
      return resolveAnchor(ctx, provider.value);
    case 'minecraft:weighted_list': {
      const dist: Cfg[] = provider.distribution ?? [];
      let total = 0;
      for (const e of dist) total += e.weight ?? 1;
      let r = random.nextInt(Math.max(1, total));
      for (const e of dist) {
        r -= e.weight ?? 1;
        if (r < 0) return sampleHeight(ctx, e.data, random);
      }
      return min;
    }
    default:
      return randomBetween(random, min, max);
  }
}
