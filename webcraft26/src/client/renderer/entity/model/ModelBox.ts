// Source: net.minecraft.client.model.geom.builders.{CubeListBuilder,PartDefinition,
//         MeshDefinition,LayerDefinition,CubeDefinition} + net.minecraft.client.model.geom.ModelPart
//
// The Java entity models are built from hard-coded `addBox(...)` / `PartPose`
// calls. This module turns those into a DATA-DRIVEN hierarchy (BoxDef /
// PartDef / ModelDef) and bakes the box geometry ONCE into static vertex
// buffers that are LOCAL TO EACH PART:
//
//   * a part keeps its rest offset + rest rotation (ModelPart.x/y/z, xRot/yRot/zRot),
//     exactly like PartPose.offset / offsetAndRotation;
//   * a part's boxes are stored in model units, local to that part, so the
//     renderer can rebuild the vanilla matrix stack every frame
//     (ModelPart.translateAndRotate: translate -> rotateZ -> rotateY -> rotateX);
//   * UV rectangles follow ModelPart.Cube exactly (6 faces per box, optional
//     `mirror` like CubeListBuilder.mirror());
//   * each vertex is (x,y,z, u,v, shade) — shade is the vanilla directional
//     face lighting approximation.
//
// Per-frame animation is applied by a ModelAnimator: it writes PartPoseAnim
// overrides (rotation + position deltas, same units/signs as the Java
// `setupAnim` code it was transcribed from). Nothing is allocated per frame.

export interface BoxDef {
  /** min corner in model units */
  x: number; y: number; z: number;
  /** size in model units (also the texel size of the UV region) */
  w: number; h: number; d: number;
  /** texture offset in texels */
  u: number; v: number;
  mirror?: boolean;
  /** CubeDeformation (uniform grow) */
  grow?: number;
}

export interface PartPose {
  /** offset in model units (PartPose.offset) */
  x?: number; y?: number; z?: number;
  /** rest rotation in radians (PartPose.rotation) */
  rx?: number; ry?: number; rz?: number;
}

export interface PartDef {
  /** vanilla part name, e.g. "head" / "right_arm" (used by the animators) */
  name: string;
  pose?: PartPose;
  boxes?: BoxDef[];
  children?: PartDef[];
}

export interface ModelDef {
  texW: number;
  texH: number;
  /** root children; the root itself only carries the vanilla -1.501 root transform */
  children: PartDef[];
}

/** Per-part animation override; rotation radians, position in MODEL UNITS (like Java). */
export interface PartPoseAnim {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
}

export interface AnimContext {
  /** EntityRenderState.ageInTicks = tickCount + partialTick */
  ageInTicks: number;
  /** WalkAnimationState.position(partialTick) */
  limbSwing: number;
  /** WalkAnimationState.speed(partialTick) */
  limbSwingAmount: number;
  /** head yaw relative to the body, radians (LivingEntityRenderState.yRot) */
  headYaw: number;
  /** head pitch, radians (LivingEntityRenderState.xRot) */
  headPitch: number;
  /** getAttackAnim(partialTick), 0..1 */
  attackTime: number;
  isAggressive: boolean;
  isHoldingBow: boolean;
  /** Creeper.getSwelling(partialTick), 0..1 */
  swell: number;
  /** chicken wing flap angle: (sin(flap) + 1) * flapSpeed */
  flapAngle: number;
  /** Bat.isResting() — hanging upside down (BatRenderState.isResting) */
  isResting: boolean;
}

export interface BakedPart {
  name: string;
  /** index of the parent part, -1 for a root part */
  parent: number;
  /** rest offset in BLOCK units (PartPose offset / 16) */
  ox: number; oy: number; oz: number;
  /** rest rotation in radians */
  rx: number; ry: number; rz: number;
  /** interleaved (x,y,z,u,v,shade) triangles in BLOCK units, local to this part */
  verts: Float32Array;
}

/** Writes animation overrides into model.poses. Never allocates. */
export type ModelAnimator = (model: BakedModel, ctx: AnimContext) => void;

export interface BakedModel {
  parts: BakedPart[];
  /** part name -> index in parts */
  byName: Map<string, number>;
  /** reusable per-part pose overrides (reset before each animate call) */
  poses: PartPoseAnim[];
  /** reusable per-part 3x4 world matrices (row-major, [a,b,c,tx, d,e,f,ty, g,h,i,tz]) */
  mats: Float64Array;
  vertexCount: number;
  animate: ModelAnimator | null;
}

// ---------------------------------------------------------------------------
// Storage constants
// ---------------------------------------------------------------------------

export const FLOATS_PER_MODEL_VERTEX = 6;

// ---------------------------------------------------------------------------
// Face shading (vanilla directional lighting approximation)
// ---------------------------------------------------------------------------

const SHADE_UP = 1.0;
const SHADE_DOWN = 0.5;
const SHADE_Z = 0.8;   // north / south
const SHADE_X = 0.6;   // east / west

/**
 * Emits a 2-triangle quad from 4 corners (model units, part-local).
 * UV order matches ModelPart.Polygon.remap: v0->(ub,va) v1->(ua,va)
 * v2->(ua,vb) v3->(ub,vb). `mirror` reverses the vertex order exactly like
 * ModelPart.Polygon does (the box's x extents were already swapped).
 */
