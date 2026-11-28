// Source: net.minecraft.client.renderer.entity.ItemEntityRenderer /
//         net.minecraft.client.renderer.entity.ExperienceOrbRenderer
//
// Dropped items use the baked item-icon atlas (the same isometric item model
// icons the GUI draws) as a small vertical sprite. GROUND display size is
// 0.25 blocks; bob/spin/stacked copies follow ItemEntityRenderer.submit:
//   bob = sin(age/10 + bobOffs) * 0.1 + 0.1 + ITEM_MIN_HOVER_HEIGHT
//   spin = ItemEntity.getSpin(age + partial, bobOffs) radians
//   amount = ItemClusterRenderState.getRenderedAmount(stack.count) copies, flat sprites spread
//            along local Z by 0.09375 with +-0.075 random x/y (seeded by item id + damage).
// XP orbs keep the small cube fallback with the vanilla green tint.

import { EntityRenderer, type EntityBatch } from './EntityRenderer.js';
import { ItemCubeModel } from './model/EntityModels.js';
import { flatSpriteModel } from './model/ModelBox.js';
import { ITEM_ICON_TEXTURE, WHITE_TEXTURE } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { ItemEntity } from '../../../vanilla/world/entity/item/ItemEntity.js';
import { LegacyRandomSource } from '../../../vanilla/core/Random.js';

/** The slice of ItemIconAtlas the entity pass needs (keeps gui out of the renderer import graph). */
export interface ItemIconSource {
  readonly bakedCanvas: HTMLCanvasElement | null;
  getCellRect(itemId: number): { x: number; y: number; size: number; atlas: number } | null;
}

const WHITE: readonly [number, number, number] = [1, 1, 1];
const XP_GREEN: readonly [number, number, number] = [0.55, 0.95, 0.25];
/** ItemEntityRenderer.ITEM_MIN_HOVER_HEIGHT. */
const ITEM_MIN_HOVER_HEIGHT = 0.0625;
/** ItemClusterRenderState.getRenderedAmount: 1, 2, 3, 4 or 5 rendered copies. */
export function renderedItemAmount(stackCount: number): number {
  if (stackCount <= 1) return 1;
  if (stackCount <= 16) return 2;
  if (stackCount <= 32) return 3;
  return stackCount <= 48 ? 4 : 5;
}

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

  /** ItemEntityRenderer.render: translate(0, sin((age + partial)/10 + bobOffs)*0.1 + 0.1 + minY, 0). */
  getRenderYOffset(e: Entity, partialTick: number): number {
    if (e.getTypeName() !== 'item') return 0;
    const item = e as ItemEntity;
    // ItemEntityRenderer.ITEM_MIN_HOVER_HEIGHT keeps the sprite off the ground in addition to
    // the bob; the old value stopped 0.0625 blocks low.
    return Math.sin((item.age + partialTick) / 10 + item.bobOffs) * 0.1 + 0.1 + ITEM_MIN_HOVER_HEIGHT;
  }

  /**
   * ItemEntityRenderer.submitMultipleFromCount: flat sprites (model depth <= 1/16) are spread
   * along the local Z axis in `renderedAmount` copies, each later copy nudged +-0.075 on X/Y.
   * The random sequence starts from a seed derived from item id + damage, so a stack looks the
   * same every frame.
   */
  override append(e: Entity, batch: EntityBatch, texId: number, partialTick: number): void {
    if (!this.isSpriteEntity(e)) {
      super.append(e, batch, texId, partialTick);
      return;
    }
    const stack = (e as ItemEntity).getItem();
    const amount = renderedItemAmount(stack?.getCount() ?? 1);
    const model = this.getModel(e);
    const tint = this.getTint(e);
    if (amount <= 1) {
      this.appendModel(e, model, tint, batch, texId, partialTick);
      return;
    }
    const item = e as ItemEntity;
    const seed = (stack?.item?.id ?? 0) + (stack?.components.damage ?? 0);
    const random = new LegacyRandomSource(BigInt(seed));
    const offsetZ = 0.09375;                       // modelDepth 1/16 * 1.5
    const yawRad = (item.yaw * Math.PI) / 180;
    const cos = Math.cos(yawRad);
    const sin = Math.sin(yawRad);
    for (let i = 0; i < amount; i++) {
      let ox = 0;
      let oy = 0;
      let oz = offsetZ * (i - (amount - 1) / 2);
      if (i > 0) {
        ox = (random.nextFloat() * 2 - 1) * 0.15 * 0.5;
        oy = (random.nextFloat() * 2 - 1) * 0.15 * 0.5;
      }
      // Offsets live in the spinning model frame (RY(180 - yaw) is part of the root matrix).
      const wx = cos * ox - sin * oz;
      const wz = sin * ox + cos * oz;
      this.appendModel(e, model, tint, batch, texId, partialTick, [wx, oy, wz]);
    }
  }
}
