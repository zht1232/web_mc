// Source: net.minecraft.client.renderer.entity.EntityRenderDispatcher (registry side)
//
// Maps a vanilla entity type name to its baked model and texture path under
// public/mc/textures/entity/**. Also exposes the fixed texture key list used to
// allocate the batched VBO buckets.

import type { BakedModel } from './ModelBox.js';
import {
  ZombieModel, SkeletonModel, CreeperModel, SpiderModel, EndermanModel, SilverfishModel,
  PigModel, CowModel, SheepModel, ChickenModel, WolfModel, RabbitModel, BatModel,
  QuadrupedModel,
} from './EntityModels.js';

export interface ModelEntry {
  model: BakedModel;
  /** path relative to /mc/textures/entity/ (without .png) */
  texture: string;
}

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  zombie: { model: ZombieModel, texture: 'zombie/zombie' },
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
  // Zombie / skeleton variants share the base humanoid model; only the skin differs.
  husk: { model: ZombieModel, texture: 'zombie/husk' },
  drowned: { model: ZombieModel, texture: 'zombie/drowned' },
  stray: { model: SkeletonModel, texture: 'skeleton/stray' },
  bogged: { model: SkeletonModel, texture: 'skeleton/bogged' },
  // QuadrupedModel is exported for standalone use / as a fallback.
  quadruped: { model: QuadrupedModel, texture: 'pig/pig_temperate' },
};

/** Special key for the generated 1x1 white texture used by items/arrows. */
export const WHITE_TEXTURE = '__white__';

/** Stable ordered list of every texture the dispatcher may bind. */
export const ALL_TEXTURE_KEYS: string[] = (() => {
  const set = new Set<string>();
  for (const name of Object.keys(MODEL_REGISTRY)) set.add(MODEL_REGISTRY[name].texture);
  set.add(WHITE_TEXTURE);
  return Array.from(set);
})();

export function getModelEntry(typeName: string): ModelEntry | undefined {
  return MODEL_REGISTRY[typeName];
}
