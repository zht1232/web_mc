// Port of net.minecraft.world.level.levelgen.feature.DiskFeature (clay/gravel/sand/grass disks).
// Simplified: replace target blocks at/just below the surface with the disk state over a
// circular footprint of `radius` (vanilla also jitters the radius per column).

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleInt, sampleStateProvider, testPredicate } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, _y: number, z: number, _api: FeatureApi,
): boolean {
  const radius = Math.max(1, sampleInt(config.radius ?? 2, random));
  const halfHeight = config.half_height ?? 1;
  const state = sampleStateProvider(ctx, config.state_provider, random, x, 0, z);
  if (state === null) return false;
  let placedAny = false;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius + radius) continue;
      const px = x + dx, pz = z + dz;
      const surface = ctx.getHeight('WORLD_SURFACE_WG', px, pz) - 1;
      if (surface < ctx.minY) continue;
      for (let d = 0; d <= halfHeight; d++) {
        const py = surface - d;
        if (!testPredicate(ctx, config.target, px, py, pz)) break;
        ctx.setBlock(px, py, pz, state);
        placedAny = true;
      }
    }
  }
  return placedAny;
}
