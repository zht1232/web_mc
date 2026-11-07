// Port of net.minecraft.world.level.levelgen.feature.SimpleRandomSelectorFeature.
// Picks one of config.features uniformly (random.nextInt(size)) and places it.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, api: FeatureApi,
): boolean {
  const entries: Cfg[] = config.features ?? [];
  if (entries.length === 0) return false;
  return api.runPlaced(ctx, entries[random.nextInt(entries.length)], random, '', x, y, z);
}
