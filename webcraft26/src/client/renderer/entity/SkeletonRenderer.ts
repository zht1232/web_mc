// Source: net.minecraft.client.renderer.entity.SkeletonRenderer
//
// The skeleton's bow is an equipment layer, not a baked child of the body model:
// it is emitted only while the main hand actually contains a bow. The layer's
// root is the right arm, so it follows the BOW_AND_ARROW arm pose computed by
// the same animator state as the body.

import { MobRenderer } from './MobRenderer.js';
import { WHITE_TEXTURE } from './model/ModelRegistry.js';
import { bakeModel, withAnimator, type BakedModel } from './model/ModelBox.js';
import type { EntityLayer } from './EntityRenderer.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { LivingEntity } from '../../../vanilla/world/entity/LivingEntity.js';

// Bow tints: arm UV (40,16) texels average ~147/255 (0.576); the tint lands the
// wood on vanilla bow brown (~#6b4a29) and the string on near-white.
const BOW_WOOD = [0.73, 0.5, 0.28] as const;
const BOW_STRING = [1.6, 1.6, 1.5] as const;
const SWORD_BLADE = [0.78, 0.78, 0.8] as const;
const SWORD_GUARD = [0.35, 0.35, 0.35] as const;
const SWORD_HANDLE = [0.45, 0.3, 0.15] as const;

/** SkeletonModel's bow subtree, re-rooted at the right arm's rest pose. */
const SkeletonBowModel: BakedModel = withAnimator(bakeModel({
  texW: 64,
  texH: 32,
  children: [{
    name: 'right_arm',
    pose: { x: -5, y: 2, z: 0 },
    children: [{
      name: 'bow',
      pose: { x: 0, y: 10, z: 1 },
      boxes: [{ x: -0.5, y: -0.5, z: -1.5, w: 1, h: 1, d: 3, u: 40, v: 16 }],
      tint: BOW_WOOD,
      children: [
        {
          name: 'bow_limb_top1', pose: { x: 0, y: 0, z: 1.5, rx: -0.25 },
          boxes: [{ x: -0.5, y: -0.5, z: 0, w: 1, h: 1, d: 2.5, u: 40, v: 16 }], tint: BOW_WOOD,
          children: [{
            name: 'bow_limb_top2', pose: { x: 0, y: 0, z: 2.5, rx: -0.25 },
            boxes: [{ x: -0.5, y: -0.5, z: 0, w: 1, h: 1, d: 2.5, u: 40, v: 16 }], tint: BOW_WOOD,
          }],
        },
        {
          name: 'bow_limb_bot1', pose: { x: 0, y: 0, z: -1.5, rx: 0.25 },
          boxes: [{ x: -0.5, y: -0.5, z: -2.5, w: 1, h: 1, d: 2.5, u: 40, v: 16 }], tint: BOW_WOOD,
          children: [{
            name: 'bow_limb_bot2', pose: { x: 0, y: 0, z: -2.5, rx: 0.25 },
            boxes: [{ x: -0.5, y: -0.5, z: -2.5, w: 1, h: 1, d: 2.5, u: 40, v: 16 }], tint: BOW_WOOD,
          }],
        },
        // The string sits on the archer's side (negative bow-local y in the aim pose).
        { name: 'bow_string_0', boxes: [{ x: -0.2, y: -2.1, z: -6.1, w: 0.4, h: 0.4, d: 3.05, u: 40, v: 16 }], tint: BOW_STRING },
        { name: 'bow_string_1', boxes: [{ x: -0.2, y: -2.1, z: -3.05, w: 0.4, h: 0.4, d: 3.05, u: 40, v: 16 }], tint: BOW_STRING },
        { name: 'bow_string_2', boxes: [{ x: -0.2, y: -2.1, z: 0, w: 0.4, h: 0.4, d: 3.05, u: 40, v: 16 }], tint: BOW_STRING },
        { name: 'bow_string_3', boxes: [{ x: -0.2, y: -2.1, z: 3.05, w: 0.4, h: 0.4, d: 3.05, u: 40, v: 16 }], tint: BOW_STRING },
      ],
    }],
  }],
}), (model, ctx) => {
  if (!ctx.isHoldingBow) return;
  const arm = model.byName.get('right_arm');
  if (arm === undefined) return;
  const p = model.poses[arm];
  // HumanoidModel.ArmPose.BOW_AND_ARROW (same values as SkeletonModel's animator).
  p.rx = -Math.PI / 2 + ctx.headPitch;
  p.ry = -0.1 + ctx.headYaw;
  p.rz = 0;
});

