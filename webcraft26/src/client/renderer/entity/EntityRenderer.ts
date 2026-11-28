// Source: net.minecraft.client.renderer.entity.{EntityRenderer, LivingEntityRenderer}
//         + net.minecraft.client.renderer.entity.state.LivingEntityRenderState
//         + net.minecraft.client.model.geom.ModelPart.translateAndRotate
//
// Base renderer. Subclasses supply the baked model, the texture key, a
// per-entity tint and (optionally) extra scale / overlay / projectile pitch.
//
// append() rebuilds the vanilla matrix stack per entity:
//
//   world = T(entityPos)                      (position, partial-tick interpolated)
//         * S(entity.scale)                   (EntityRenderer pose)
//         * RY(180 - bodyRot)                  (LivingEntityRenderer.setupRotations)
//         * RX(projectile pitch)               (ArrowRenderer)
//         * RZ(death fall)                     (setupRotations: sqrt((deathTime-1)/20*1.6), *90 deg)
//         * S(creeper swell)                   (CreeperRenderer.scale)
//         * root(-1,-1,1 / +1.501y)            (LivingEntityRenderer.submit)
//         * part chain                         (ModelPart.translateAndRotate)
//
// The per-vertex light/overlay record is stamped once per entity, so the whole
// batch still draws in one VBO with texture batching.
//
// Zero allocation in the render loop: matrices use module-scope scratch, the
// model pose overrides + vertex matrices live on the BakedModel.

import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { AnimContext, BakedModel, ModelAnimator } from './model/ModelBox.js';

/**
 * Structural view of the LivingEntity/Mob fields the renderer reads. Entities
 * that are not living (items / arrows) simply do not have them.
 * Source: LivingEntityRenderState extraction in LivingEntityRenderer.java.
 */
interface LivingLike {
  walkAnimSpeed?: number;
  walkAnimSpeedOld?: number;
  walkAnimPos?: number;
  yBodyRot?: number;
  yBodyRotO?: number;
  yHeadRot?: number;
  yHeadRotO?: number;
  swingProgress?: number;
  dead?: boolean;
  deathTime?: number;
  hurtTime?: number;
  isAggressive?: () => boolean;
  getMainHandItem?: () => { id: string; count: number } | null;
  swell?: number;
}

const DEG = Math.PI / 180;

/** floats per entity vertex: pos3 uv2 tint3 light2 overlay2 */
export const FLOATS_PER_VERTEX = 12;

/** A set of per-texture growable buffers; concatenated into one VBO at draw time. */
export class EntityBatch {
  readonly buckets: Float32Array[];
  /** float count per bucket (always a multiple of FLOATS_PER_VERTEX) */
  readonly lengths: Int32Array;

  constructor(texCount: number) {
    this.buckets = new Array(texCount);
    for (let i = 0; i < texCount; i++) this.buckets[i] = new Float32Array(256 * FLOATS_PER_VERTEX);
    this.lengths = new Int32Array(texCount);
  }

  reset(): void { this.lengths.fill(0); }

  private ensure(texId: number, extraFloats: number): void {
    const need = this.lengths[texId] + extraFloats;
    const arr = this.buckets[texId];
    if (need <= arr.length) return;
    let cap = arr.length;
    while (cap < need) cap *= 2;
    const grown = new Float32Array(cap);
    grown.set(arr);
    this.buckets[texId] = grown;
  }

  push(
    texId: number, x: number, y: number, z: number, u: number, v: number,
    r: number, g: number, b: number, sky: number, block: number, ovR: number, ovA: number,
  ): void {
    this.ensure(texId, FLOATS_PER_VERTEX);
    const arr = this.buckets[texId];
    const o = this.lengths[texId];
    arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
    arr[o + 3] = u; arr[o + 4] = v;
    arr[o + 5] = r; arr[o + 6] = g; arr[o + 7] = b;
    arr[o + 8] = sky; arr[o + 9] = block;
    arr[o + 10] = ovR; arr[o + 11] = ovA;
    this.lengths[texId] = o + FLOATS_PER_VERTEX;
  }
}

