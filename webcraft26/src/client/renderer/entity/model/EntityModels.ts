// Source (per model): net.minecraft.client.model.** / net.minecraft.client.model.geom.**
//
// Data-driven transcription of the hard-coded `addBox` / `PartPose` calls from
// the vanilla Java model classes. Each export is a BakedModel produced ONCE by
// ModelBox.bakeModel(). Models are grouped by their vanilla geometry family.
//
// Box args: (x,y,z,w,h,d, u,v, mirror?, grow?) in model units / texels.
// Poses: P(x,y,z, boxes, {rx,ry,rz,swing}, children?).

import { bakeModel, singleBoxModel, type BakedModel, type BoxDef, type PartDef, type ModelDef } from './ModelBox.js';

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;
const EIGHTH_PI = Math.PI / 8;

function B(x: number, y: number, z: number, w: number, h: number, d: number, u: number, v: number, mirror = false, grow = 0): BoxDef {
  return { x, y, z, w, h, d, u, v, mirror, grow };
}
interface PoseOpts { rx?: number; ry?: number; rz?: number; swing?: number; }
function P(x: number, y: number, z: number, boxes: BoxDef[], o: PoseOpts = {}, children?: PartDef[]): PartDef {
  return { pose: { x, y, z, ...o }, boxes, children };
}
function makeModel(texW: number, texH: number, parts: PartDef[]): ModelDef {
  return { texW, texH, root: { children: parts } };
}

// ---------------------------------------------------------------------------
// Quadruped family (net.minecraft.client.model.QuadrupedModel)
// ---------------------------------------------------------------------------

function quadruped(legSize: number, headBoxes: BoxDef[], headY: number, headZ: number,
  bodyBoxes: BoxDef[], bodyY: number, bodyZ: number, legBox: BoxDef, legHalfX: number,
  legBackZ: number, legFrontZ: number, texW: number, texH: number): ModelDef {
  const legY = 24 - legSize;
  return makeModel(texW, texH, [
    P(0, headY, headZ, headBoxes),
    P(0, bodyY, bodyZ, bodyBoxes, { rx: HALF_PI }),
    P(-legHalfX, legY, legBackZ, [legBox], { swing: 1 }),
    P(legHalfX, legY, legBackZ, [{ ...legBox, mirror: true }], { swing: 1 }),
    P(-legHalfX, legY, legFrontZ, [legBox], { swing: -1 }),
    P(legHalfX, legY, legFrontZ, [{ ...legBox, mirror: true }], { swing: -1 }),
  ]);
}

/** Source: net.minecraft.client.model.QuadrupedModel (generic 6-unit legs). */
export const QuadrupedModel: BakedModel = bakeModel(
  quadruped(6,
    [B(-4, -4, -8, 8, 8, 8, 0, 0)], 18 - 6, -6,
    [B(-5, -10, -7, 10, 16, 8, 28, 8)], 17 - 6, 2,
    B(-2, 0, -2, 4, 6, 4, 0, 16), 3, 7, -5, 64, 32),
);

/** Source: net.minecraft.client.model.animal.pig.PigModel (quadruped + snout). */
export const PigModel: BakedModel = bakeModel(
  quadruped(6,
    [B(-4, -4, -8, 8, 8, 8, 0, 0), B(-2, 0, -9, 4, 3, 1, 16, 16)], 12, -6,
    [B(-5, -10, -7, 10, 16, 8, 28, 8)], 11, 2,
    B(-2, 0, -2, 4, 6, 4, 0, 16), 3, 7, -5, 64, 64),
);

/** Source: net.minecraft.client.model.animal.sheep.SheepModel. */
export const SheepModel: BakedModel = bakeModel(
  quadruped(12,
    [B(-3, -4, -6, 6, 6, 8, 0, 0)], 6, -8,
    [B(-4, -10, -7, 8, 16, 6, 28, 8)], 5, 2,
    B(-2, 0, -2, 4, 12, 4, 0, 16), 3, 7, -5, 64, 32),
);

