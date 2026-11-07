// Port of net.minecraft.world.level.levelgen.feature.WeightedRandomSelectorFeature.
// config.features is a WeightedList of {data: placedFeature, weight}; one weighted draw selects.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, api: FeatureApi,
): boolean {
  const entries: Cfg[] = config.features ?? [];
  let total = 0;
  for (const e of entries) total += e.weight ?? 1;
  if (total <= 0) return false;
  let r = random.nextInt(total);
  for (const e of entries) {
    r -= e.weight ?? 1;
    if (r < 0) return api.runPlaced(ctx, e.data, random, '', x, y, z);
  }
  return false;
}
