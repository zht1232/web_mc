// Port of net.minecraft.world.level.levelgen.feature.SimpleBlockFeature.
// In 26.2 grass, flowers, mushrooms, etc. are all `simple_block` configured features; the
// "patch" behaviour comes from the placed feature's count/random_offset/predicate chain.
//
// SimpleBlockFeature.place() only writes the block when `state.canSurvive(level, origin)` holds and,
// for a DoublePlantBlock, also fills the upper half (needs air above). Without that check plants
// were written into any air cell, so ~60% of the grass floated above the real ground.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleStateProvider } from './shared.js';

/** Blocks whose support rule is VegetationBlock.mayPlaceOn: state.is(BlockTags.SUPPORTS_VEGETATION). */
const VEGETATION_CLASSES = new Set([
  'BushBlock', 'TallGrassBlock', 'FlowerBlock', 'DoublePlantBlock', 'TallFlowerBlock',
  'SweetBerryBushBlock', 'FireflyBushBlock', 'WitherRoseBlock', 'SaplingBlock', 'AzaleaBlock',
]);

/** Plants that stand on any sturdy block (FlowerBedBlock / LeafLitterBlock: below.isFaceSturdy(UP)). */
const STURDY_CLASSES = new Set(['FlowerBedBlock', 'LeafLitterBlock', 'MushroomBlock']);

/** Water plants are placed through their own water-aware features; leave them unrestricted here. */
const WATER_CLASSES = new Set(['SeagrassBlock', 'TallSeagrassBlock', 'KelpBlock', 'KelpPlantBlock', 'LilyPadBlock', 'SeaPickleBlock']);

/** `BlockState.canSurvive` for the blocks `simple_block` places. */
function canSurvive(ctx: FeatureContext, state: number, x: number, y: number, z: number): boolean {
  const cls = ctx.mc.blockOf(state).cls;
  if (WATER_CLASSES.has(cls)) return true;
  const below = ctx.getBlockState(x, y - 1, z);
  const belowName = ctx.blockName(below);
  if (VEGETATION_CLASSES.has(cls)) return ctx.tags.has('#minecraft:supports_vegetation', belowName);
  if (cls === 'DryVegetationBlock') return ctx.tags.has('#minecraft:supports_dry_vegetation', belowName);
  if (cls === 'CactusBlock') {
    return ctx.tags.has('#minecraft:supports_cactus', belowName) && !ctx.mc.isLiquid(ctx.getBlockState(x, y + 1, z));
  }
  if (cls === 'BambooSaplingBlock' || cls === 'BambooStalkBlock') return ctx.tags.has('#minecraft:supports_bamboo', belowName);
  if (STURDY_CLASSES.has(cls)) return ctx.mc.collision(below).length > 0 && !ctx.mc.isLiquid(below);
  // Anything else that has no collision box of its own is a plant-like decoration: it needs ground.
  if (ctx.mc.collision(state).length === 0 && !ctx.mc.isAir(state) && !ctx.mc.isLiquid(state)) {
    return ctx.mc.collision(below).length > 0 && !ctx.mc.isLiquid(below);
  }
  return true;
}

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const state = sampleStateProvider(ctx, config.to_place, random, x, y, z);
  if (state === null) return false;
  if (!ctx.mc.isAir(ctx.getBlockState(x, y, z))) return false;
  if (!canSurvive(ctx, state, x, y, z)) return false;

  const cls = ctx.mc.blockOf(state).cls;
  if (cls === 'DoublePlantBlock' || cls === 'TallFlowerBlock') {
    // DoublePlantBlock.placeAt: lower half here, upper half above (which has to be free)
    if (!ctx.mc.isAir(ctx.getBlockState(x, y + 1, z))) return false;
    ctx.setBlock(x, y, z, ctx.mc.withProp(state, 'half', 'lower'));
    ctx.setBlock(x, y + 1, z, ctx.mc.withProp(state, 'half', 'upper'));
    return true;
  }
  ctx.setBlock(x, y, z, state);
  return true;
}
