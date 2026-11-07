// Source: net.minecraft.client.renderer.entity.ItemEntityRenderer
//
// Dropped items (and XP orbs) are rendered as a small textured cube. The
// existing item atlas is deliberately not used here (it is a TEXTURE_2D_ARRAY
// owned by the terrain pass); instead a solid colour derived from the item id
// is applied to the shared 1x1 white texture. Keeps the batch to one draw call.

import { EntityRenderer } from './EntityRenderer.js';
import { ItemCubeModel } from './model/EntityModels.js';
import { WHITE_TEXTURE } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { ItemEntity } from '../../../vanilla/world/entity/item/ItemEntity.js';

export class ItemEntityRenderer extends EntityRenderer<Entity> {
  private readonly tint: [number, number, number] = [1, 1, 1];

  getModel(): BakedModel { return ItemCubeModel; }
  getTextureKey(): string { return WHITE_TEXTURE; }

  /** Source: ItemEntityRenderer / ExperienceOrbRenderer shadowRadius. */
  getShadowRadius(): number { return 0.15; }

  getTint(e: Entity): readonly [number, number, number] {
    const it = (e as ItemEntity).getItem;
    const id = typeof it === 'function' ? it.call(e).id : (e.getTypeName ? e.getTypeName() : 'stone');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
    this.tint[0] = 0.45 + ((h >>> 0) & 255) / 640;
    this.tint[1] = 0.45 + ((h >>> 8) & 255) / 640;
    this.tint[2] = 0.45 + ((h >>> 16) & 255) / 640;
    return this.tint;
  }
}
