// Port of net.minecraft.world.level.levelgen.feature.BlockBlobFeature (`minecraft:forest_rock`).
// Simplified: a small ellipsoid of `state` resting on a `can_place_on` block.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { stateOf, testPredicate } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  if (!testPredicate(ctx, config.can_place_on, x, y - 1, z)) return false;
  const state = stateOf(ctx, config.state);
  const r = 2;
  let placedAny = false;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = 0; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dy * dy * 2 + dz * dz > r * r + 1) continue;
        if (random.nextFloat() < 0.1) continue;
        const px = x + dx, py = y + dy, pz = z + dz;
        if (!ctx.mc.isAir(ctx.getBlockState(px, py, pz))) continue;
        ctx.setBlock(px, py, pz, state);
        placedAny = true;
      }
    }
  }
  return placedAny;
}
