// Source: net.minecraft.client.renderer.entity.TntRenderer
//
// Primed TNT is rendered as a 1x1x1 block cube. The vanilla block uses three
// textures (side / top / bottom), so the cube is the base layer and the two
// caps are extra render layers. The white flash follows
// TntRenderer.getWhiteOverlayProgress: the fuse blinks in 5-tick steps.

import { EntityRenderer } from './EntityRenderer.js';
import { TntModel, TntTopModel, TntBottomModel } from './model/EntityModels.js';
import {
  TNT_SIDE_TEXTURE, TNT_TOP_TEXTURE, TNT_BOTTOM_TEXTURE,
} from './model/ModelRegistry.js';
import type { EntityLayer } from './EntityRenderer.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { PrimedTnt } from '../../../vanilla/world/entity/item/PrimedTnt.js';

const WHITE: readonly [number, number, number] = [1, 1, 1];

export class TntRenderer extends EntityRenderer<Entity> {
  private readonly layers: readonly EntityLayer[] = [
    { model: TntTopModel, texture: TNT_TOP_TEXTURE, tint: WHITE },
    { model: TntBottomModel, texture: TNT_BOTTOM_TEXTURE, tint: WHITE },
  ];

  getModel(): BakedModel { return TntModel; }
  getTextureKey(): string { return TNT_SIDE_TEXTURE; }
  getTint(): readonly [number, number, number] { return WHITE; }
  getLayers(): readonly EntityLayer[] { return this.layers; }

  /** TntRenderer constructor: super(context, 0.5F). */
  getShadowRadius(): number { return 0.5; }

  /** TntRenderer.getWhiteOverlayProgress: the fuse blinks in 5-tick steps. */
  getWhiteOverlay(e: Entity): number {
    const fuse = (e as PrimedTnt).fuse ?? 0;
    return Math.floor(fuse / 5) % 2 === 0 ? 0 : 0.9;
  }
}
