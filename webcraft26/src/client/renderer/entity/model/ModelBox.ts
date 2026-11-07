// Source: net.minecraft.client.model.geom.builders.{CubeListBuilder,PartDefinition,
//         MeshDefinition,LayerDefinition,CubeDefinition} + net.minecraft.client.model.geom.ModelPart
//
// The Java entity models are built from hard-coded `addBox(...)` / `PartPose`
// calls. This module turns those into a DATA-DRIVEN description (BoxDef /
// PartDef / ModelDef) and bakes them ONCE into static vertex buffers:
//
//   * box corners are in "model units" (16 units = 1 block),
//   * PartPose offset/rotation are applied as a 4x4 matrix per part,
//   * the vanilla root transform (scale(-1,-1,1) + translate(0,-1.501,0))
//     is baked in so the result is entity-local: +Y up, feet at y=0,
//     centred on x=0/z=0, head toward -Z,
//   * UV rectangles follow ModelPart.Cube exactly (6 faces per box),
//   * each vertex is (x,y,z, u,v, r,g,b) where r,g,b is a directional face shade.
//
// Baking happens at module load, never per frame.

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
  /** offset in model units */
  x?: number; y?: number; z?: number;
  /** rotation in radians */
  rx?: number; ry?: number; rz?: number;
  /** limb-swing amplitude for this part (0 = static) */
  swing?: number;
}

export interface PartDef {
  name?: string;
  pose?: PartPose;
  boxes?: BoxDef[];
  children?: PartDef[];
}

export interface ModelDef {
  texW: number;
  texH: number;
  root: PartDef;
}

export interface BakedPart {
  /** pivot in entity-local space (y-up, feet=0) */
  pivot: [number, number, number];
  swing: number;
  /** interleaved (x,y,z,u,v,r,g,b) triangles, 8 floats per vertex */
  vertices: Float32Array;
}

export interface BakedModel {
  parts: BakedPart[];
  /** total vertex count across all parts */
  vertexCount: number;
}

// ---------------------------------------------------------------------------
// 4x4 column-major matrices (only used at bake time)
// ---------------------------------------------------------------------------

type M4 = Float64Array;

function identity(): M4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function translation(x: number, y: number, z: number): M4 {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function rotX(t: number): M4 {
  const m = identity(), c = Math.cos(t), s = Math.sin(t);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}
function rotY(t: number): M4 {
  const m = identity(), c = Math.cos(t), s = Math.sin(t);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}
function rotZ(t: number): M4 {
  const m = identity(), c = Math.cos(t), s = Math.sin(t);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

function transform(m: M4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Vanilla root transform: S=scale(-1,-1,1) * T=translate(0,-1.501,0). */
function toEntityLocal(p: [number, number, number]): [number, number, number] {
  return [-p[0], 1.501 - p[1], p[2]];
}

// ---------------------------------------------------------------------------
// Face shading (vanilla directional lighting approximation)
// ---------------------------------------------------------------------------

const SHADE_UP = 1.0;
const SHADE_DOWN = 0.5;
const SHADE_Z = 0.8;   // north / south
const SHADE_X = 0.6;   // east / west

/** Emits a 2-triangle quad. UV rect may have v0>v1 (UP face), which is allowed. */
function emitQuad(
  out: number[], m: M4,
  corners: [number, number, number][],
  ua: number, va: number, ub: number, vb: number,
  shade: number, texW: number, texH: number,
): void {
  // matches ModelPart.Polygon remap: v0->(ub,va), v1->(ua,va), v2->(ua,vb), v3->(ub,vb)
  const uv: [number, number][] = [[ub, va], [ua, va], [ua, vb], [ub, vb]];
  const order = [0, 1, 2, 0, 2, 3];
  for (let k = 0; k < 6; k++) {
    const i = order[k];
    const c = corners[i];
    const p = transform(m, c[0] / 16, c[1] / 16, c[2] / 16);
    const e = toEntityLocal(p);
    out.push(e[0], e[1], e[2], uv[i][0] / texW, uv[i][1] / texH, shade, shade, shade);
  }
}

function bakeBoxes(boxes: BoxDef[], m: M4, texW: number, texH: number): Float32Array {
  const out: number[] = [];
  for (const b of boxes) {
    const g = b.grow ?? 0;
    let ax = b.x - g, ay = b.y - g, az = b.z - g;
    let bx = b.x + b.w + g, by = b.y + b.h + g, bz = b.z + b.d + g;
    if (b.mirror) { const t = ax; ax = bx; bx = t; } // harmless for centred boxes
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

    emitQuad(out, m, [l1, l0, t0, t1], u1, v0, u2, v1, SHADE_DOWN, texW, texH); // DOWN
    emitQuad(out, m, [t2, t3, l3, l2], u2, v1, u22, v0, SHADE_UP, texW, texH);   // UP
    emitQuad(out, m, [t0, l0, l3, t3], u0, v1, u1, v2, SHADE_X, texW, texH);     // WEST
    emitQuad(out, m, [t1, t0, t3, t2], u1, v1, u2, v2, SHADE_Z, texW, texH);     // NORTH
    emitQuad(out, m, [l1, t1, t2, l2], u2, v1, u3, v2, SHADE_X, texW, texH);     // EAST
    emitQuad(out, m, [l0, l1, l2, l3], u3, v1, u4, v2, SHADE_Z, texW, texH);     // SOUTH
  }
  return new Float32Array(out);
}

function partMatrix(pose: PartPose | undefined): M4 {
  let m = translation((pose?.x ?? 0) / 16, (pose?.y ?? 0) / 16, (pose?.z ?? 0) / 16);
  if (pose?.rz) m = mul(m, rotZ(pose.rz));
  if (pose?.ry) m = mul(m, rotY(pose.ry));
  if (pose?.rx) m = mul(m, rotX(pose.rx));
  return m;
}

function bakePart(def: PartDef, parent: M4, model: ModelDef, parts: BakedPart[]): void {
  const acc = mul(parent, partMatrix(def.pose));
  if (def.boxes && def.boxes.length > 0) {
    const verts = bakeBoxes(def.boxes, acc, model.texW, model.texH);
    const p = transform(acc, 0, 0, 0);
    parts.push({
      pivot: toEntityLocal(p),
      swing: def.pose?.swing ?? 0,
      vertices: verts,
    });
  }
  if (def.children) {
    for (let i = 0; i < def.children.length; i++) bakePart(def.children[i], acc, model, parts);
  }
}

/** Bakes a ModelDef into static geometry. Call ONCE per model type. */
export function bakeModel(model: ModelDef): BakedModel {
  const parts: BakedPart[] = [];
  bakePart(model.root, identity(), model, parts);
  let vertexCount = 0;
  for (let i = 0; i < parts.length; i++) vertexCount += parts[i].vertices.length / 8;
  return { parts, vertexCount };
}

/** Convenience: a single-box model (used by items / projectiles). */
export function singleBoxModel(
  x: number, y: number, z: number, w: number, h: number, d: number,
  u: number, v: number, texW: number, texH: number, swing = 0,
): BakedModel {
  return bakeModel({
    texW, texH,
    root: {
      pose: { swing },
      boxes: [{ x, y, z, w, h, d, u, v }],
    },
  });
}