/** Source: net.minecraft.client.model.animal.cow.CowModel. */
export const CowModel: BakedModel = bakeModel(makeModel(64, 64, [
  P(0, 4, -8, [
    B(-4, -4, -6, 8, 8, 6, 0, 0),
    B(-3, 1, -7, 6, 3, 1, 1, 33),
    B(-5, -5, -5, 1, 3, 1, 22, 0),
    B(4, -5, -5, 1, 3, 1, 22, 0),
  ]),
  P(0, 5, 2, [B(-6, -10, -7, 12, 18, 10, 18, 4), B(-2, 2, -8, 4, 6, 1, 52, 0)], { rx: HALF_PI }),
  P(-4, 12, 7, [B(-2, 0, -2, 4, 12, 4, 0, 16)], { swing: 1 }),
  P(4, 12, 7, [B(-2, 0, -2, 4, 12, 4, 0, 16, true)], { swing: 1 }),
  P(-4, 12, -5, [B(-2, 0, -2, 4, 12, 4, 0, 16)], { swing: -1 }),
  P(4, 12, -5, [B(-2, 0, -2, 4, 12, 4, 0, 16, true)], { swing: -1 }),
]));

/** Source: net.minecraft.client.model.animal.chicken.AdultChickenModel. */
export const ChickenModel: BakedModel = bakeModel(makeModel(64, 32, [
  P(0, 15, -4, [B(-2, -6, -2, 4, 6, 3, 0, 0)], {}, [
    P(0, 0, 0, [B(-2, -4, -4, 4, 2, 2, 14, 0)]),       // beak
    P(0, 0, 0, [B(-1, -2, -3, 2, 2, 2, 14, 4)]),       // red_thing
  ]),
  P(0, 16, 0, [B(-3, -4, -3, 6, 8, 6, 0, 9)], { rx: HALF_PI }),
  P(-2, 19, 1, [B(-1, 0, -3, 3, 5, 3, 26, 0)], { swing: 1 }),
  P(1, 19, 1, [B(-1, 0, -3, 3, 5, 3, 26, 0)], { swing: -1 }),
  P(-4, 13, 0, [B(0, 0, -3, 1, 4, 6, 24, 13)], { swing: 0.6 }),
  P(4, 13, 0, [B(-1, 0, -3, 1, 4, 6, 24, 13)], { swing: 0.6 }),
]));

// ---------------------------------------------------------------------------
// Humanoid family (net.minecraft.client.model.HumanoidModel)
// ---------------------------------------------------------------------------

function humanoid(
  texW: number, texH: number,
  headBox: BoxDef, bodyBox: BoxDef,
  armBox: BoxDef, legBox: BoxDef,
  armLen: number, legLen: number,
  headY: number, bodyY: number, armY: number, legY: number,
  armX: number, legX: number,
): ModelDef {
  return makeModel(texW, texH, [
    P(0, headY, 0, [headBox]),
    P(0, bodyY, 0, [bodyBox]),
    P(-armX, armY, 0, [{ ...armBox, h: armLen }], { swing: -1 }),
    P(armX, armY, 0, [{ ...armBox, h: armLen, mirror: true }], { swing: 1 }),
    P(-legX, legY, 0, [{ ...legBox, h: legLen }], { swing: 1 }),
    P(legX, legY, 0, [{ ...legBox, h: legLen, mirror: true }], { swing: -1 }),
  ]);
}

/** Source: net.minecraft.client.model.monster.zombie.ZombieModel / HumanoidModel. */
export const ZombieModel: BakedModel = bakeModel(humanoid(
  64, 64,
  B(-4, -8, -4, 8, 8, 8, 0, 0),
  B(-4, 0, -2, 8, 12, 4, 16, 16),
  B(-3, -2, -2, 4, 12, 4, 40, 16),
  B(-2, 0, -2, 4, 12, 4, 0, 16),
  12, 12, 0, 0, 2, 12, 5, 1.9,
));

/** Source: net.minecraft.client.model.monster.skeleton.SkeletonModel. */
export const SkeletonModel: BakedModel = bakeModel(humanoid(
  64, 32,
  B(-4, -8, -4, 8, 8, 8, 0, 0),
  B(-4, 0, -2, 8, 12, 4, 16, 16),
  B(-1, -2, -1, 2, 12, 2, 40, 16),
  B(-1, 0, -1, 2, 12, 2, 0, 16),
  12, 12, 0, 0, 2, 12, 5, 2,
));

