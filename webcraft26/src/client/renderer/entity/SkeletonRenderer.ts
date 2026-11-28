// Source: net.minecraft.client.renderer.entity.AbstractSkeletonRenderer / SkeletonRenderer
//
// The skeleton family draws no bespoke weapon shape any more: the main-hand stack
// is submitted by the generic held-item pass (ItemInHandLayer), which places the
// real item model with the thirdperson_righthand display pose on the same right-arm
// matrix the body model captured (SkeletonModel.handOffsetX handles the
// SkeletonModel.translateToHand +1 texel shift). Body texture/model selection and
// the armor layers are shared with MobRenderer.

import { MobRenderer } from './MobRenderer.js';

export class SkeletonRenderer extends MobRenderer {
  constructor(typeName: string) {
    super(typeName);
  }
}
