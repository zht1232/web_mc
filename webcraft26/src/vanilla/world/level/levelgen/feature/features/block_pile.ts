// Port of net.minecraft.world.level.levelgen.feature.BlockPileFeature (hay/ice/melon/pumpkin
// piles, mostly village/nether features). Simplified: a small 3x3 mound of the state provider.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleStateProvider } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const provider = config.state_provider ?? config;
  let placedAny = false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const h = 1 + ((dx === 0 && dz === 0) ? 1 : 0);
      for (let dy = 0; dy < h; dy++) {
        const px = x + dx, py = y + dy, pz = z + dz;
        if (!ctx.mc.isAir(ctx.getBlockState(px, py, pz))) continue;
        const state = sampleStateProvider(ctx, provider, random, px, py, pz);
        if (state !== null) { ctx.setBlock(px, py, pz, state); placedAny = true; }
      }
    }
  }
  return placedAny;
}
