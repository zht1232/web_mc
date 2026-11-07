// Port of net.minecraft.world.level.levelgen.feature.SimpleBlockFeature.
// In 26.2 grass, flowers, mushrooms, etc. are all `simple_block` configured features; the
// "patch" behaviour comes from the placed feature's count/random_offset/predicate chain.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleStateProvider } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const state = sampleStateProvider(ctx, config.to_place, random, x, y, z);
  if (state === null) return false;
  if (!ctx.mc.isAir(ctx.getBlockState(x, y, z))) return false;
  ctx.setBlock(x, y, z, state);
  return true;
}
