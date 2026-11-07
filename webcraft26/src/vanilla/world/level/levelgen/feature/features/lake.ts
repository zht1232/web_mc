// Simplified port of net.minecraft.world.level.levelgen.feature.LakeFeature. LAKES is step 1
// and is skipped by FeatureGenerator (structures/lakes are optional per the brief), but the
// configured feature is implemented so `minecraft:lake` still produces a small fluid pool when
// referenced directly. The full barrier/shore carving is reduced to a shallow ellipsoid.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleStateProvider } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const fluid = sampleStateProvider(ctx, config.fluid, random, x, y, z);
  if (fluid === null) return false;
  const r = 3;
  let placedAny = false;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      const px = x + dx, pz = z + dz;
      const top = ctx.getHeight('WORLD_SURFACE_WG', px, pz) - 1;
      if (top < ctx.minY) continue;
      if (ctx.mc.isSolid(ctx.getBlockState(px, top, pz))) {
        ctx.setBlock(px, top, pz, fluid);
        placedAny = true;
      }
    }
  }
  return placedAny;
}