function emitQuad(
  out: number[],
  corners: [number, number, number][],
  ua: number, va: number, ub: number, vb: number,
  shade: number, texW: number, texH: number, mirror: boolean,
): void {
  const uv: [number, number][] = [[ub, va], [ua, va], [ua, vb], [ub, vb]];
  const order = mirror ? [3, 2, 1, 3, 1, 0] : [0, 1, 2, 0, 2, 3];
  for (let k = 0; k < 6; k++) {
    const i = order[k];
    const c = corners[i];
    out.push(
      c[0] / 16, c[1] / 16, c[2] / 16,
      uv[i][0] / texW, uv[i][1] / texH,
      shade,
    );
  }
}

/** Bakes one part's boxes into part-local vertices (blocks, 6 floats per vertex). */
function bakeBoxes(boxes: BoxDef[], texW: number, texH: number): Float32Array {
  const out: number[] = [];
  for (const b of boxes) {
    const g = b.grow ?? 0;
    let ax = b.x - g, ay = b.y - g, az = b.z - g;
    let bx = b.x + b.w + g, by = b.y + b.h + g, bz = b.z + b.d + g;
    if (b.mirror) { const t = ax; ax = bx; bx = t; } // ModelPart.Cube: swap minX/maxX
    const t0: [number, number, number] = [ax, ay, az];
    const t1: [number, number, number] = [bx, ay, az];
    const t2: [number, number, number] = [bx, by, az];
    const t3: [number, number, number] = [ax, by, az];
    const l0: [number, number, number] = [ax, ay, bz];
    const l1: [number, number, number] = [bx, ay, bz];
    const l2: [number, number, number] = [bx, by, bz];
    const l3: [number, number, number] = [ax, by, bz];

    const u0 = b.u, v0 = b.v;
    const u1 = u0 + b.d, u2 = u1 + b.w, u22 = u2 + b.w;
    const u3 = u2 + b.d, u4 = u3 + b.w;
    const v1 = v0 + b.d, v2 = v1 + b.h;
    const m = b.mirror === true;

    emitQuad(out, [l1, l0, t0, t1], u1, v0, u2, v1, SHADE_DOWN, texW, texH, m); // DOWN
    emitQuad(out, [t2, t3, l3, l2], u2, v1, u22, v0, SHADE_UP, texW, texH, m);  // UP
    emitQuad(out, [t0, l0, l3, t3], u0, v1, u1, v2, SHADE_X, texW, texH, m);    // WEST
    emitQuad(out, [t1, t0, t3, t2], u1, v1, u2, v2, SHADE_Z, texW, texH, m);    // NORTH
    emitQuad(out, [l1, t1, t2, l2], u2, v1, u3, v2, SHADE_X, texW, texH, m);    // EAST
    emitQuad(out, [l0, l1, l2, l3], u3, v1, u4, v2, SHADE_Z, texW, texH, m);    // SOUTH
  }
  return new Float32Array(out);
}

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------

function bakePart(def: PartDef, parent: number, model: ModelDef, out: BakedPart[]): void {
  const pose = def.pose;
  const index = out.length;
  out.push({
    name: def.name,
    parent,
    ox: (pose?.x ?? 0) / 16,
    oy: (pose?.y ?? 0) / 16,
    oz: (pose?.z ?? 0) / 16,
    rx: pose?.rx ?? 0,
    ry: pose?.ry ?? 0,
    rz: pose?.rz ?? 0,
    verts: def.boxes && def.boxes.length > 0 ? bakeBoxes(def.boxes, model.texW, model.texH) : EMPTY_VERTS,
  });
  if (def.children) {
    for (let i = 0; i < def.children.length; i++) bakePart(def.children[i], index, model, out);
  }
}

const EMPTY_VERTS = new Float32Array(0);

/** Bakes a ModelDef into a static part hierarchy. Call ONCE per model type. */
export function bakeModel(model: ModelDef): BakedModel {
  const parts: BakedPart[] = [];
  for (let i = 0; i < model.children.length; i++) bakePart(model.children[i], -1, model, parts);
  const byName = new Map<string, number>();
  let vertexCount = 0;
  const poses: PartPoseAnim[] = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    byName.set(parts[i].name, i);
    vertexCount += parts[i].verts.length / FLOATS_PER_MODEL_VERTEX;
    poses[i] = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  }
  return {
    parts,
    byName,
    poses,
    mats: new Float64Array(parts.length * 12),
    vertexCount,
    animate: null,
  };
}

/** Attaches a setupAnim transcription to a baked model. */
export function withAnimator(model: BakedModel, animate: ModelAnimator): BakedModel {
  model.animate = animate;
  return model;
}

/** Convenience: a single-box model (used by items / projectiles). */
export function singleBoxModel(
  x: number, y: number, z: number, w: number, h: number, d: number,
  u: number, v: number, texW: number, texH: number,
): BakedModel {
  return bakeModel({
    texW, texH,
    children: [{ name: 'cube', boxes: [{ x, y, z, w, h, d, u, v }] }],
  });
}