// ---------------------------------------------------------------------------
// 3x4 matrices (row-major): [a,b,c,tx, d,e,f,ty, g,h,i,tz]
// ---------------------------------------------------------------------------

type M34 = Float64Array;

const ROOT: M34 = new Float64Array([
  -1, 0, 0, 0,     // LivingEntityRenderer: poseStack.scale(-1, -1, 1)
  0, -1, 0, 1.501, // then translate(0, -1.501, 0)
  0, 0, 1, 0,
]);

const mT: M34 = new Float64Array(12);
const mRy: M34 = new Float64Array(12);
const mRz: M34 = new Float64Array(12);
const mRx: M34 = new Float64Array(12);
const mS: M34 = new Float64Array(12);
const mA: M34 = new Float64Array(12);
const mB: M34 = new Float64Array(12);
const mC: M34 = new Float64Array(12);
const mE: M34 = new Float64Array(12);
const mExtra: M34 = new Float64Array(12);
const mL: M34 = new Float64Array(12);

function identity(out: M34): void {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
}

function translation(out: M34, x: number, y: number, z: number): void {
  identity(out);
  out[3] = x; out[7] = y; out[11] = z;
}

function scaleMat(out: M34, sx: number, sy: number, sz: number): void {
  identity(out);
  out[0] = sx; out[5] = sy; out[10] = sz;
}

function rotY(out: M34, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  identity(out);
  out[0] = c; out[2] = s; out[8] = -s; out[10] = c;
}

function rotZ(out: M34, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
}

function rotX(out: M34, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  identity(out);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
}

/** out = A * B (out may alias A or B: each output row only reads the same row of A). */
function mul(out: M34, A: M34, B: M34): void {
  const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3];
  const a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7];
  const a8 = A[8], a9 = A[9], a10 = A[10], a11 = A[11];
  const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3];
  const b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7];
  const b8 = B[8], b9 = B[9], b10 = B[10], b11 = B[11];
  out[0] = a0 * b0 + a1 * b4 + a2 * b8;
  out[1] = a0 * b1 + a1 * b5 + a2 * b9;
  out[2] = a0 * b2 + a1 * b6 + a2 * b10;
  out[3] = a0 * b3 + a1 * b7 + a2 * b11 + a3;
  out[4] = a4 * b0 + a5 * b4 + a6 * b8;
  out[5] = a4 * b1 + a5 * b5 + a6 * b9;
  out[6] = a4 * b2 + a5 * b6 + a6 * b10;
  out[7] = a4 * b3 + a5 * b7 + a6 * b11 + a7;
  out[8] = a8 * b0 + a9 * b4 + a10 * b8;
  out[9] = a8 * b1 + a9 * b5 + a10 * b9;
  out[10] = a8 * b2 + a9 * b6 + a10 * b10;
  out[11] = a8 * b3 + a9 * b7 + a10 * b11 + a11;
}

/** Local matrix from rest pose + animation override (ModelPart.translateAndRotate: T then Rz,Ry,Rx). */
function poseMatrix(out: M34, tx: number, ty: number, tz: number, rx: number, ry: number, rz: number): void {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  out[0] = cz * cy; out[1] = cz * sy * sx - sz * cx; out[2] = cz * sy * cx + sz * sx; out[3] = tx;
  out[4] = sz * cy; out[5] = sz * sy * sx + cz * cx; out[6] = sz * sy * cx - cz * sx; out[7] = ty;
  out[8] = -sy; out[9] = cy * sx; out[10] = cy * cx; out[11] = tz;
}

/** Minecart/vehicle root: T(pos) * RY(yaw) * RZ(-pitch) * T(0,yOffset,0) * S(-1,-1,1). */
export function vehicleRootMatrix(
  out: M34, x: number, y: number, z: number,
  yawRad: number, pitchRad: number, yOffset = 0,
): void {
  translation(mT, x, y + yOffset, z);
  rotY(mRy, yawRad);
  rotZ(mRz, -pitchRad);
  scaleMat(mS, -1, -1, 1);
  mul(mA, mT, mRy);
  mul(mB, mA, mRz);
  mul(out, mB, mS);
}

