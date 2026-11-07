// Port of net.minecraft.world.level.levelgen.feature.CactusFeature (classic `minecraft:cactus`).
// 26.2 expresses cacti as `block_column`; this keeps the older feature name working.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { growSimple } from './columns.js';

export function place(
  ctx: FeatureContext, _config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  if (!ctx.tags.has('sand', ctx.blockName(ctx.getBlockState(x, y - 1, z)))) return false;
  return growSimple(ctx, random, x, y, z, 'cactus', 3);
}
