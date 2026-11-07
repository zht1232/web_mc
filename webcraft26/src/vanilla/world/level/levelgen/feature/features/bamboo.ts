// Port of net.minecraft.world.level.levelgen.feature.BambooFeature.
// Simplified: grow a bamboo stalk of random height, optionally placing podzol below with
// config.probability.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { growSimple } from './columns.js';
import { safeState } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  if ((config.probability ?? 0) > 0 && random.nextFloat() < config.probability) {
    ctx.setBlock(x, y - 1, z, safeState(ctx, 'podzol'));
  }
  return growSimple(ctx, random, x, y, z, 'bamboo', 8);
}