/**
 * Boat root (AbstractBoatRenderer.submit):
 *   T(pos) * T(0, 0.375, 0) * RY(180 - yaw) * S(-1,-1,1) * RY(90)
 */
export function boatRootMatrix(
  out: M34, x: number, y: number, z: number, yawDegrees: number,
): void {
  translation(mT, x, y + 0.375, z);
  rotY(mRy, (180 - yawDegrees) * DEG);
  scaleMat(mS, -1, -1, 1);
  rotY(mRz, Math.PI / 2);
  mul(mA, mT, mRy);
  mul(mB, mA, mS);
  mul(out, mB, mRz);
}

function wrapDegrees(a: number): number {
  let d = a % 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Mth.rotLerp(partial, from, to) — shortest arc. */
function rotLerp(partial: number, from: number, to: number): number {
  return from + wrapDegrees(to - from) * partial;
}

// ---------------------------------------------------------------------------
// Per-frame scratch
// ---------------------------------------------------------------------------

const ANIM_CTX: AnimContext = {
  ageInTicks: 0, limbSwing: 0, limbSwingAmount: 0,
  headYaw: 0, headPitch: 0, attackTime: 0,
  isAggressive: false, isHoldingBow: false, swell: 0, flapAngle: 0, isResting: false,
  rowingTimeLeft: 0, rowingTimeRight: 0,
};

/** Vanilla hurt overlay colour: OverlayTexture row v=3 is 0xB2FF0000. */
const HURT_ALPHA = 0xb2 / 255;

/**
 * Extra model layer drawn after the base model, with its own texture and tint.
 * Mirrors the vanilla `RenderLayer` stack (e.g. SheepRenderer's fur layer).
 */
export interface EntityLayer {
  model: BakedModel;
  /** path relative to /mc/textures/entity/ (without .png) */
  texture: string;
  tint: readonly [number, number, number];
}

const NO_LAYERS: readonly EntityLayer[] = [];

export abstract class EntityRenderer<T extends Entity = Entity> {
  abstract getModel(e: T): BakedModel;
  abstract getTextureKey(e: T): string;
  abstract getTint(e: T): readonly [number, number, number];

  /** Additional layers drawn after the base model (empty for most entities). */
  getLayers(_e: T): readonly EntityLayer[] { return NO_LAYERS; }

  /** Extra rotation about X after yaw (radians), e.g. arrow pitch. Default 0. */
  getRotX(_e: T): number { return 0; }

  /** Extra uniform scale applied after the entity rotation (CreeperRenderer.scale). */
  getExtraScale(_e: T, _out: Float64Array): void { _out[0] = 1; _out[1] = 1; _out[2] = 1; }

  /** White overlay progress 0..1 (CreeperRenderer.getWhiteOverlayProgress). 0 = none. */
  getWhiteOverlay(_e: T): number { return 0; }

  /** Shadow radius in blocks (MobRenderer constructor shadowRadius); 0 = no shadow. */
  getShadowRadius(_e: T): number { return 0; }

  /** Shadow strength (EntityRenderer.shadowStrength, 1.0 by default). */
  getShadowStrength(_e: T): number { return 1; }

  /** Extra world-space Y offset applied before the entity rotation (ItemEntity bob). */
  getRenderYOffset(_e: T, _partialTick: number): number { return 0; }

  append(e: T, batch: EntityBatch, texId: number, partialTick: number): void {
    this.appendModel(e, this.getModel(e), this.getTint(e), batch, texId, partialTick);
  }

  /**
   * Builds the model's world matrix. Living entities use the vanilla feet-anchored
   * root; vehicles (minecarts) override this with their own anchor.
   */
  protected rootMatrix(e: T, partialTick: number, out: M34, bodyRot: number, deathDeg: number): void {
    const rx = e.xo + (e.x - e.xo) * partialTick;
    const ry = e.yo + (e.y - e.yo) * partialTick;
    const rz = e.zo + (e.z - e.zo) * partialTick;
    this.getExtraScale(e, mExtra);
    const entityScale = e.scale;

    // T(pos) * S(scale) * RY(180 - bodyRot) * RX(pitch) * RZ(death) * ROOT
    translation(mT, rx, ry + this.getRenderYOffset(e, partialTick), rz);
    scaleMat(mS, mExtra[0] * entityScale, mExtra[1] * entityScale, mExtra[2] * entityScale);
    rotY(mRy, (180 - bodyRot) * DEG);
    rotZ(mRz, deathDeg * DEG);
    rotX(mRx, this.getRotX(e));

    mul(mA, mT, mS);
    mul(mB, mA, mRy);
    mul(mA, mB, mRx);
    mul(mB, mA, mRz);
    mul(out, mB, ROOT);
  }

  /** Emits one baked model for `e` into a texture bucket (used for extra layers too). */
  appendModel(
    e: T,
    model: BakedModel,
    tint: readonly [number, number, number],
    batch: EntityBatch,
    texId: number,
    partialTick: number,
  ): void {
    const rx = e.xo + (e.x - e.xo) * partialTick;
    const ry = e.yo + (e.y - e.yo) * partialTick;
    const rz = e.zo + (e.z - e.zo) * partialTick;

    const le = e as unknown as LivingLike;
    const isLiving = typeof le.walkAnimSpeed === 'number';
    const walkSpeed = le.walkAnimSpeed ?? 0;
    const walkSpeedOld = le.walkAnimSpeedOld ?? 0;
    const walkPos = le.walkAnimPos ?? 0;

    // ---- animation state (LivingEntityRenderer.extractRenderState) ----------
    let bodyRot = rotLerp(partialTick, e.yRotO, e.yaw);
    let headYaw = 0;
    if (isLiving) {
      bodyRot = rotLerp(partialTick, le.yBodyRotO ?? bodyRot, le.yBodyRot ?? bodyRot);
      headYaw = wrapDegrees(rotLerp(partialTick, le.yHeadRotO ?? 0, le.yHeadRot ?? 0) - bodyRot) * DEG;
    }
    const headPitch = (e.xRotO + (e.pitch - e.xRotO) * partialTick) * DEG;

    const ctx = ANIM_CTX;
    ctx.ageInTicks = e.tickCount + partialTick;
    if (isLiving) {
      // WalkAnimationState.position(partialTick) / .speed(partialTick)
      ctx.limbSwing = walkPos - walkSpeed * (1 - partialTick);
      ctx.limbSwingAmount = Math.min(
        walkSpeedOld + (walkSpeed - walkSpeedOld) * partialTick, 1,
      );
      ctx.attackTime = le.swingProgress ?? 0;
    } else {
      ctx.limbSwing = 0;
      ctx.limbSwingAmount = 0;
      ctx.attackTime = 0;
    }
    ctx.headYaw = headYaw;
    ctx.headPitch = headPitch;
    const mob = le;
    ctx.isAggressive = typeof mob.isAggressive === 'function' ? mob.isAggressive() : false;
    // SkeletonRenderer: state.isHoldingBow = main hand item is a bow.
    const mainHand = typeof mob.getMainHandItem === 'function' ? mob.getMainHandItem() : null;
    ctx.isHoldingBow = !!mainHand && mainHand.id.endsWith('bow');
    ctx.swell = typeof mob.swell === 'number' ? Math.min(1, Math.max(0, mob.swell)) : 0;
    // ChickenModel/ParrotModel: flapAngle = (sin(flap) + 1) * flapSpeed. The flap
    // counters live in the survival package's Chicken/Parrot classes; approximate
    // from the current state (a hovering parrot uses the larger flying value).
    const typeName = e.getTypeName();
    ctx.flapAngle = (typeName === 'chicken' || typeName === 'parrot')
      ? (1 + Math.sin(ctx.ageInTicks * 0.9)) * (e.onGround ? 0.05 : 0.6)
      : 0;
    // Source: Bat.isResting()/BatRenderState.isResting (hanging upside down)
    ctx.isResting = e.getTypeName() === 'bat' && e.onGround;
    // AbstractBoatRenderer.extractRenderState: rowingTimeLeft/Right for the paddles.
    const rowing = e as unknown as { getRowingTime?: (side: number, partial: number) => number };
    ctx.rowingTimeLeft = typeof rowing.getRowingTime === 'function' ? rowing.getRowingTime(0, partialTick) : 0;
    ctx.rowingTimeRight = typeof rowing.getRowingTime === 'function' ? rowing.getRowingTime(1, partialTick) : 0;

    const animator: ModelAnimator | null = model.animate;
    const poses = model.poses;
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      p.x = 0; p.y = 0; p.z = 0; p.rx = 0; p.ry = 0; p.rz = 0;
    }
    if (animator) animator(model, ctx);

    // ---- entity transform ---------------------------------------------------
    // LivingEntityRenderer.setupRotations: death fall rotation about Z.
    const dead = le.dead === true;
    let deathDeg = 0;
    if (dead) {
      const deathTime = (le.deathTime ?? 0) + partialTick;
      let fall = ((deathTime - 1) / 20) * 1.6;
      if (fall < 0) fall = 0;
      fall = Math.sqrt(fall);
      if (fall > 1) fall = 1;
      deathDeg = fall * 90;
    }

    // EntityRenderer pose scale (baby) then CreeperRenderer.scale
    this.rootMatrix(e, partialTick, mE, bodyRot, deathDeg);

    // ---- per-part matrices ---------------------------------------------------
    const parts = model.parts;
    const mats = model.mats;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const p = poses[i];
      poseMatrix(
        mL,
        part.ox + p.x / 16, part.oy + p.y / 16, part.oz + p.z / 16,
        part.rx + p.rx, part.ry + p.ry, part.rz + p.rz,
      );
      const mo = i * 12;
      if (part.parent < 0) {
        mulInto(mats, mo, mE, mL);
      } else {
        mulInto2(mats, mo, mats, part.parent * 12, mL);
      }
    }

    // ---- light (EntityRenderer.getPackedLightCoords @ getEyePosition) --------
    const eyeX = Math.floor(e.x), eyeY = Math.floor(e.getEyeY()), eyeZ = Math.floor(e.z);
    let sky = e.level.getSkyLight(eyeX, eyeY, eyeZ);
    let block = e.level.getBlockLight(eyeX, eyeY, eyeZ);
    if (e.isOnFire()) block = 15; // EntityRenderer.getBlockLightLevel

    // ---- overlay (LivingEntityRenderer.getOverlayCoords) ---------------------
    let ovR = 0;
    let ovA = 1;
    const hurtTime = le.hurtTime;
    const redOverlay = (typeof hurtTime === 'number' && hurtTime > 0) || dead;
    if (redOverlay) {
      ovR = 1; ovA = HURT_ALPHA;
    } else {
      const white = this.getWhiteOverlay(e);
      if (white > 0) {
        const u = Math.floor(white * 15);
        ovA = 1 - (u / 15) * 0.75;
      }
    }

    // ---- emit ----------------------------------------------------------------
    const t0 = tint[0], t1 = tint[1], t2 = tint[2];
    for (let i = 0; i < parts.length; i++) {
      const verts = parts[i].verts;
      if (verts.length === 0) continue;
      // Per-part tint (the skeleton's bow is brown while the body stays bone white).
      const pt = parts[i].tint;
      const pr = pt ? t0 * pt[0] : t0;
      const pg = pt ? t1 * pt[1] : t1;
      const pb = pt ? t2 * pt[2] : t2;
      const mo = i * 12;
      const m00 = mats[mo], m01 = mats[mo + 1], m02 = mats[mo + 2], m03 = mats[mo + 3];
      const m10 = mats[mo + 4], m11 = mats[mo + 5], m12 = mats[mo + 6], m13 = mats[mo + 7];
      const m20 = mats[mo + 8], m21 = mats[mo + 9], m22 = mats[mo + 10], m23 = mats[mo + 11];
      for (let k = 0; k < verts.length; k += 6) {
        const vx = verts[k], vy = verts[k + 1], vz = verts[k + 2];
        batch.push(
          texId,
          m00 * vx + m01 * vy + m02 * vz + m03,
          m10 * vx + m11 * vy + m12 * vz + m13,
          m20 * vx + m21 * vy + m22 * vz + m23,
          verts[k + 3], verts[k + 4],
          verts[k + 5] * pr, verts[k + 5] * pg, verts[k + 5] * pb,
          sky, block, ovR, ovA,
        );
      }
    }
  }
}

