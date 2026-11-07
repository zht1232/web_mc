// Port of net.minecraft.world.level.levelgen.feature.KelpFeature.
// Simplified: grow a kelp column upward from the origin until the water surface.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { safeState } from './shared.js';

export function place(
  ctx: FeatureContext, _config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  if (!ctx.mc.isLiquid(ctx.getBlockState(x, y, z))) return false;
  const kelp = safeState(ctx, 'kelp');
  const plant = safeState(ctx, 'kelp_plant');
  const height = 2 + random.nextInt(8);
  let placed = false;
  for (let dy = 0; dy < height; dy++) {
    const py = y + dy;
    if (!ctx.mc.isLiquid(ctx.getBlockState(x, py, z))) break;
    ctx.setBlock(x, py, z, dy === height - 1 ? kelp : plant);
    placed = true;
  }
  return placed;
}
