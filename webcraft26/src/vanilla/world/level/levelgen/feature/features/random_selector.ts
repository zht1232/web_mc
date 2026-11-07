// Port of net.minecraft.world.level.levelgen.feature.RandomSelectorFeature.
// Walks the weighted entries in order, consuming one nextFloat() per entry; the first match is
// placed, otherwise config.default. Nested placed features share the same random stream.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, api: FeatureApi,
): boolean {
  const entries: Cfg[] = config.features ?? [];
  for (const e of entries) {
    if (random.nextFloat() < (e.chance ?? 0)) {
      return api.runPlaced(ctx, e.feature, random, '', x, y, z);
    }
  }
  return api.runPlaced(ctx, config.default, random, '', x, y, z);
}
