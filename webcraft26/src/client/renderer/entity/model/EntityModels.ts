// Source (per model): net.minecraft.client.model.** / net.minecraft.client.model.geom.**
//
// Data-driven transcription of the hard-coded `addBox` / `PartPose` calls from
// the vanilla Java model classes, plus the matching `setupAnim` animation
// (walk swing, head look, attack / special poses).
//
// Box args: (x,y,z,w,h,d, u,v, mirror?, grow?) in model units / texels.
// Poses:    P(name, x,y,z, boxes, {rx,ry,rz}, children?) in model units / radians.
//
// Animation overrides are ADDITIVE on top of the baked rest pose, exactly like
// ModelPart.offsetRotation / offsetPos in net.minecraft.client.animation.

import {
  bakeModel, singleBoxModel, withAnimator,
  type AnimContext, type BakedModel, type BoxDef, type PartDef, type ModelDef, type PartPoseAnim,
} from './ModelBox.js';

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;
const EIGHTH_PI = Math.PI / 8;

function B(x: number, y: number, z: number, w: number, h: number, d: number, u: number, v: number, mirror = false, grow = 0): BoxDef {
  return { x, y, z, w, h, d, u, v, mirror, grow };
}
interface PoseOpts { rx?: number; ry?: number; rz?: number }
function P(name: string, x: number, y: number, z: number, boxes: BoxDef[], o: PoseOpts = {}, children?: PartDef[]): PartDef {
  return { name, pose: { x, y, z, ...o }, boxes, children };
}
function makeModel(texW: number, texH: number, children: PartDef[]): ModelDef {
  return { texW, texH, children };
}

/** Index of a named part, throwing once if the model was transcribed incorrectly. */
function partIndex(model: BakedModel, name: string): number {
  const i = model.byName.get(name);
  if (i === undefined) throw new Error(`model is missing part "${name}"`);
  return i;
}

function pose(model: BakedModel, name: string): PartPoseAnim {
  return model.poses[partIndex(model, name)];
}

/** AnimationUtils.bobModelPart */
function bobModelPart(p: PartPoseAnim, ageInTicks: number, scale: number): void {
  p.rz += scale * (Math.cos(ageInTicks * 0.09) * 0.05 + 0.05);
  p.rx += scale * (Math.sin(ageInTicks * 0.067) * 0.05);
}

/** Vanilla Mth.cos == Math.cos; Mth.lerp(a,b,t) == b + (a-b)*t */
function lerp(a: number, b: number, t: number): number { return b + (a - b) * t; }

// ---------------------------------------------------------------------------
// Quadruped family (net.minecraft.client.model.QuadrupedModel)
// ---------------------------------------------------------------------------

function quadrupedDef(
  legSize: number,
  headBoxes: BoxDef[], headY: number, headZ: number,
  bodyBoxes: BoxDef[], bodyY: number, bodyZ: number,
  legBox: BoxDef, legHalfX: number, legBackZ: number, legFrontZ: number,
  texW: number, texH: number,
  mirrorLeftLeg: boolean, mirrorRightLeg: boolean,
): ModelDef {
  const legY = 24 - legSize;
  const rightLeg: BoxDef = { ...legBox, mirror: mirrorRightLeg };
  const leftLeg: BoxDef = { ...legBox, mirror: mirrorLeftLeg };
  return makeModel(texW, texH, [
    P('head', 0, headY, headZ, headBoxes),
    P('body', 0, bodyY, bodyZ, bodyBoxes, { rx: HALF_PI }),
    P('right_hind_leg', -legHalfX, legY, legBackZ, [rightLeg]),
    P('left_hind_leg', legHalfX, legY, legBackZ, [leftLeg]),
    P('right_front_leg', -legHalfX, legY, legFrontZ, [rightLeg]),
    P('left_front_leg', legHalfX, legY, legFrontZ, [leftLeg]),
  ]);
}

/**
 * Source: net.minecraft.client.model.QuadrupedModel.setupAnim 鈥?head look plus
 * the 1.4 * cos(limbSwing * 0.6662) leg swing.
 */
