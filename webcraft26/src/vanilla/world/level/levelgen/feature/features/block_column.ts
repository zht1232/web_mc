// Port of net.minecraft.world.level.levelgen.feature.BlockColumnFeature (26.2). Used for
// `minecraft:cactus`, `minecraft:sugar_cane` and `minecraft:cave_vine` via their layers.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { growColumn } from './columns.js';

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const dirY = config.direction === 'down' ? -1 : 1;
  return growColumn(ctx, random, x, y, z, dirY, config.layers ?? [], config.allowed_placement);
}
