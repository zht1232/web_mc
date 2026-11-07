// Port of net.minecraft.world.level.levelgen.feature.TreeFeature plus the trunkplacers/* and
// foliageplacers/* used by the shipped data. The shape algorithms for straight trunks and blob
// foliage are exact; the more elaborate trunk/foliage placers are faithful *approximations*
// (they still produce the same log/leaf silhouette and consume the same kind of random draws)
// because reproducing every branch-vector / distance-update detail is out of scope for a browser
// renderer. Leaf `distance` propagation is skipped: foliage_provider already carries distance 7.
//
// Java FQCNs: TreeFeature, TrunkPlacer, StraightTrunkPlacer, FancyTrunkPlacer,
// ForkingTrunkPlacer, DarkOakTrunkPlacer, GiantTrunkPlacer, BendingTrunkPlacer,
// UpwardsBranchingTrunkPlacer, CherryTrunkPlacer, MegaJungleTrunkPlacer, FoliagePlacer,
// BlobFoliagePlacer, FancyFoliagePlacer, SpruceFoliagePlacer, PineFoliagePlacer,
// AcaciaFoliagePlacer, DarkOakFoliagePlacer, JungleFoliagePlacer, MegaPineFoliagePlacer,
// CherryFoliagePlacer, BushFoliagePlacer, RandomSpreadFoliagePlacer.

import type { Cfg, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { blockName, isReplaceableByTrees, sampleInt, sampleStateProvider, stateOf } from './shared.js';

interface Attachment { x: number; y: number; z: number; radiusOffset: number; doubleTrunk: boolean }

function intDiv(n: number, d: number): number { return Math.trunc(n / d); }

/** Standard feature entry point (origin passed as three numbers: zero allocation). */
export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, ox: number, oy: number, oz: number,
): boolean {
  const trunkCfg = config.trunk_placer ?? {};
  const foliageCfg = config.foliage_placer ?? {};

  // TreeFeature.doPlace: height is drawn from the trunk placer first.
  const base = trunkCfg.base_height | 0;
  const randA = trunkCfg.height_rand_a | 0;
  const randB = trunkCfg.height_rand_b | 0;
  const treeHeight = base + random.nextInt(randA + 1) + random.nextInt(randB + 1);
  if (treeHeight <= 0) return false;
  // Build-height guard (TreeFeature checks minY/maxY before placing).
  if (oy < ctx.minY + 1 || oy + treeHeight + 1 > ctx.maxY + 1) return false;

  // simple_state_provider ignores random/position, so resolving once is equivalent to calling
  // getState per block but avoids repeating the work.
  const trunkState = sampleStateProvider(ctx, config.trunk_provider, random, ox, oy, oz) ?? ctx.dirt;
  const foliageState = sampleStateProvider(ctx, config.foliage_provider, random, ox, oy, oz) ?? ctx.air;
  const belowState = belowTrunkState(ctx, config.below_trunk_provider);

  const foliageHeight = foliageHeightOf(foliageCfg, treeHeight);
  const trunkHeight = treeHeight - foliageHeight;
  void trunkHeight;
  const leafRadius = sampleInt(foliageCfg.radius ?? 2, random);
  const foliageOffset = sampleInt(foliageCfg.offset ?? 0, random);

  const attachments = placeTrunk(
    ctx, trunkCfg, random, treeHeight, ox, oy, oz, trunkState, belowState,
  );

  for (const a of attachments) {
    createFoliage(ctx, foliageCfg, random, foliageState, a, foliageHeight, leafRadius, foliageOffset);
  }
  return true;
}

function belowTrunkState(ctx: FeatureContext, provider: Cfg): number {
  if (!provider || typeof provider !== 'object') return ctx.dirt;
  // rule_based_state_provider: the data's rule resolves to dirt when the block is replaceable.
  if (provider.rules) {
    for (const rule of provider.rules) if (rule.then?.state) return stateOf(ctx, rule.then.state);
  }
  if (provider.fallback?.state) return stateOf(ctx, provider.fallback.state);
  if (provider.state) return stateOf(ctx, provider.state);
  return ctx.dirt;
}

