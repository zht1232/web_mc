// Port of net.minecraft.world.level.levelgen.feature.FlowerFeature (classic `minecraft:flower`).
// 26.2 no longer ships this configured feature - flowers are `simple_block` + a placement chain -
// but the classic behaviour (a scattered patch of weighted flower states) is kept so older data
// packs and the `flower` feature name still produce flowers.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleInt, sampleStateProvider } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const tries = sampleInt(config.tries ?? 64, random);
  const xz = sampleInt(config.xz_spread ?? 7, random);
  const ys = sampleInt(config.y_spread ?? 3, random);
  const provider = config.state_provider ?? config.to_place ?? config.block_placer;
  let placed = false;
  for (let i = 0; i < tries; i++) {
    const px = x + random.nextInt(2 * xz + 1) - xz;
    const py = y + random.nextInt(2 * ys + 1) - ys;
    const pz = z + random.nextInt(2 * xz + 1) - xz;
    const state = sampleStateProvider(ctx, provider, random, px, py, pz);
    if (state !== null && ctx.mc.isAir(ctx.getBlockState(px, py, pz))) {
      ctx.setBlock(px, py, pz, state);
      placed = true;
    }
  }
  return placed;
}
