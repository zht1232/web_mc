// Port of net.minecraft.world.level.levelgen.feature.SequenceFeature: runs each nested placed
// feature in order at the same origin, sharing one random stream.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, api: FeatureApi,
): boolean {
  let placedAny = false;
  for (const f of config.features ?? []) {
    placedAny = api.runPlaced(ctx, f, random, '', x, y, z) || placedAny;
  }
  return placedAny;
}
