// Source: net.minecraft.client.renderer.entity.EntityRenderDispatcher (registry side)
//
// Maps a vanilla entity type name to its baked model and texture path under
// public/mc/textures/entity/**. Also exposes the fixed texture key list used to
// allocate the batched VBO buckets.

import type { BakedModel } from './ModelBox.js';
import {
  ZombieModel, PlayerModel, ZombieVillagerModel, SkeletonModel, CreeperModel, SpiderModel, EndermanModel,
  SilverfishModel, SlimeModel, WitchModel,
  PigModel, CowModel, SheepModel, SheepFurModel, ChickenModel, WolfModel, FoxModel, FelineModel, ParrotModel,
  RabbitModel, BatModel, SquidModel, CodModel, SalmonModel,
  QuadrupedModel,
} from './EntityModels.js';

export interface ModelEntry {
  model: BakedModel;
  /** path relative to /mc/textures/entity/ (without .png) */
  texture: string;
}

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  zombie: { model: ZombieModel, texture: 'zombie/zombie' },
  // Survival-inventory preview only (no other players in this build).
  player: { model: PlayerModel, texture: 'player/wide/steve' },
  skeleton: { model: SkeletonModel, texture: 'skeleton/skeleton' },
  creeper: { model: CreeperModel, texture: 'creeper/creeper' },
  spider: { model: SpiderModel, texture: 'spider/spider' },
  enderman: { model: EndermanModel, texture: 'enderman/enderman' },
  silverfish: { model: SilverfishModel, texture: 'silverfish/silverfish' },
  pig: { model: PigModel, texture: 'pig/pig_temperate' },
  cow: { model: CowModel, texture: 'cow/cow_temperate' },
  sheep: { model: SheepModel, texture: 'sheep/sheep' },
  chicken: { model: ChickenModel, texture: 'chicken/chicken_temperate' },
  wolf: { model: WolfModel, texture: 'wolf/wolf' },
  rabbit: { model: RabbitModel, texture: 'rabbit/rabbit_brown' },
  bat: { model: BatModel, texture: 'bat/bat' },
  // Mobs that had a factory but no renderer (HANDOFF 8.1); registering them
  // here is what removes Game.init's "no renderer => no natural spawn" filter.
  slime: { model: SlimeModel, texture: 'slime/slime' },
  witch: { model: WitchModel, texture: 'witch/witch' },
  cave_spider: { model: SpiderModel, texture: 'spider/cave_spider' },
  zombie_villager: { model: ZombieVillagerModel, texture: 'zombie_villager/zombie_villager' },
  fox: { model: FoxModel, texture: 'fox/fox' },
  cat: { model: FelineModel, texture: 'cat/cat_tabby' },
  ocelot: { model: FelineModel, texture: 'cat/ocelot' },
  parrot: { model: ParrotModel, texture: 'parrot/parrot_red_blue' },
  squid: { model: SquidModel, texture: 'squid/squid' },
  glow_squid: { model: SquidModel, texture: 'squid/glow_squid' },
  cod: { model: CodModel, texture: 'fish/cod' },
  salmon: { model: SalmonModel, texture: 'fish/salmon' },
  // Zombie / skeleton variants share the base humanoid model; only the skin differs.
  husk: { model: ZombieModel, texture: 'zombie/husk' },
  drowned: { model: ZombieModel, texture: 'zombie/drowned' },
  stray: { model: SkeletonModel, texture: 'skeleton/stray' },
  bogged: { model: SkeletonModel, texture: 'skeleton/bogged' },
  wither_skeleton: { model: SkeletonModel, texture: 'skeleton/wither_skeleton' },
  parched: { model: SkeletonModel, texture: 'skeleton/parched' },
  magma_cube: { model: SlimeModel, texture: 'slime/magmacube' },
  mooshroom: { model: CowModel, texture: 'cow/mooshroom_red' },
  zombified_piglin: { model: ZombieModel, texture: 'piglin/zombified_piglin' },
  // QuadrupedModel is exported for standalone use / as a fallback.
  quadruped: { model: QuadrupedModel, texture: 'pig/pig_temperate' },
};

/** Special key for the generated 1x1 white texture used by arrows / fallbacks. */
export const WHITE_TEXTURE = '__white__';
/** Special key for the baked 2D item-icon atlas uploaded by the entity dispatcher. */
export const ITEM_ICON_TEXTURE = '__item_icons__';

/**
 * Textures that are not tied to a standalone entity type. The sheep wool is a
 * second render layer on top of `sheep` (SheepRenderer's SheepFurModel layer).
 */
export const ARMOR_MATERIALS = [
  'leather', 'chainmail', 'iron', 'gold', 'diamond', 'netherite', 'copper', 'turtle_scute',
] as const;
/** Turtle scute only has a helmet, so it has no leggings texture. */
export const ARMOR_LEGGING_MATERIALS = [
  'leather', 'chainmail', 'iron', 'gold', 'diamond', 'netherite', 'copper',
] as const;

export const ARMOR_LAYER1_TEXTURE = (material: string): string => `equipment/humanoid/${material}`;
export const ARMOR_LAYER2_TEXTURE = (material: string): string => `equipment/humanoid_leggings/${material}`;

/** Block textures drawn by entity renderers (PrimedTnt) instead of entity skins. */
export const TNT_SIDE_TEXTURE = 'block/tnt_side';
export const TNT_TOP_TEXTURE = 'block/tnt_top';
export const TNT_BOTTOM_TEXTURE = 'block/tnt_bottom';

export const EXTRA_TEXTURE_KEYS: readonly string[] = [
  'sheep/sheep_wool',
  ...ARMOR_MATERIALS.map(ARMOR_LAYER1_TEXTURE),
  ...ARMOR_LEGGING_MATERIALS.map(ARMOR_LAYER2_TEXTURE),
  TNT_SIDE_TEXTURE,
  TNT_TOP_TEXTURE,
  TNT_BOTTOM_TEXTURE,
];

/** Second-layer model for the sheep's wool (SheepRenderer + SheepFurModel). */
export const SHEEP_WOOL_MODEL = SheepFurModel;
export const SHEEP_WOOL_TEXTURE = 'sheep/sheep_wool';

/** Stable ordered list of every texture the dispatcher may bind. */
export const ALL_TEXTURE_KEYS: string[] = (() => {
  const set = new Set<string>();
  for (const name of Object.keys(MODEL_REGISTRY)) set.add(MODEL_REGISTRY[name].texture);
  for (const key of EXTRA_TEXTURE_KEYS) set.add(key);
  set.add(WHITE_TEXTURE);
  set.add(ITEM_ICON_TEXTURE);
  return Array.from(set);
})();

export function getModelEntry(typeName: string): ModelEntry | undefined {
  return MODEL_REGISTRY[typeName];
}