function quadrupedAnim(model: BakedModel, ctx: AnimContext): void {
  const head = pose(model, 'head');
  head.rx = ctx.headPitch;
  head.ry = ctx.headYaw;
  const ap = ctx.limbSwing, as = ctx.limbSwingAmount;
  pose(model, 'right_hind_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
  pose(model, 'left_hind_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  pose(model, 'right_front_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  pose(model, 'left_front_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
}

/** Source: net.minecraft.client.model.QuadrupedModel (generic 6-unit legs). */
export const QuadrupedModel: BakedModel = withAnimator(bakeModel(
  quadrupedDef(6,
    [B(-4, -4, -8, 8, 8, 8, 0, 0)], 18 - 6, -6,
    [B(-5, -10, -7, 10, 16, 8, 28, 8)], 17 - 6, 2,
    B(-2, 0, -2, 4, 6, 4, 0, 16), 3, 7, -5, 64, 32, true, false),
), quadrupedAnim);

/** Source: net.minecraft.client.model.animal.pig.PigModel (quadruped + snout). */
export const PigModel: BakedModel = withAnimator(bakeModel(
  quadrupedDef(6,
    [B(-4, -4, -8, 8, 8, 8, 0, 0), B(-2, 0, -9, 4, 3, 1, 16, 16)], 12, -6,
    [B(-5, -10, -7, 10, 16, 8, 28, 8)], 11, 2,
    B(-2, 0, -2, 4, 6, 4, 0, 16), 3, 7, -5, 64, 64, true, false),
), quadrupedAnim);

/** Source: net.minecraft.client.model.animal.sheep.SheepModel (12-unit legs). */
export const SheepModel: BakedModel = withAnimator(bakeModel(
  quadrupedDef(12,
    [B(-3, -4, -6, 6, 6, 8, 0, 0)], 6, -8,
    [B(-4, -10, -7, 8, 16, 6, 28, 8)], 5, 2,
    B(-2, 0, -2, 4, 12, 4, 0, 16), 3, 7, -5, 64, 32, false, true),
), quadrupedAnim);

/** Source: net.minecraft.client.model.animal.cow.CowModel.createBaseCowModel. */
export const CowModel: BakedModel = withAnimator(bakeModel(makeModel(64, 64, [
  P('head', 0, 4, -8, [
    B(-4, -4, -6, 8, 8, 6, 0, 0),
    B(-3, 1, -7, 6, 3, 1, 1, 33),
    B(-5, -5, -5, 1, 3, 1, 22, 0),   // right horn
    B(4, -5, -5, 1, 3, 1, 22, 0),    // left horn
  ]),
  P('body', 0, 5, 2, [B(-6, -10, -7, 12, 18, 10, 18, 4), B(-2, 2, -8, 4, 6, 1, 52, 0)], { rx: HALF_PI }),
  P('right_hind_leg', -4, 12, 7, [B(-2, 0, -2, 4, 12, 4, 0, 16)]),
  P('left_hind_leg', 4, 12, 7, [B(-2, 0, -2, 4, 12, 4, 0, 16, true)]),
  P('right_front_leg', -4, 12, -5, [B(-2, 0, -2, 4, 12, 4, 0, 16)]),
  P('left_front_leg', 4, 12, -5, [B(-2, 0, -2, 4, 12, 4, 0, 16, true)]),
])), quadrupedAnim);

/** Source: net.minecraft.client.model.animal.chicken.AdultChickenModel. */
export const ChickenModel: BakedModel = withAnimator(bakeModel(makeModel(64, 32, [
  P('head', 0, 15, -4, [B(-2, -6, -2, 4, 6, 3, 0, 0)], {}, [
    P('beak', 0, 0, 0, [B(-2, -4, -4, 4, 2, 2, 14, 0)]),
    P('red_thing', 0, 0, 0, [B(-1, -2, -3, 2, 2, 2, 14, 4)]),
  ]),
  P('body', 0, 16, 0, [B(-3, -4, -3, 6, 8, 6, 0, 9)], { rx: HALF_PI }),
  P('right_leg', -2, 19, 1, [B(-1, 0, -3, 3, 5, 3, 26, 0)]),
  P('left_leg', 1, 19, 1, [B(-1, 0, -3, 3, 5, 3, 26, 0)]),
  P('right_wing', -4, 13, 0, [B(0, 0, -3, 1, 4, 6, 24, 13)]),
  P('left_wing', 4, 13, 0, [B(-1, 0, -3, 1, 4, 6, 24, 13)]),
])), (model, ctx) => {
  // Source: ChickenModel.setupAnim (leg swing) + AdultChickenModel.setupAnim (head)
  pose(model, 'head').rx = ctx.headPitch;
  pose(model, 'head').ry = ctx.headYaw;
  const ap = ctx.limbSwing, as = ctx.limbSwingAmount;
  pose(model, 'right_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
  pose(model, 'left_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  // ChickenModel: rightWing.zRot = flapAngle, leftWing.zRot = -flapAngle
  pose(model, 'right_wing').rz = ctx.flapAngle;
  pose(model, 'left_wing').rz = -ctx.flapAngle;
});

// ---------------------------------------------------------------------------
// Humanoid family (net.minecraft.client.model.HumanoidModel)
// ---------------------------------------------------------------------------

function humanoid(
  texW: number, texH: number,
  headBox: BoxDef, bodyBox: BoxDef,
  armBox: BoxDef, legBox: BoxDef,
  headY: number, bodyY: number, armY: number, legY: number,
  armX: number, legX: number,
): ModelDef {
  return makeModel(texW, texH, [
    P('head', 0, headY, 0, [headBox]),
    P('body', 0, bodyY, 0, [bodyBox]),
    P('right_arm', -armX, armY, 0, [armBox]),
    P('left_arm', armX, armY, 0, [{ ...armBox, mirror: true }]),
    P('right_leg', -legX, legY, 0, [legBox]),
    P('left_leg', legX, legY, 0, [{ ...legBox, mirror: true }]),
  ]);
}

/**
 * Source: HumanoidModel.setupAnim (walking arm/leg swing, head look, arm bob).
 * state.speedValue is 1 for grounded mobs (HumanoidMobRenderer.extractHumanoidRenderState).
 */
function humanoidAnim(model: BakedModel, ctx: AnimContext): void {
  const head = pose(model, 'head');
  head.rx = ctx.headPitch;
  head.ry = ctx.headYaw;

  const ap = ctx.limbSwing, as = ctx.limbSwingAmount;
  const rightArm = pose(model, 'right_arm');
  const leftArm = pose(model, 'left_arm');
  const rightLeg = pose(model, 'right_leg');
  const leftLeg = pose(model, 'left_leg');
  rightArm.rx = Math.cos(ap * 0.6662 + Math.PI) * 2.0 * as * 0.5;
  leftArm.rx = Math.cos(ap * 0.6662) * 2.0 * as * 0.5;
  rightLeg.rx = Math.cos(ap * 0.6662) * 1.4 * as;
  leftLeg.rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  rightLeg.ry = 0.005; leftLeg.ry = -0.005;
  rightLeg.rz = 0.005; leftLeg.rz = -0.005;

  bobModelPart(rightArm, ctx.ageInTicks, 1.0);
  bobModelPart(leftArm, ctx.ageInTicks, -1.0);
}

/** Source: net.minecraft.client.model.monster.zombie.ZombieModel / GaintZombie family. */
export const ZombieModel: BakedModel = withAnimator(bakeModel(humanoid(
  64, 64,
  B(-4, -8, -4, 8, 8, 8, 0, 0),
  B(-4, 0, -2, 8, 12, 4, 16, 16),
  B(-3, -2, -2, 4, 12, 4, 40, 16),
  B(-2, 0, -2, 4, 12, 4, 0, 16),
  0, 0, 2, 12, 5, 1.9,
)), (model, ctx) => {
  humanoidAnim(model, ctx);
  // Source: AnimationUtils.animateZombieArms 鈥?arms held straight out.
  const drop = -Math.PI / (ctx.isAggressive ? 1.5 : 2.25);
  const attack2 = Math.sin(ctx.attackTime * Math.PI);
  const attack = Math.sin((1 - (1 - ctx.attackTime) * (1 - ctx.attackTime)) * Math.PI);
  const xRot = drop + attack2 * 1.2 - attack * 0.4;
  const yRot = 0.1 - attack2 * 0.6;
  const rightArm = pose(model, 'right_arm');
  const leftArm = pose(model, 'left_arm');
  rightArm.rx = xRot; rightArm.ry = -yRot; rightArm.rz = 0;
  leftArm.rx = xRot; leftArm.ry = yRot; leftArm.rz = 0;
  bobModelPart(rightArm, ctx.ageInTicks, 1.0);
  bobModelPart(leftArm, ctx.ageInTicks, -1.0);
});

/** Source: net.minecraft.client.model.monster.skeleton.SkeletonModel.setupAnim + BOW_AND_ARROW arm pose. */
export const SkeletonModel: BakedModel = withAnimator(bakeModel(makeModel(64, 32, [
  P('head', 0, 0, 0, [B(-4, -8, -4, 8, 8, 8, 0, 0)]),
  P('body', 0, 0, 0, [B(-4, 0, -2, 8, 12, 4, 16, 16)]),
  P('right_arm', -5, 2, 0, [B(-1, -2, -1, 2, 12, 2, 40, 16)]),
  P('left_arm', 5, 2, 0, [B(-1, -2, -1, 2, 12, 2, 40, 16, true)]),
  P('right_leg', -2, 12, 0, [B(-1, 0, -1, 2, 12, 2, 0, 16)]),
  P('left_leg', 2, 12, 0, [B(-1, 0, -1, 2, 12, 2, 0, 16, true)]),
])), (model, ctx) => {
  humanoidAnim(model, ctx);
  const rightArm = pose(model, 'right_arm');
  const leftArm = pose(model, 'left_arm');
  if (ctx.isHoldingBow) {
    // HumanoidModel.ArmPose.BOW_AND_ARROW (SkeletonRenderer always reports a bow)
    rightArm.ry = -0.1 + ctx.headYaw;
    leftArm.ry = 0.1 + ctx.headYaw + 0.4;
    rightArm.rx = -HALF_PI + ctx.headPitch;
    leftArm.rx = -HALF_PI + ctx.headPitch;
  } else if (ctx.isAggressive) {
    // Source: SkeletonModel.setupAnim aggressive melee swing
    const attack2 = Math.sin(ctx.attackTime * Math.PI);
    const attack = Math.sin((1 - (1 - ctx.attackTime) * (1 - ctx.attackTime)) * Math.PI);
    rightArm.rz = 0; leftArm.rz = 0;
    rightArm.ry = -(0.1 - attack2 * 0.6);
    leftArm.ry = 0.1 - attack2 * 0.6;
    rightArm.rx = -HALF_PI;
    leftArm.rx = -HALF_PI;
    rightArm.rx -= attack2 * 1.2 - attack * 0.4;
    leftArm.rx -= attack2 * 1.2 - attack * 0.4;
    bobModelPart(rightArm, ctx.ageInTicks, 1.0);
    bobModelPart(leftArm, ctx.ageInTicks, -1.0);
  }
});

/** Source: net.minecraft.client.model.monster.enderman.EndermanModel.setupAnim. */
export const EndermanModel: BakedModel = withAnimator(bakeModel(humanoid(
  64, 32,
  B(-4, -8, -4, 8, 8, 8, 0, 0),
  B(-4, 0, -2, 8, 12, 4, 32, 16),
  B(-1, -2, -1, 2, 30, 2, 56, 0),
  B(-1, 0, -1, 2, 30, 2, 56, 0),
  -13, -14, -12, -5, 5, 2,
)), (model, ctx) => {
  humanoidAnim(model, ctx);
  // EndermanModel: halve every limb rotation and clamp to +-0.4 rad.
  for (const name of ['right_arm', 'left_arm', 'right_leg', 'left_leg']) {
    const p = pose(model, name);
    p.rx = Math.min(0.4, Math.max(-0.4, p.rx * 0.5));
  }
});

// ---------------------------------------------------------------------------
// Monster models
// ---------------------------------------------------------------------------

/** Source: net.minecraft.client.model.monster.creeper.CreeperModel. */
export const CreeperModel: BakedModel = withAnimator(bakeModel(makeModel(64, 32, [
  P('head', 0, 6, 0, [B(-4, -8, -4, 8, 8, 8, 0, 0)]),
  P('body', 0, 6, 0, [B(-4, 0, -2, 8, 12, 4, 16, 16)]),
  P('right_hind_leg', -2, 18, 4, [B(-2, 0, -2, 4, 6, 4, 0, 16)]),
  P('left_hind_leg', 2, 18, 4, [B(-2, 0, -2, 4, 6, 4, 0, 16)]),
  P('right_front_leg', -2, 18, -4, [B(-2, 0, -2, 4, 6, 4, 0, 16)]),
  P('left_front_leg', 2, 18, -4, [B(-2, 0, -2, 4, 6, 4, 0, 16)]),
])), (model, ctx) => {
  // Source: CreeperModel.setupAnim. Note the Java class swaps the two hind/left
  // ModelPart fields, so the diagonal pairs below are the ones vanilla animates.
  pose(model, 'head').ry = ctx.headYaw;
  pose(model, 'head').rx = ctx.headPitch;
  const ap = ctx.limbSwing, as = ctx.limbSwingAmount;
  pose(model, 'left_hind_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
  pose(model, 'right_hind_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  pose(model, 'left_front_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  pose(model, 'right_front_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
});

/** Source: net.minecraft.client.model.monster.spider.SpiderModel (8 legs). */
export const SpiderModel: BakedModel = withAnimator(bakeModel(makeModel(64, 32, [
  P('head', 0, 15, -3, [B(-4, -4, -8, 8, 8, 8, 32, 4)]),
  P('body0', 0, 15, 0, [B(-3, -3, -3, 6, 6, 6, 0, 0)]),
  P('body1', 0, 15, 9, [B(-5, -4, -6, 10, 8, 12, 0, 12)]),
  P('right_hind_leg', -4, 15, 2, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: QUARTER_PI, rz: -QUARTER_PI }),
  P('left_hind_leg', 4, 15, 2, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: -QUARTER_PI, rz: QUARTER_PI }),
  P('right_middle_hind_leg', -4, 15, 1, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: EIGHTH_PI, rz: -0.58119464 }),
  P('left_middle_hind_leg', 4, 15, 1, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: -EIGHTH_PI, rz: 0.58119464 }),
  P('right_middle_front_leg', -4, 15, 0, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: -EIGHTH_PI, rz: -0.58119464 }),
  P('left_middle_front_leg', 4, 15, 0, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: EIGHTH_PI, rz: 0.58119464 }),
  P('right_front_leg', -4, 15, -1, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: -QUARTER_PI, rz: -QUARTER_PI }),
  P('left_front_leg', 4, 15, -1, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: QUARTER_PI, rz: QUARTER_PI }),
])), (model, ctx) => {
  // Source: SpiderModel.setupAnim
  pose(model, 'head').ry = ctx.headYaw;
  pose(model, 'head').rx = ctx.headPitch;
  const ap = ctx.limbSwing * 0.6662;
  const as = ctx.limbSwingAmount;
  const swingHind = -(Math.cos(ap * 2.0) * 0.4) * as;
  const swingMiddleHind = -(Math.cos(ap * 2.0 + Math.PI) * 0.4) * as;
  const swingMiddleFront = -(Math.cos(ap * 2.0 + HALF_PI) * 0.4) * as;
  const swingFront = -(Math.cos(ap * 2.0 + Math.PI * 3 / 2) * 0.4) * as;
  const stepHind = Math.abs(Math.sin(ap) * 0.4) * as;
  const stepMiddleHind = Math.abs(Math.sin(ap + Math.PI) * 0.4) * as;
  const stepMiddleFront = Math.abs(Math.sin(ap + HALF_PI) * 0.4) * as;
  const stepFront = Math.abs(Math.sin(ap + Math.PI * 3 / 2) * 0.4) * as;
  const pairs: [string, string, number, number][] = [
    ['right_hind_leg', 'left_hind_leg', swingHind, stepHind],
    ['right_middle_hind_leg', 'left_middle_hind_leg', swingMiddleHind, stepMiddleHind],
    ['right_middle_front_leg', 'left_middle_front_leg', swingMiddleFront, stepMiddleFront],
    ['right_front_leg', 'left_front_leg', swingFront, stepFront],
  ];
  for (const [right, left, swing, step] of pairs) {
    const r = pose(model, right), l = pose(model, left);
    r.ry += swing; l.ry -= swing;
    r.rz += step; l.rz -= step;
  }
});