/** mats[o..] = A * B where A is the shared mE scratch. */
function mulInto(mats: Float64Array, o: number, A: M34, B: M34): void {
  const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3];
  const a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7];
  const a8 = A[8], a9 = A[9], a10 = A[10], a11 = A[11];
  const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3];
  const b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7];
  const b8 = B[8], b9 = B[9], b10 = B[10], b11 = B[11];
  mats[o] = a0 * b0 + a1 * b4 + a2 * b8;
  mats[o + 1] = a0 * b1 + a1 * b5 + a2 * b9;
  mats[o + 2] = a0 * b2 + a1 * b6 + a2 * b10;
  mats[o + 3] = a0 * b3 + a1 * b7 + a2 * b11 + a3;
  mats[o + 4] = a4 * b0 + a5 * b4 + a6 * b8;
  mats[o + 5] = a4 * b1 + a5 * b5 + a6 * b9;
  mats[o + 6] = a4 * b2 + a5 * b6 + a6 * b10;
  mats[o + 7] = a4 * b3 + a5 * b7 + a6 * b11 + a7;
  mats[o + 8] = a8 * b0 + a9 * b4 + a10 * b8;
  mats[o + 9] = a8 * b1 + a9 * b5 + a10 * b9;
  mats[o + 10] = a8 * b2 + a9 * b6 + a10 * b10;
  mats[o + 11] = a8 * b3 + a9 * b7 + a10 * b11 + a11;
}