/**
 * A melee weapon layer for skeleton variants (wither skeleton's stone sword).
 * Re-rooted at the right arm so it follows the same melee arm swing as the body.
 */
const SkeletonSwordModel: BakedModel = withAnimator(bakeModel({
  texW: 64,
  texH: 32,
  children: [{
    name: 'right_arm',
    pose: { x: -5, y: 2, z: 0 },
    children: [
      {
        name: 'sword_blade', pose: { x: 0, y: 10, z: 1 },
        boxes: [{ x: -0.5, y: 0, z: -0.25, w: 1, h: 9, d: 0.5, u: 40, v: 16 }], tint: SWORD_BLADE,
      },
      {
        name: 'sword_guard', pose: { x: 0, y: 10, z: 1 },
        boxes: [{ x: -2, y: -0.5, z: -0.5, w: 4, h: 1, d: 1, u: 40, v: 16 }], tint: SWORD_GUARD,
      },
      {
        name: 'sword_handle', pose: { x: 0, y: 10, z: 1 },
        boxes: [{ x: -0.5, y: -3, z: -0.5, w: 1, h: 3, d: 1, u: 40, v: 16 }], tint: SWORD_HANDLE,
      },
    ],
  }],
}), (model, ctx) => {
  const arm = model.byName.get('right_arm');
  if (arm === undefined) return;
  const p = model.poses[arm];
  // SkeletonModel's non-bow arm pose: HumanoidModel swing + bobModelPart.
  p.rx = Math.cos(ctx.limbSwing * 0.6662 + Math.PI) * 2.0 * ctx.limbSwingAmount * 0.5;
  p.rz = Math.cos(ctx.ageInTicks * 0.09) * 0.05 + 0.05;
  p.rx += Math.sin(ctx.ageInTicks * 0.067) * 0.05;
  if (ctx.isAggressive) {
    const attack2 = Math.sin(ctx.attackTime * Math.PI);
    const attack = Math.sin((1 - (1 - ctx.attackTime) * (1 - ctx.attackTime)) * Math.PI);
    p.rz = 0;
    p.ry = -(0.1 - attack2 * 0.6);
    p.rx = -Math.PI / 2 - attack2 * 1.2 + attack * 0.4;
  }
});

const WHITE: readonly [number, number, number] = [1, 1, 1];

export class SkeletonRenderer extends MobRenderer {
  private readonly bowLayers: EntityLayer[] = [];
  private readonly swordLayers: EntityLayer[] = [];
  private readonly combined: EntityLayer[] = [];

  constructor(typeName: string) {
    super(typeName);
  }

  override getLayers(e: Entity): readonly EntityLayer[] {
    // Armor layers come from MobRenderer; append the weapon layer on top.
    const base = super.getLayers(e);
    const main = (e as LivingEntity).getMainHandItem?.();
    if (!main) return base;
    let weapon: EntityLayer;
    if (main.id.endsWith('bow')) {
      this.bowLayers[0] = { model: SkeletonBowModel, texture: this.getTextureKey(), tint: WHITE };
      weapon = this.bowLayers[0];
    } else if (main.id.endsWith('_sword')) {
      // A solid-colour blade must not sample the (nearly black) wither skeleton skin.
      this.swordLayers[0] = { model: SkeletonSwordModel, texture: WHITE_TEXTURE, tint: WHITE };
      weapon = this.swordLayers[0];
    } else {
      return base;
    }
    this.combined.length = 0;
    for (let i = 0; i < base.length; i++) this.combined.push(base[i]);
    this.combined.push(weapon);
    return this.combined;
  }
}
