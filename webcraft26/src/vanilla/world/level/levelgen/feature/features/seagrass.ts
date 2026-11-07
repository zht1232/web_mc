// Port of net.minecraft.world.level.levelgen.feature.SeagrassFeature.
// Places seagrass (or tall seagrass with `probability`) in water on a solid floor.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { safeState } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  if (!ctx.mc.isLiquid(ctx.getBlockState(x, y, z))) return false;
  const below = ctx.getBlockState(x, y - 1, z);
  if (ctx.mc.isAir(below) || ctx.mc.isLiquid(below)) return false;
  const tall = random.nextFloat() < (config.probability ?? 0);
  if (tall && ctx.mc.isLiquid(ctx.getBlockState(x, y + 1, z))) {
    const lower = safeState(ctx, 'tall_seagrass', { half: 'lower' });
    const upper = safeState(ctx, 'tall_seagrass', { half: 'upper' });
    ctx.setBlock(x, y, z, lower);
    ctx.setBlock(x, y + 1, z, upper);
  } else {
    ctx.setBlock(x, y, z, safeState(ctx, 'seagrass'));
  }
  return true;
}
