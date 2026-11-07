// Port of net.minecraft.world.level.levelgen.feature.SnowAndFreezeFeature
// (the `minecraft:freeze_top_layer` configured feature, step TOP_LAYER_MODIFICATION). Its placed
// feature chain is just [biome], so it receives the chunk origin and iterates the whole 16x16
// chunk itself, exactly like vanilla.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { safeState } from './shared.js';

export function place(
  ctx: FeatureContext, _config: Cfg, _random: FeatureRandom, x: number, _y: number, z: number, _api: FeatureApi,
): boolean {
  const ice = safeState(ctx, 'ice');
  const snow = safeState(ctx, 'snow');
  let placedAny = false;
  for (let dx = 0; dx < 16; dx++) {
    for (let dz = 0; dz < 16; dz++) {
      const px = x + dx, pz = z + dz;
      const topY = ctx.getHeight('MOTION_BLOCKING', px, pz) - 1;
      if (topY < ctx.minY) continue;
      const id = ctx.biomeAt(px, pz);
      // Biome.coldEnoughToSnow ~ temperature < 0.15, plus precipitation.
      if (!ctx.biomeHasPrecipitation(id) || ctx.biomeTemperature(id) >= 0.15) continue;
      const topState = ctx.getBlockState(px, topY, pz);
      if (ctx.mc.isLiquid(topState)) {
        ctx.setBlock(px, topY, pz, ice);
      } else {
        ctx.setBlock(px, topY + 1, pz, snow);
      }
      placedAny = true;
    }
  }
  return placedAny;
}
