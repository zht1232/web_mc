// Source: net.minecraft.client.renderer.entity.ItemEntityRenderer /
//         net.minecraft.client.renderer.entity.ExperienceOrbRenderer
//
// Dropped items use the baked item-icon atlas (the same isometric item model
// icons the GUI draws) as a small vertical sprite. Vanilla GROUND display size
// is 0.25 blocks; the sprite bobs and spins from ItemEntity.age, matching
// ItemEntityRenderer.render's `sin(age/10)*0.1 + 0.1` and `age/20` Y rotation.
// XP orbs keep the small cube fallback with the vanilla green tint.

import { EntityRenderer } from './EntityRenderer.js';
import { ItemCubeModel } from './model/EntityModels.js';
import { flatSpriteModel } from './model/ModelBox.js';
import { ITEM_ICON_TEXTURE, WHITE_TEXTURE } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { ItemEntity } from '../../../vanilla/world/entity/item/ItemEntity.js';

/** The slice of ItemIconAtlas the entity pass needs (keeps gui out of the renderer import graph). */
export interface ItemIconSource {
  readonly bakedCanvas: HTMLCanvasElement | null;
  getCellRect(itemId: number): { x: number; y: number; size: number; atlas: number } | null;
}

const WHITE: readonly [number, number, number] = [1, 1, 1];
const XP_GREEN: readonly [number, number, number] = [0.55, 0.95, 0.25];

export class ItemEntityRenderer extends EntityRenderer<Entity> {
  private atlas: ItemIconSource | null = null;
  /** cell rect key -> baked sprite model (atlas rebuilds produce new keys). */
  private readonly sprites = new Map<string, BakedModel>();

  setIconAtlas(atlas: ItemIconSource): void {
    this.atlas = atlas;
    this.sprites.clear();
  }

  /**
   * Item entities plus thrown splash/lingering potions (ThrownItemRenderer draws the
   * same item sprite); their stack comes from `getItem()`.
   */
  private isSpriteEntity(e: Entity): boolean {
    const name = e.getTypeName();
    return name === 'item' || name === 'splash_potion' || name === 'lingering_potion';
  }

  private itemIdOf(e: Entity): number {
    const stack = (e as ItemEntity).getItem();
    return stack?.item ? stack.item.id : -1;
  }

  getModel(e: Entity): BakedModel {
    if (!this.isSpriteEntity(e)) return ItemCubeModel;
    const rect = this.atlas?.getCellRect(this.itemIdOf(e));
    if (!rect) return ItemCubeModel; // atlas not built / item without an icon
    const key = `${rect.atlas}:${rect.x}:${rect.y}:${rect.size}`;
    let model = this.sprites.get(key);
    if (!model) {
      model = flatSpriteModel(rect.x, rect.y, rect.x + rect.size, rect.y + rect.size, rect.atlas, rect.atlas);
      this.sprites.set(key, model);
    }
    return model;
  }

  getTextureKey(e: Entity): string {
    if (!this.isSpriteEntity(e)) return WHITE_TEXTURE;
    return this.atlas?.getCellRect(this.itemIdOf(e)) ? ITEM_ICON_TEXTURE : WHITE_TEXTURE;
  }

  /** Source: ItemEntityRenderer / ExperienceOrbRenderer shadowRadius. */
  getShadowRadius(): number { return 0.15; }

  getTint(e: Entity): readonly [number, number, number] {
    return e.getTypeName() === 'experience_orb' ? XP_GREEN : WHITE;
  }

  /** ItemEntityRenderer.render: translate(0, sin((age + partial)/10 + bobOffs)*0.1 + 0.1, 0). */
  getRenderYOffset(e: Entity, partialTick: number): number {
    if (e.getTypeName() !== 'item') return 0;
    const item = e as ItemEntity;
    return Math.sin((item.age + partialTick) / 10 + item.bobOffs) * 0.1 + 0.1;
  }
}