/** Source: net.minecraft.client.model.monster.enderman.EndermanModel (long limbs). */
export const EndermanModel: BakedModel = bakeModel(humanoid(
  64, 32,
  B(-4, -8, -4, 8, 8, 8, 0, 0),
  B(-4, 0, -2, 8, 12, 4, 32, 16),
  B(-1, -2, -1, 2, 30, 2, 56, 0),
  B(-1, 0, -1, 2, 30, 2, 56, 0),
  30, 30, -13, -14, -12, -5, 5, 2,
));

/** Source: net.minecraft.client.model.monster.creeper.CreeperModel. */
export const CreeperModel: BakedModel = bakeModel(makeModel(64, 32, [
  P(0, 6, 0, [B(-4, -8, -4, 8, 8, 8, 0, 0)]),
  P(0, 6, 0, [B(-4, 0, -2, 8, 12, 4, 16, 16)]),
  P(-2, 18, 4, [B(-2, 0, -2, 4, 6, 4, 0, 16)], { swing: 1 }),
  P(2, 18, 4, [B(-2, 0, -2, 4, 6, 4, 0, 16)], { swing: 1 }),
  P(-2, 18, -4, [B(-2, 0, -2, 4, 6, 4, 0, 16)], { swing: -1 }),
  P(2, 18, -4, [B(-2, 0, -2, 4, 6, 4, 0, 16)], { swing: -1 }),
]));

/** Source: net.minecraft.client.model.monster.spider.SpiderModel (8 legs). */
export const SpiderModel: BakedModel = bakeModel(makeModel(64, 32, [
  P(0, 15, -3, [B(-4, -4, -8, 8, 8, 8, 32, 4)]),
  P(0, 15, 0, [B(-3, -3, -3, 6, 6, 6, 0, 0)]),
  P(0, 15, 9, [B(-5, -4, -6, 10, 8, 12, 0, 12)]),
  P(-4, 15, 2, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: QUARTER_PI, rz: -QUARTER_PI, swing: 0.5 }),
  P(4, 15, 2, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: -QUARTER_PI, rz: QUARTER_PI, swing: 0.5 }),
  P(-4, 15, 1, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: EIGHTH_PI, rz: -0.58119464, swing: 0.5 }),
  P(4, 15, 1, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: -EIGHTH_PI, rz: 0.58119464, swing: 0.5 }),
  P(-4, 15, 0, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: -EIGHTH_PI, rz: -0.58119464, swing: 0.5 }),
  P(4, 15, 0, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: EIGHTH_PI, rz: 0.58119464, swing: 0.5 }),
  P(-4, 15, -1, [B(-15, -1, -1, 16, 2, 2, 18, 0)], { ry: -QUARTER_PI, rz: -QUARTER_PI, swing: 0.5 }),
  P(4, 15, -1, [B(-1, -1, -1, 16, 2, 2, 18, 0, true)], { ry: QUARTER_PI, rz: QUARTER_PI, swing: 0.5 }),
]));

/** Source: net.minecraft.client.model.monster.silverfish.SilverfishModel (7 segments). */
export const SilverfishModel: BakedModel = (() => {
  const SIZES = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
  const TEXS = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
  const parts: PartDef[] = [];
  let placement = -3.5;
  const zPlacement: number[] = [];
  for (let i = 0; i < 7; i++) {
    const [w, h, d] = SIZES[i];
    parts.push(P(0, 24 - h, placement, [B(-w / 2, 0, -d / 2, w, h, d, TEXS[i][0], TEXS[i][1])]));
    zPlacement[i] = placement;
    if (i < 6) placement += (SIZES[i][2] + SIZES[i + 1][2]) * 0.5;
  }
  parts.push(P(0, 16, zPlacement[2], [B(-5, 0, -SIZES[2][2] / 2, 10, 8, SIZES[2][2], 20, 0)]));
  parts.push(P(0, 20, zPlacement[4], [B(-3, 0, -SIZES[4][2] / 2, 6, 4, SIZES[4][2], 20, 11)]));
  parts.push(P(0, 19, zPlacement[1], [B(-3, 0, -SIZES[4][2] / 2, 6, 5, SIZES[1][2], 20, 18)]));
  return bakeModel(makeModel(64, 32, parts));
})();