/** Source: net.minecraft.client.model.monster.silverfish.SilverfishModel (7 segments). */
export const SilverfishModel: BakedModel = (() => {
  const SIZES = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
  const TEXS = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
  const children: PartDef[] = [];
  let placement = -3.5;
  const zPlacement: number[] = [];
  for (let i = 0; i < 7; i++) {
    const [w, h, d] = SIZES[i];
    children.push(P(`segment${i}`, 0, 24 - h, placement, [B(-w / 2, 0, -d / 2, w, h, d, TEXS[i][0], TEXS[i][1])]));
    zPlacement[i] = placement;
    if (i < 6) placement += (SIZES[i][2] + SIZES[i + 1][2]) * 0.5;
  }
  children.push(P('layer0', 0, 16, zPlacement[2], [B(-5, 0, -SIZES[2][2] / 2, 10, 8, SIZES[2][2], 20, 0)]));
  children.push(P('layer1', 0, 20, zPlacement[4], [B(-3, 0, -SIZES[4][2] / 2, 6, 4, SIZES[4][2], 20, 11)]));
  children.push(P('layer2', 0, 19, zPlacement[1], [B(-3, 0, -SIZES[4][2] / 2, 6, 5, SIZES[1][2], 20, 18)]));
  return withAnimator(bakeModel(makeModel(64, 32, children)), (model, ctx) => {
    // Source: SilverfishModel.setupAnim
    const age = ctx.ageInTicks;
    for (let i = 0; i < 7; i++) {
      const p = pose(model, `segment${i}`);
      p.ry = Math.cos(age * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.05 * (1 + Math.abs(i - 2));
      p.x = Math.sin(age * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.2 * Math.abs(i - 2);
    }
    const layer0 = pose(model, 'layer0'), layer1 = pose(model, 'layer1'), layer2 = pose(model, 'layer2');
    const s1 = pose(model, 'segment1'), s2 = pose(model, 'segment2'), s4 = pose(model, 'segment4');
    layer0.ry = s2.ry;
    layer1.ry = s4.ry; layer1.x = s4.x;
    layer2.ry = s1.ry; layer2.x = s1.x;
  });
})();

// ---------------------------------------------------------------------------
// Wolf / Rabbit / Bat 鈥?transcribed box-by-box from createBodyLayer()
// ---------------------------------------------------------------------------

/** Source: net.minecraft.client.model.animal.wolf.AdultWolfModel.createBodyLayer. */
export const WolfModel: BakedModel = withAnimator(bakeModel(makeModel(64, 32, [
  P('head', -1, 13.5, -7, [], {}, [
    P('real_head', 0, 0, 0, [
      B(-2, -3, -2, 6, 6, 4, 0, 0),
      B(-2, -5, 0, 2, 2, 1, 16, 14),
      B(2, -5, 0, 2, 2, 1, 16, 14),
      B(-0.5, -0.001, -5, 3, 3, 4, 0, 10),
    ]),
  ]),
  P('body', 0, 14, 2, [B(-3, -2, -3, 6, 9, 6, 18, 14)], { rx: HALF_PI }),
  P('upper_body', -1, 14, -3, [B(-3, -3, -3, 8, 6, 7, 21, 0)], { rx: HALF_PI }),
  P('right_hind_leg', -2.5, 16, 7, [B(0, 0, -1, 2, 8, 2, 0, 18, true)]),
  P('left_hind_leg', 0.5, 16, 7, [B(0, 0, -1, 2, 8, 2, 0, 18)]),
  P('right_front_leg', -2.5, 16, -4, [B(0, 0, -1, 2, 8, 2, 0, 18, true)]),
  P('left_front_leg', 0.5, 16, -4, [B(0, 0, -1, 2, 8, 2, 0, 18)]),
  P('tail', -1, 12, 8, [], { rx: Math.PI / 5 }, [
    P('real_tail', 0, 0, 0, [B(0, 0, -1, 2, 8, 2, 9, 18)]),
  ]),
])), (model, ctx) => {
  // Source: WolfModel.setupAnim (walking legs, tail sway, head look)
  const ap = ctx.limbSwing, as = ctx.limbSwingAmount;
  pose(model, 'tail').ry = Math.cos(ap * 0.6662) * 1.4 * as;
  pose(model, 'right_hind_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
  pose(model, 'left_hind_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  pose(model, 'right_front_leg').rx = Math.cos(ap * 0.6662 + Math.PI) * 1.4 * as;
  pose(model, 'left_front_leg').rx = Math.cos(ap * 0.6662) * 1.4 * as;
  pose(model, 'head').rx = ctx.headPitch;
  pose(model, 'head').ry = ctx.headYaw;
});

/** Source: net.minecraft.client.model.animal.rabbit.AdultRabbitModel.createBodyLayer. */
export const RabbitModel: BakedModel = withAnimator(bakeModel(makeModel(64, 64, [
  P('body', 0, 23, 4, [B(-4, -6, -9, 8, 6, 10, 0, 0)], { rx: -0.3927 }, [
    P('tail', 0, -4.9916, 0.0125, [B(-2, -3.0084, -1.0125, 4, 4, 4, 20, 16)]),
    P('head', 0, -5.2929, -8.1213, [B(-2.5, -3, -4, 5, 5, 5, 0, 16)], { rx: 0.3927 }, [
      P('left_ear', 1.5, -3.7071, -0.8787, [B(-1, -4.2929, -0.1213, 2, 5, 1, 32, 0)]),
      P('right_ear', -1.5, -3.7071, -0.8787, [B(-1, -4.2929, -0.1213, 2, 5, 1, 26, 0)]),
    ]),
    P('frontlegs', 0, -1.5349, -6.3108, [], {}, [
      P('right_front_leg', -2, 1.9239, 0.3827, [B(-0.9, -1, -0.9, 2, 4, 2, 36, 18)], { rx: 0.3927 }),
      P('left_front_leg', 2, 1.9239, 0.4827, [B(-1, -1, -1, 2, 4, 2, 44, 18)], { rx: 0.3927 }),
    ]),
  ]),
  P('backlegs', 0, 23, 4, [], {}, [
    P('right_hind_leg', -3, 0.5, 0, [], {}, [
      P('right_haunch', 0, -0.5, 0, [B(-1, 0, -5, 2, 1, 6, 20, 24)], { ry: 0.3927 }),
    ]),
    P('left_hind_leg', 3, 0.5, 0, [], {}, [
      P('left_haunch', 0, -0.5, 0, [B(-1, 0, -5, 2, 1, 6, 36, 24)], { ry: -0.3927 }),
    ]),
  ]),
])), (model, ctx) => {
  // Source: net.minecraft.client.animation.definitions.RabbitAnimation.HOP
  // (looping, 0.75 s). Rotations below are the vanilla degree keyframes
  // converted to radians and applied additively; position channels omitted.
  const phase = (ctx.ageInTicks / 20) % 0.75;
  const body = pose(model, 'body');
  body.rx += keyframe(phase, RABBIT_HOP.body) * DEG;
  pose(model, 'head').rx += keyframe(phase, RABBIT_HOP.head) * DEG;
  pose(model, 'head').ry = ctx.headYaw;
  pose(model, 'backlegs').rx += keyframe(phase, RABBIT_HOP.backlegs) * DEG;
  pose(model, 'frontlegs').rx += keyframe(phase, RABBIT_HOP.frontlegs) * DEG;
  const leftEar = pose(model, 'left_ear'), rightEar = pose(model, 'right_ear');
  leftEar.rx += keyframe(phase, RABBIT_HOP.leftEar) * DEG;
  rightEar.rx += keyframe(phase, RABBIT_HOP.rightEar) * DEG;
});

const RABBIT_HOP = {
  body: [[0, 0], [0.125, 0], [0.2083, 4], [0.2917, 32.5], [0.4167, 33], [0.5833, 18], [0.75, 0]] as const,
  head: [[0, 0], [0.125, 0], [0.2083, -4], [0.2917, -32.17], [0.375, -34.58], [0.5833, -20], [0.75, 0]] as const,
  backlegs: [[0, 0], [0.125, 0], [0.25, 125], [0.2917, 125], [0.375, 120], [0.4583, 95], [0.5417, 42], [0.6667, 0], [0.75, 0]] as const,
  frontlegs: [[0, -0.17], [0.125, -0.17], [0.2083, 25.25], [0.2917, -65], [0.4583, -67.5], [0.625, -1.25], [0.749, -1.25], [0.75, 0]] as const,
  leftEar: [[0, 0], [0.125, 2.5], [0.375, -48.5], [0.5417, -41.24], [0.75, 0]] as const,
  rightEar: [[0, 0], [0.125, 7.5], [0.375, -31.5], [0.5, -35.33], [0.75, 0]] as const,
};

/** Source: net.minecraft.client.model.ambient.BatModel.createBodyLayer. */
export const BatModel: BakedModel = withAnimator(bakeModel(makeModel(32, 32, [
  P('body', 0, 17, 0, [B(-1.5, 0, -1, 3, 5, 2, 0, 0)], {}, [
    P('right_wing', -1.5, 0, 0, [B(-2, -2, 0, 2, 7, 0, 12, 0)], {}, [
      P('right_wing_tip', -2, 0, 0, [B(-6, -2, 0, 6, 8, 0, 16, 0)]),
    ]),
    P('left_wing', 1.5, 0, 0, [B(0, -2, 0, 2, 7, 0, 12, 7)], {}, [
      P('left_wing_tip', 2, 0, 0, [B(0, -2, 0, 6, 8, 0, 16, 8)]),
    ]),
    P('feet', 0, 5, 0, [B(-1.5, 0, 0, 3, 2, 0, 16, 16)]),
  ]),
  P('head', 0, 17, 0, [B(-2, -3, -1, 4, 3, 2, 0, 7)], {}, [
    P('right_ear', -1.5, -2, 0, [B(-2.5, -4, 0, 3, 5, 0, 1, 15)]),
    P('left_ear', 1.1, -3, 0, [B(-0.1, -3, 0, 3, 5, 0, 8, 15)]),
  ]),
])), (model, ctx) => {
  // Source: BatAnimation.BAT_RESTING (static hanging pose) / BAT_FLYING (looping,
  // 0.5 s). Rotation channels are transcribed; position channels are omitted
  // except the resting 0.5-unit body/head drop.
  if (ctx.isResting) {
    const body = pose(model, 'body');
    body.rx += Math.PI;
    body.y -= 0.5; // KeyframeAnimations.posVec(0, 0.5, 0) => y -= 0.5
    const head = pose(model, 'head');
    head.rx += Math.PI;
    head.y -= 0.5;
    pose(model, 'right_wing').ry += -10 * DEG;
    pose(model, 'left_wing').ry += 10 * DEG;
    pose(model, 'right_wing_tip').ry += -120 * DEG;
    pose(model, 'left_wing_tip').ry += 120 * DEG;
    return;
  }
  const phase = (ctx.ageInTicks / 20) % 0.5;
  pose(model, 'body').rx += keyframe(phase, BAT_FLY.body) * DEG;
  pose(model, 'head').rx += keyframe(phase, BAT_FLY.head) * DEG;
  const wing = keyframe(phase, BAT_FLY.wing) * DEG;
  const wingTip = keyframe(phase, BAT_FLY.wingTip) * DEG;
  pose(model, 'right_wing').ry += wing;
  pose(model, 'left_wing').ry -= wing;
  pose(model, 'right_wing_tip').ry += wingTip;
  pose(model, 'left_wing_tip').ry -= wingTip;
  pose(model, 'feet').rx += keyframe(phase, BAT_FLY.feet) * DEG;
});

const BAT_FLY = {
  body: [[0, 40], [0.25, 52.5], [0.5, 40]] as const,
  head: [[0, 0], [0.125, 20], [0.5, 0]] as const,
  wing: [[0, 85], [0.125, -55], [0.25, 50], [0.375, 70], [0.5, 85]] as const,
  wingTip: [[0, 10.5], [0.0417, 65.5], [0.2083, -135], [0.5, 10.5]] as const,
  feet: [[0, 10], [0.125, -21.25], [0.25, -12.5], [0.5, 10]] as const,
};

/** Linear keyframe sampler matching AnimationChannel.Interpolations.LINEAR. */
function keyframe(phase: number, frames: readonly (readonly [number, number])[]): number {
  if (phase <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    if (phase >= a[0] && phase < b[0]) {
      const f = (phase - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return frames[frames.length - 1][1];
}

// ---------------------------------------------------------------------------
// Generic fallback models (items / projectiles), solid white texture
// ---------------------------------------------------------------------------

// NOTE: y coordinates are in model units; the root transform maps y=24 to
// entity-local y=0 (feet), so these boxes sit just above the ground.
/** Small cube used for dropped items (ItemEntityRenderer). */
export const ItemCubeModel: BakedModel = singleBoxModel(-2, 20, -2, 4, 4, 4, 0, 0, 16, 16);

/** Thin elongated box used for arrows (ArrowRenderer). */
export const ArrowModel: BakedModel = singleBoxModel(-0.5, 20, -8, 1, 1, 16, 0, 0, 16, 16);