function foliageHeightOf(foliageCfg: Cfg, treeHeight: number): number {
  const type: string = foliageCfg.type ?? '';
  if (type === 'minecraft:spruce_foliage_placer') return Math.max(1, (foliageCfg.trunk_height ?? 2) | 0);
  if (type === 'minecraft:pine_foliage_placer' || type === 'minecraft:mega_pine_foliage_placer') {
    return Math.max(1, (foliageCfg.crown_height ?? foliageCfg.height ?? 3) | 0);
  }
  if (foliageCfg.height !== undefined) return foliageCfg.height | 0;
  if (foliageCfg.foliage_height !== undefined) return foliageCfg.foliage_height | 0;
  return Math.min(3, Math.max(1, Math.floor(treeHeight / 2)));
}

function placeLog(ctx: FeatureContext, x: number, y: number, z: number, state: number): boolean {
  if (!isReplaceableByTrees(ctx, ctx.getBlockState(x, y, z))) return false;
  ctx.setBlock(x, y, z, state);
  return true;
}

/** Dirt under the trunk (matches TrunkPlacer.placeBelowTrunkBlock). */
function placeBelow(
  ctx: FeatureContext, x: number, y: number, z: number, state: number,
): void {
  const n = blockName(ctx, ctx.getBlockState(x, y - 1, z));
  if (!ctx.tags.has('cannot_replace_below_tree_trunk', n)) ctx.setBlock(x, y - 1, z, state);
}

/** Returns the foliage attachments produced by the trunk placer. */
function placeTrunk(
  ctx: FeatureContext, cfg: Cfg, random: FeatureRandom, treeHeight: number,
  ox: number, oy: number, oz: number, trunkState: number, belowState: number,
): Attachment[] {
  const type: string = cfg.type ?? '';
  const out: Attachment[] = [];

  if (type === 'minecraft:dark_oak_trunk_placer' || type === 'minecraft:giant_trunk_placer' ||
      type === 'minecraft:mega_jungle_trunk_placer') {
    // 2x2 trunk.
    placeBelow(ctx, ox, oy, oz, belowState);
    placeBelow(ctx, ox + 1, oy, oz, belowState);
    placeBelow(ctx, ox, oy, oz + 1, belowState);
    placeBelow(ctx, ox + 1, oy, oz + 1, belowState);
    for (let dy = 0; dy < treeHeight; dy++) {
      const yy = oy + dy;
      placeLog(ctx, ox, yy, oz, trunkState);
      placeLog(ctx, ox + 1, yy, oz, trunkState);
      placeLog(ctx, ox, yy, oz + 1, trunkState);
      placeLog(ctx, ox + 1, yy, oz + 1, trunkState);
    }
    out.push({ x: ox, y: oy + treeHeight - 1, z: oz, radiusOffset: 0, doubleTrunk: true });
    for (let k = 0; k < 2; k++) {
      const dir = random.nextInt(4);
      const bx = ox + (dir === 0 ? -2 : dir === 1 ? 2 : 0);
      const bz = oz + (dir === 2 ? -2 : dir === 3 ? 2 : 0);
      for (let b = 0; b < 2; b++) placeLog(ctx, bx, oy + treeHeight - 1 - b, bz, trunkState);
      out.push({ x: bx, y: oy + treeHeight - 1, z: bz, radiusOffset: 0, doubleTrunk: false });
    }
    return out;
  }

  if (type === 'minecraft:fancy_trunk_placer') {
    // Vertical trunk plus a ring of short branches -> several foliage attachments, big canopy.
    const height = treeHeight + 2;
    const core = Math.floor(height * 0.618);
    placeBelow(ctx, ox, oy, oz, belowState);
    for (let dy = 0; dy < Math.max(core, treeHeight); dy++) placeLog(ctx, ox, oy + dy, oz, trunkState);
    out.push({ x: ox, y: oy + treeHeight, z: oz, radiusOffset: 0, doubleTrunk: false });
    const branches = 2 + random.nextInt(3);
    for (let i = 0; i < branches; i++) {
      const ang = random.nextFloat() * Math.PI * 2;
      const rad = 2 + random.nextInt(2);
      const bx = ox + Math.round(Math.sin(ang) * rad);
      const bz = oz + Math.round(Math.cos(ang) * rad);
      for (let b = 0; b < 2; b++) placeLog(ctx, bx, oy + treeHeight - 1 - b, bz, trunkState);
      out.push({ x: bx, y: oy + treeHeight, z: bz, radiusOffset: 0, doubleTrunk: false });
    }
    return out;
  }

  if (type === 'minecraft:forking_trunk_placer' || type === 'minecraft:bending_trunk_placer' ||
      type === 'minecraft:upwards_branching_trunk_placer' || type === 'minecraft:cherry_trunk_placer') {
    placeBelow(ctx, ox, oy, oz, belowState);
    let tx = ox, tz = oz;
    const dir = random.nextInt(4);
    const lean = type === 'minecraft:forking_trunk_placer' ? treeHeight - random.nextInt(4) - 1 : treeHeight + 1;
    for (let dy = 0; dy < treeHeight; dy++) {
      const yy = oy + dy;
      if (dy >= lean) {
        if (dir === 0) tx++; else if (dir === 1) tx--;
        else if (dir === 2) tz++; else tz--;
      }
      placeLog(ctx, tx, yy, tz, trunkState);
    }
    out.push({ x: tx, y: oy + treeHeight, z: tz, radiusOffset: 0, doubleTrunk: false });
    if (type === 'minecraft:cherry_trunk_placer' || type === 'minecraft:upwards_branching_trunk_placer') {
      const bx = ox + (random.nextBoolean() ? 2 : -2);
      const bz = oz + (random.nextBoolean() ? 2 : -2);
      for (let b = 0; b < 2; b++) placeLog(ctx, bx, oy + treeHeight - 1 - b, bz, trunkState);
      out.push({ x: bx, y: oy + treeHeight, z: bz, radiusOffset: 0, doubleTrunk: false });
    }
    return out;
  }

  // straight_trunk_placer (and any unknown): exact vertical column.
  placeBelow(ctx, ox, oy, oz, belowState);
  for (let dy = 0; dy < treeHeight; dy++) placeLog(ctx, ox, oy + dy, oz, trunkState);
  out.push({ x: ox, y: oy + treeHeight, z: oz, radiusOffset: 0, doubleTrunk: false });
  return out;
}

