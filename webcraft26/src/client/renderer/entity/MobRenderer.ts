// Source: net.minecraft.client.renderer.entity.MobRenderer / LivingEntityRenderer
//
// Resolves a mob's baked model + texture from the registry and renders it with
// the shared transform in EntityRenderer.

import { EntityRenderer } from './EntityRenderer.js';
import { MODEL_REGISTRY, type ModelEntry } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

export class MobRenderer extends EntityRenderer<Entity> {
  private readonly tint: readonly [number, number, number] = [1, 1, 1];
  private readonly entry: ModelEntry;

  constructor(private readonly typeName: string) {
    super();
    this.entry = MODEL_REGISTRY[typeName];
  }

  getModel(): BakedModel { return this.entry.model; }
  getTextureKey(): string { return this.entry.texture; }
  getTint(): readonly [number, number, number] { return this.tint; }
}