/** Source: net.minecraft.client.model.animal.wolf.AdultWolfModel (flattened ZERO-pose children). */
export const WolfModel: BakedModel = bakeModel(makeModel(64, 32, [
  P(-1, 13.5, -7, [
    B(-2, -3, -2, 6, 6, 4, 0, 0),
    B(-2, -5, 0, 2, 2, 1, 16, 14),
    B(2, -5, 0, 2, 2, 1, 16, 14),
    B(-0.5, -0.001, -5, 3, 3, 4, 0, 10),
  ]),
  P(0, 14, 2, [B(-3, -2, -3, 6, 9, 6, 18, 14)], { rx: HALF_PI }),
  P(-1, 14, -3, [B(-3, -3, -3, 8, 6, 7, 21, 0)], { rx: HALF_PI }),
  P(-2.5, 16, 7, [B(0, 0, -1, 2, 8, 2, 0, 18, true)], { swing: 1 }),
  P(0.5, 16, 7, [B(0, 0, -1, 2, 8, 2, 0, 18)], { swing: 1 }),
  P(-2.5, 16, -4, [B(0, 0, -1, 2, 8, 2, 0, 18, true)], { swing: -1 }),
  P(0.5, 16, -4, [B(0, 0, -1, 2, 8, 2, 0, 18)], { swing: -1 }),
  P(-1, 12, 8, [B(0, 0, -1, 2, 8, 2, 9, 18)], { rx: Math.PI / 5, swing: 0.4 }),
]));

/** Source: net.minecraft.client.model.animal.rabbit.AdultRabbitModel (simplified). */
export const RabbitModel: BakedModel = bakeModel(makeModel(64, 64, [
  P(0, 23, 4, [B(-4, -6, -9, 8, 6, 10, 0, 0)], { rx: -0.3927 }),          // body
  P(0, 20, -6, [B(-2, -3, -4, 5, 5, 5, 0, 16)], {}, [                        // head
    P(1.5, -3.7, -0.9, [B(-1, -4.3, -0.1, 2, 5, 1, 32, 0)]),               // left ear
    P(-1.5, -3.7, -0.9, [B(-1, -4.3, -0.1, 2, 5, 1, 26, 0)]),              // right ear
  ]),
  P(0, 19, 5, [B(-2, -3, -1, 4, 4, 4, 20, 16)]),                             // tail
  P(-2, 23, -2, [B(-1, 0, -1, 2, 4, 2, 36, 18)], { swing: 1 }),
  P(2, 23, -2, [B(-1, 0, -1, 2, 4, 2, 44, 18)], { swing: -1 }),
  P(-3, 23, 4, [B(-1, 0, -2, 2, 1, 6, 20, 24)], { swing: -1 }),
  P(3, 23, 4, [B(-1, 0, -2, 2, 1, 6, 36, 24)], { swing: 1 }),
]));

/** Source: net.minecraft.client.model.ambient.BatModel (flat wings, simplified). */
export const BatModel: BakedModel = bakeModel(makeModel(32, 32, [
  P(0, 17, 0, [B(-1.5, 0, -1, 3, 5, 2, 0, 0)]),                               // body
  P(0, 17, 0, [B(-2, -3, -1, 4, 3, 2, 0, 7)]),                                 // head
  P(-1.5, 17, 0, [B(-8, -2, 0, 8, 7, 0, 12, 0)], { swing: 1 }),               // right wing (flat)
  P(1.5, 17, 0, [B(0, -2, 0, 8, 7, 0, 12, 7)], { swing: 1 }),                 // left wing (flat)
]));

// ---------------------------------------------------------------------------
// Generic fallback models (items / projectiles), solid white texture
// ---------------------------------------------------------------------------

// NOTE: y coordinates are in model units; the root transform maps y=24 to
// entity-local y=0 (feet), so these boxes sit just above the ground.
/** Small cube used for dropped items (ItemEntityRenderer). */
export const ItemCubeModel: BakedModel = singleBoxModel(-2, 20, -2, 4, 4, 4, 0, 0, 16, 16);

/** Thin elongated box used for arrows (ArrowRenderer). */
export const ArrowModel: BakedModel = singleBoxModel(-0.5, 20, -8, 1, 1, 16, 0, 0, 16, 16);