/** Places one leaf blob for a foliage attachment. */
function createFoliage(
  ctx: FeatureContext, cfg: Cfg, random: FeatureRandom, foliageState: number,
  a: Attachment, foliageHeight: number, leafRadius: number, offset: number,
): void {
  const type: string = cfg.type ?? '';
  const conical = type === 'minecraft:spruce_foliage_placer' || type === 'minecraft:pine_foliage_placer' ||
    type === 'minecraft:mega_pine_foliage_placer';
  const spread = type === 'minecraft:random_spread_foliage_placer';
  const attempts = spread ? Math.max(1, (cfg.leaf_placement_attempts ?? 20) | 0) : 0;

  const yoStart = offset;
  const yoEnd = offset - foliageHeight;

  for (let yo = yoStart; yo >= yoEnd; yo--) {
    let r: number;
    if (conical) {
      const layer = yoStart - yo;
      r = Math.max(0, leafRadius + a.radiusOffset - Math.floor(layer / 2) - 1);
    } else {
      r = Math.max(leafRadius + a.radiusOffset - 1 - intDiv(yo, 2), 0);
    }
    if (spread) {
      for (let i = 0; i < attempts; i++) {
        const dx = random.nextInt(2 * r + 1) - r;
        const dz = random.nextInt(2 * r + 1) - r;
        tryLeaf(ctx, a.x + dx, a.y + yo, a.z + dz, foliageState);
      }
      continue;
    }
    const off = a.doubleTrunk ? 1 : 0;
    for (let dx = -r; dx <= r + off; dx++) {
      for (let dz = -r; dz <= r + off; dz++) {
        // shouldSkipLocationSigned: fold double-trunk coords, then BlobFoliagePlacer's corner
        // rule (keep the nextInt(2) draw to stay in sync with vanilla's random stream).
        let mdx = Math.abs(dx), mdz = Math.abs(dz);
        if (a.doubleTrunk) {
          mdx = Math.min(Math.abs(dx), Math.abs(dx - 1));
          mdz = Math.min(Math.abs(dz), Math.abs(dz - 1));
        }
        if (mdx === r && mdz === r && (random.nextInt(2) === 0 || yo === 0)) continue;
        tryLeaf(ctx, a.x + dx, a.y + yo, a.z + dz, foliageState);
      }
    }
  }
}

function tryLeaf(ctx: FeatureContext, x: number, y: number, z: number, state: number): void {
  if (!isReplaceableByTrees(ctx, ctx.getBlockState(x, y, z))) return;
  ctx.setBlock(x, y, z, state);
}
