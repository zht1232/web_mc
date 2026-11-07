// Port of net.minecraft.world.level.levelgen.feature.SugarCaneFeature (classic
// `minecraft:sugar_cane`). 26.2 expresses sugar cane as `block_column`.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { growSimple } from './columns.js';

export function place(
  ctx: FeatureContext, _config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  // Sugar cane needs water adjacent to the block below (simplified to "some liquid nearby").
  let nearWater = false;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (ctx.mc.isLiquid(ctx.getBlockState(x + dx, y - 1, z + dz))) { nearWater = true; break; }
  }
  if (!nearWater) return false;
  return growSimple(ctx, random, x, y, z, 'sugar_cane', 3);
}