/** mats[o..] = A(offset ao) * B. */
function mulInto2(mats: Float64Array, o: number, A: Float64Array, ao: number, B: M34): void {
  const a0 = A[ao], a1 = A[ao + 1], a2 = A[ao + 2], a3 = A[ao + 3];
  const a4 = A[ao + 4], a5 = A[ao + 5], a6 = A[ao + 6], a7 = A[ao + 7];
  const a8 = A[ao + 8], a9 = A[ao + 9], a10 = A[ao + 10], a11 = A[ao + 11];
  const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3];
  const b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7];
  const b8 = B[8], b9 = B[9], b10 = B[10], b11 = B[11];
  mats[o] = a0 * b0 + a1 * b4 + a2 * b8;
  mats[o + 1] = a0 * b1 + a1 * b5 + a2 * b9;
  mats[o + 2] = a0 * b2 + a1 * b6 + a2 * b10;
  mats[o + 3] = a0 * b3 + a1 * b7 + a2 * b11 + a3;
  mats[o + 4] = a4 * b0 + a5 * b4 + a6 * b8;
  mats[o + 5] = a4 * b1 + a5 * b5 + a6 * b9;
  mats[o + 6] = a4 * b2 + a5 * b6 + a6 * b10;
  mats[o + 7] = a4 * b3 + a5 * b7 + a6 * b11 + a7;
  mats[o + 8] = a8 * b0 + a9 * b4 + a10 * b8;
  mats[o + 9] = a8 * b1 + a9 * b5 + a10 * b9;
  mats[o + 10] = a8 * b2 + a9 * b6 + a10 * b10;
  mats[o + 11] = a8 * b3 + a9 * b7 + a10 * b11 + a11;
}
