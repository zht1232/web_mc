// Port of net.minecraft.world.level.levelgen.feature.RandomBooleanSelectorFeature.
// One nextBoolean() decides between config.feature_true and config.feature_false.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, api: FeatureApi,
): boolean {
  const ref = random.nextBoolean() ? config.feature_true : config.feature_false;
  return api.runPlaced(ctx, ref, random, '', x, y, z);
}
