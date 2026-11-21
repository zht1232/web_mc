// Source: net.minecraft.client.renderer.entity.ThrownItemRenderer (egg variant)
// The vanilla egg uses the item sprite; the batched entity pass renders a small
// off-white cube with the same size instead.

import { EntityRenderer } from './EntityRenderer.js';
import { EggModel } from './model/EntityModels.js';
import { WHITE_TEXTURE } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

const EGG_TINT: readonly [number, number, number] = [0.96, 0.93, 0.85];

export class ThrownEggRenderer extends EntityRenderer<Entity> {
  getModel(): BakedModel { return EggModel; }
  getTextureKey(): string { return WHITE_TEXTURE; }
  getTint(): readonly [number, number, number] { return EGG_TINT; }
  getShadowRadius(): number { return 0.1; }
}
