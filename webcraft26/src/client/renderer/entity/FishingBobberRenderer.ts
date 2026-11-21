// Source: net.minecraft.client.renderer.entity.FishingHookRenderer
//
// The vanilla bobber is a tiny two-tone float; the line to the rod is drawn as
// a curve from the player's hand, which the batched entity pass cannot express
// (it has no per-frame line geometry), so only the float is rendered here.

import { EntityRenderer } from './EntityRenderer.js';
import { FishingBobberModel } from './model/EntityModels.js';
import { WHITE_TEXTURE } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { FishingBobber } from '../../../vanilla/world/entity/projectile/FishingBobber.js';

const WHITE: readonly [number, number, number] = [1, 1, 1];

export class FishingBobberRenderer extends EntityRenderer<Entity> {
  getModel(): BakedModel { return FishingBobberModel; }
  getTextureKey(): string { return WHITE_TEXTURE; }
  getTint(): readonly [number, number, number] { return WHITE; }

  /** FishingHookRenderer has no shadow. */
  getShadowRadius(): number { return 0; }

  /** Bobbing on the water surface (FishingHook.getBobbing / render offset). */
  getRenderYOffset(e: Entity): number {
    return (e as FishingBobber).bob ?? 0;
  }
}
