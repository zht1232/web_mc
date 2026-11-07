// Dispatch table for net.minecraft.world.level.levelgen.feature.* configured features.
// Types not ported (nether/end/structure/cave features) resolve to no_op.place, so an unknown
// configured feature is a deterministic no-op instead of a crash.

import type { Cfg, FeatureApi, FeatureContext, FeaturePlaceFn } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

import * as tree from './tree.js';
import * as random_patch from './random_patch.js';
import * as simple_block from './simple_block.js';
import * as flower from './flower.js';
import * as ore from './ore.js';
import * as block_pile from './block_pile.js';
import * as block_blob from './block_blob.js';
import * as seagrass from './seagrass.js';
import * as kelp from './kelp.js';
import * as cactus from './cactus.js';
import * as sugar_cane from './sugar_cane.js';
import * as block_column from './block_column.js';
import * as bamboo from './bamboo.js';
import * as no_op from './no_op.js';
import * as random_boolean_selector from './random_boolean_selector.js';
import * as random_selector from './random_selector.js';
import * as weighted_random_selector from './weighted_random_selector.js';
import * as simple_random_selector from './simple_random_selector.js';
import * as sequence from './sequence.js';
import * as spring_feature from './spring_feature.js';
import * as lake from './lake.js';
import * as freeze_top_layer from './freeze_top_layer.js';
import * as disk from './disk.js';

const NOP: FeaturePlaceFn = no_op.place;

export const FEATURES: Record<string, FeaturePlaceFn> = {
  'minecraft:tree': tree.place,
  'minecraft:random_patch': random_patch.place,
  'minecraft:vegetation_patch': random_patch.place,
  'minecraft:waterlogged_vegetation_patch': random_patch.place,
  'minecraft:nether_forest_vegetation': NOP,
  'minecraft:simple_block': simple_block.place,
  'minecraft:flower': flower.place,
  'minecraft:ore': ore.place,
  'minecraft:scattered_ore': ore.place,
  'minecraft:block_pile': block_pile.place,
  'minecraft:block_blob': block_blob.place,
  'minecraft:seagrass': seagrass.place,
  'minecraft:kelp': kelp.place,
  'minecraft:cactus': cactus.place,
  'minecraft:sugar_cane': sugar_cane.place,
  'minecraft:block_column': block_column.place,
  'minecraft:bamboo': bamboo.place,
  'minecraft:no_op': NOP,
  'minecraft:random_boolean_selector': random_boolean_selector.place,
  'minecraft:random_selector': random_selector.place,
  'minecraft:weighted_random_selector': weighted_random_selector.place,
  'minecraft:simple_random_selector': simple_random_selector.place,
  'minecraft:sequence': sequence.place,
  'minecraft:spring_feature': spring_feature.place,
  'minecraft:lake': lake.place,
  'minecraft:freeze_top_layer': freeze_top_layer.place,
  'minecraft:disk': disk.place,

  // Deliberately not ported (structure / nether / end / complex cave features):
  'minecraft:huge_fungus': NOP,
  'minecraft:geode': NOP,
  'minecraft:iceberg': NOP,
  'minecraft:basalt_columns': NOP,
  'minecraft:basalt_pillar': NOP,
  'minecraft:end_gateway': NOP,
  'minecraft:end_island': NOP,
  'minecraft:end_platform': NOP,
  'minecraft:end_spike': NOP,
  'minecraft:void_start_platform': NOP,
  'minecraft:fossil': NOP,
  'minecraft:monster_room': NOP,
  'minecraft:desert_well': NOP,
  'minecraft:blue_ice': NOP,
  'minecraft:large_dripstone': NOP,
  'minecraft:netherrack_replace_blobs': NOP,
  'minecraft:glowstone_blob': NOP,
  'minecraft:sculk_patch': NOP,
  'minecraft:speleothem_cluster': NOP,
  'minecraft:twisting_vines': NOP,
  'minecraft:weeping_vines': NOP,
  'minecraft:vines': NOP,
  'minecraft:multiface_growth': NOP,
  'minecraft:root_system': NOP,
  'minecraft:underwater_magma': NOP,
  'minecraft:sea_pickle': NOP,
  'minecraft:spike': NOP,
  'minecraft:delta_feature': NOP,
  'minecraft:huge_brown_mushroom': NOP,
  'minecraft:huge_red_mushroom': NOP,
  'minecraft:fallen_tree': NOP,
  'minecraft:bonus_chest': NOP,
  'minecraft:chorus_plant': NOP,
};

export function dispatchFeature(
  type: string, ctx: FeatureContext, config: Cfg, random: FeatureRandom,
  x: number, y: number, z: number, api: FeatureApi,
): boolean {
  const fn = FEATURES[type];
  return fn ? fn(ctx, config, random, x, y, z, api) : false;
}
