// Port of net.minecraft.world.level.levelgen.feature.RandomPatchFeature and
// net.minecraft.world.level.levelgen.feature.VegetationPatchFeature (26.2 `vegetation_patch` /
// `waterlogged_vegetation_patch`). Both scatter a nested placed feature over a small area; the
// exact vegetation-patch surface scanning is simplified to a heightmap lookup, which is enough
// for moss/clay/dripleaf patches (grass and flowers in 26.2 come from placement chains instead).

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { sampleInt } from './shared.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, api: FeatureApi,
): boolean {
  // 26.2 vegetation_patch
  if (config.vegetation_feature) {
    const radius = Math.max(1, sampleInt(config.xz_radius ?? 4, random));
    const chance = config.vegetation_chance ?? 0.1;
    const vegetation = config.vegetation_feature;
    const ground = config.ground_state;
    const replaceable = config.replaceable ?? '#minecraft:lush_ground_replaceable';
    let placed = false;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius + 1) continue;
        const px = x + dx, pz = z + dz;
        const top = ctx.getHeight('WORLD_SURFACE_WG', px, pz) - 1;
        if (top < ctx.minY) continue;
        const surfaceState = ctx.getBlockState(px, top, pz);
        if (!ctx.tags.has(replaceable, ctx.blockName(surfaceState))) continue;
        if (ground) {
          // place the ground-state provider (simple_state_provider in the data)
          const gs = ground.state?.Name ? stateFromName(ctx, ground.state) : null;
          if (gs !== null) ctx.setBlock(px, top, pz, gs);
        }
        if (random.nextFloat() < chance) {
          placed = api.runPlaced(ctx, vegetation, random, '', px, top + 1, pz) || placed;
        }
      }
    }
    return placed;
  }

  // classic random_patch: config.feature is a placed feature reference
  const feature = config.feature;
  if (!feature) return false;
  const tries = sampleInt(config.tries ?? 128, random);
  const xz = sampleInt(config.xz_spread ?? 7, random);
  const ys = sampleInt(config.y_spread ?? 3, random);
  let placed = false;
  for (let i = 0; i < tries; i++) {
    const px = x + random.nextInt(2 * xz + 1) - xz;
    const py = y + random.nextInt(2 * ys + 1) - ys;
    const pz = z + random.nextInt(2 * xz + 1) - xz;
    placed = api.runPlaced(ctx, feature, random, '', px, py, pz) || placed;
  }
  return placed;
}

function stateFromName(ctx: FeatureContext, node: Cfg): number | null {
  const name = typeof node === 'string' ? node : node.Name;
  const bare = (name as string).startsWith('minecraft:') ? (name as string).slice(10) : (name as string);
  if (!ctx.mc.blockByName.has(bare)) return null;
  const props = typeof node === 'object' ? node.Properties as Record<string, string> | undefined : undefined;
  return ctx.mc.stateOf(bare, props);
}
