// Port of net.minecraft.world.level.levelgen.feature.CactusFeature (classic `minecraft:cactus`).
// 26.2 expresses cacti as `block_column`; this keeps the older feature name working.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { safeState } from './shared.js';

/**
 * CactusBlock#canSurvive (26.2):
 *  - the block below is sand (or another cactus),
 *  - no horizontal neighbour of any cactus block has a collision shape,
 *  - the column itself is air.
 * The old version only checked the sand and then grew through anything, which produced cacti
 * embedded in slopes and touching neighbouring blocks.
 */
export function place(
  ctx: FeatureContext, _config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const below = ctx.blockName(ctx.getBlockState(x, y - 1, z));
  if (!ctx.tags.has('sand', below) && below !== 'cactus') return false;

  const sidesClear = (py: number): boolean => {
    if (!ctx.mc.isAir(ctx.getBlockState(x + 1, py, z))) return false;
    if (!ctx.mc.isAir(ctx.getBlockState(x - 1, py, z))) return false;
    if (!ctx.mc.isAir(ctx.getBlockState(x, py, z + 1))) return false;
    if (!ctx.mc.isAir(ctx.getBlockState(x, py, z - 1))) return false;
    return true;
  };

  // Height 1..3, shrunk to whatever free column the terrain actually offers.
  let height = 1 + random.nextInt(3);
  while (height >= 1) {
    let ok = true;
    for (let i = 0; i < height; i++) {
      if (!ctx.mc.isAir(ctx.getBlockState(x, y + i, z)) || !sidesClear(y + i)) { ok = false; break; }
    }
    if (ok) break;
    height--;
  }
  if (height < 1) return false;

  const state = safeState(ctx, 'cactus');
  for (let i = 0; i < height; i++) ctx.setBlock(x, y + i, z, state);
  return true;
}
