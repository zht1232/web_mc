// Faithful port of Minecraft 26.2's blockstate/model baking pipeline.
// Every rule here mirrors a specific class in the decompiled client jar
// (G:/ck-web26/src-vanilla); the source is named in the comment above it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// net/minecraft/core/Direction.java (DOWN,UP,NORTH,SOUTH,WEST,EAST)
// ---------------------------------------------------------------------------
export const DIRECTIONS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DIR_NORMAL = [
  [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0],
];
export { DIR_NORMAL };
const DIR_AXIS = [1, 1, 2, 2, 0, 0]; // 0=X 1=Y 2=Z
const AXIS_NAME = ['x', 'y', 'z'];

export function dirIndex(name) {
  const i = DIRECTIONS.indexOf(name);
  if (i < 0) throw new Error('Unknown facing: ' + name);
  return i;
}

// FaceBakery.calculateFacing -> Direction.getApproximateNearest; Java seeds the
// search with NORTH and Float.MIN_VALUE (not -inf), which decides degenerate
// zero-area faces.
export function nearestDirection(v) {
  let best = 2; // NORTH
  let highest = 1.4e-45; // Float.MIN_VALUE
  for (let i = 0; i < 6; i++) {
    const n = DIR_NORMAL[i];
    const dot = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    if (dot > highest) {
      highest = dot;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 4x4 column-major matrices, matching joml's semantics for the calls we use.
// Layout is joml's: m[row + col*4].
// ---------------------------------------------------------------------------
export function matIdentity() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function matMul(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[row + k * 4] * b[k + col * 4];
      out[row + col * 4] = sum;
    }
  }
  return out;
}

// joml Matrix4f.scale(v) pre-multiplies: this = S * this
export function matScalePre(m, x, y, z) {
  const s = matIdentity();
  s[0] = x; s[5] = y; s[10] = z;
  return matMul(s, m);
}

// joml Matrix4f.translation(v) *replaces* the matrix
export function matTranslation(x, y, z) {
  const m = matIdentity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

// joml Matrix4f.rotate(q) pre-multiplies; here we only rotate about a principal axis.
export function matRotateAxisPre(m, axis, radians) {
  const r = matIdentity();
  const c = Math.cos(radians), s = Math.sin(radians);
  if (axis === 0) { r[5] = c; r[6] = s; r[9] = -s; r[10] = c; }
  else if (axis === 1) { r[0] = c; r[2] = -s; r[8] = s; r[10] = c; }
  else { r[0] = c; r[1] = s; r[4] = -s; r[5] = c; }
  return matMul(r, m);
}

// joml Matrix4f.rotation(angle, axis): replacement on a fresh identity.
export function matRotationAround(axisVec, radians) {
  const [ax, ay, az] = axisVec;
  const c = Math.cos(radians), s = Math.sin(radians), t = 1 - c;
  const m = matIdentity();
  m[0] = t * ax * ax + c; m[1] = t * ax * ay + s * az; m[2] = t * ax * az - s * ay;
  m[4] = t * ax * ay - s * az; m[5] = t * ay * ay + c; m[6] = t * ay * az + s * ax;
  m[8] = t * ax * az + s * ay; m[9] = t * ay * az - s * ax; m[10] = t * az * az + c;
  return m;
}

// joml Matrix4f(EulerXYZ): matches Matrix4f.rotationZYX(z, y, x).
export function matEulerXYZ(xDeg, yDeg, zDeg) {
  let m = matIdentity();
  m = matRotationAround([0, 0, 1], zDeg * DEG);
  m = matMul(m, matRotationAround([0, 1, 0], yDeg * DEG));
  m = matMul(m, matRotationAround([1, 0, 0], xDeg * DEG));
  return m;
}

export function transformPosition(m, v) {
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15];
  const x = (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) / w;
  const y = (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) / w;
  const z = (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) / w;
  return [x, y, z];
}

export function transformDirection(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

// joml invertAffine for the affine 4x4 we produce (rotation/scale only).
export function matInvertAffine(m) {
  const r00 = m[0], r01 = m[4], r02 = m[8];
  const r10 = m[1], r11 = m[5], r12 = m[9];
  const r20 = m[2], r21 = m[6], r22 = m[10];
  const det = r00 * (r11 * r22 - r12 * r21) - r01 * (r10 * r22 - r12 * r20) + r02 * (r10 * r21 - r11 * r20);
  if (det === 0) throw new Error('non-invertible affine matrix');
  const id = 1 / det;
  const i = new Float64Array(16);
  i[0] = (r11 * r22 - r12 * r21) * id;
  i[1] = (r12 * r20 - r10 * r22) * id;
  i[2] = (r10 * r21 - r11 * r20) * id;
  i[4] = (r02 * r21 - r01 * r22) * id;
  i[5] = (r00 * r22 - r02 * r20) * id;
  i[6] = (r01 * r20 - r00 * r21) * id;
  i[8] = (r01 * r12 - r02 * r11) * id;
  i[9] = (r02 * r10 - r00 * r12) * id;
  i[10] = (r00 * r11 - r01 * r10) * id;
  i[12] = -(i[0] * m[12] + i[4] * m[13] + i[8] * m[14]);
  i[13] = -(i[1] * m[12] + i[5] * m[13] + i[9] * m[14]);
  i[14] = -(i[2] * m[12] + i[6] * m[13] + i[10] * m[14]);
  i[15] = 1;
  return i;
}

function matIsIdentity(m) {
  const id = matIdentity();
  for (let k = 0; k < 16; k++) if (Math.abs(m[k] - id[k]) > 1e-6) return false;
  return true;
}

// ---------------------------------------------------------------------------
// com/mojang/math/SymmetricGroup3.java + OctahedralGroup.java
// ---------------------------------------------------------------------------
const PERMS = {
  P123: [0, 1, 2], P213: [1, 0, 2], P132: [0, 2, 1],
  P312: [2, 0, 1], P231: [1, 2, 0], P321: [2, 1, 0],
};
const PERM_NAMES = Object.keys(PERMS);

function permute(p, i) {
  return i === 0 ? p[0] : i === 1 ? p[1] : p[2];
}

// SymmetricGroup3.transformation(): the permutation matrix. joml names its
// elements m<col><row>, so .set(permute(i), i, 1.0f) puts the 1 at row i /
// column permute(i) — i.e. (M*v)[r] = v[permute(r)]. Verified against
// OctahedralGroup.rotate(Direction), which is the same operation written with
// the permutation table; both paths must agree or the transpose is wrong.
function permMatrix4(p) {
  const m = new Float64Array(16);
  for (let row = 0; row < 3; row++) m[row + permute(p, row) * 4] = 1;
  m[15] = 1;
  return m;
}

function permCompose(first, second) {
  const t = [permute(first, second[0]), permute(first, second[1]), permute(first, second[2])];
  return PERM_NAMES.find(n => PERMS[n][0] === t[0] && PERMS[n][1] === t[1] && PERMS[n][2] === t[2]);
}

function permInverse(p) {
  return PERM_NAMES.find(n => permCompose(PERMS[n], p) === 'P123');
}

// The 48 group elements, verbatim from the enum's constructor arguments.
const GROUP_SPEC = [
  ['identity', 'P123', false, false, false],
  ['rot_180_face_xy', 'P123', true, true, false],
  ['rot_180_face_xz', 'P123', true, false, true],
  ['rot_180_face_yz', 'P123', false, true, true],
  ['rot_120_nnn', 'P231', false, false, false],
  ['rot_120_nnp', 'P312', true, false, true],
  ['rot_120_npn', 'P312', false, true, true],
  ['rot_120_npp', 'P231', true, false, true],
  ['rot_120_pnn', 'P312', true, true, false],
  ['rot_120_pnp', 'P231', true, true, false],
  ['rot_120_ppn', 'P231', false, true, true],
  ['rot_120_ppp', 'P312', false, false, false],
  ['rot_180_edge_xy_neg', 'P213', true, true, true],
  ['rot_180_edge_xy_pos', 'P213', false, false, true],
  ['rot_180_edge_xz_neg', 'P321', true, true, true],
  ['rot_180_edge_xz_pos', 'P321', false, true, false],
  ['rot_180_edge_yz_neg', 'P132', true, true, true],
  ['rot_180_edge_yz_pos', 'P132', true, false, false],
  ['rot_90_x_neg', 'P132', false, false, true],
  ['rot_90_x_pos', 'P132', false, true, false],
  ['rot_90_y_neg', 'P321', true, false, false],
  ['rot_90_y_pos', 'P321', false, false, true],
  ['rot_90_z_neg', 'P213', false, true, false],
  ['rot_90_z_pos', 'P213', true, false, false],
  ['inversion', 'P123', true, true, true],
  ['invert_x', 'P123', true, false, false],
  ['invert_y', 'P123', false, true, false],
  ['invert_z', 'P123', false, false, true],
  ['rot_60_ref_nnn', 'P312', true, true, true],
  ['rot_60_ref_nnp', 'P231', true, false, false],
  ['rot_60_ref_npn', 'P231', false, false, true],
  ['rot_60_ref_npp', 'P312', false, false, true],
  ['rot_60_ref_pnn', 'P231', false, true, false],
  ['rot_60_ref_pnp', 'P312', true, false, false],
  ['rot_60_ref_ppn', 'P312', false, true, false],
  ['rot_60_ref_ppp', 'P231', true, true, true],
  ['swap_xy', 'P213', false, false, false],
  ['swap_yz', 'P132', false, false, false],
  ['swap_xz', 'P321', false, false, false],
  ['swap_neg_xy', 'P213', true, true, false],
  ['swap_neg_yz', 'P132', false, true, true],
  ['swap_neg_xz', 'P321', true, false, true],
  ['rot_90_ref_x_neg', 'P132', true, false, true],
  ['rot_90_ref_x_pos', 'P132', true, true, false],
  ['rot_90_ref_y_neg', 'P321', true, true, false],
  ['rot_90_ref_y_pos', 'P321', false, true, true],
  ['rot_90_ref_z_neg', 'P213', false, true, true],
  ['rot_90_ref_z_pos', 'P213', true, false, true],
];

export const GROUPS = GROUP_SPEC.map(([name, perm, ix, iy, iz]) => {
  const p = PERMS[perm];
  let m = permMatrix4(p);
  m = matScalePre(m, ix ? -1 : 1, iy ? -1 : 1, iz ? -1 : 1);
  const group = { name, permName: perm, p, invert: [ix, iy, iz], matrix: m, rotateCache: null };
  return group;
});
const GROUP_BY_NAME = new Map(GROUPS.map(g => [g.name, g]));

function groupInvertsAxis(g, axis) {
  return g.invert[axis];
}

// OctahedralGroup.rotate(Direction)
export function groupRotateDir(g, dirIdx) {
  if (!g.rotateCache) {
    const inv = PERMS[permInverse(g.p)];
    g.rotateCache = DIRECTIONS.map((_, i) => {
      const oldAxis = DIR_AXIS[i];
      const newAxis = permute(inv, oldAxis);
      // Direction along the old axis with the same sign
      const oldPositive = DIR_NORMAL[i][oldAxis] > 0;
      const flipped = groupInvertsAxis(g, newAxis) ? !oldPositive : oldPositive;
      // find the direction on newAxis with that sign
      for (let d = 0; d < 6; d++) {
        if (DIR_AXIS[d] === newAxis && (DIR_NORMAL[d][newAxis] > 0) === flipped) return d;
      }
      throw new Error('no direction for axis ' + newAxis);
    });
  }
  return g.rotateCache[dirIdx];
}

// OctahedralGroup.rotate(Vector3i)
function groupRotateVec(g, v) {
  const out = [v[g.p[0]], v[g.p[1]], v[g.p[2]]];
  out[0] *= g.invert[0] ? -1 : 1;
  out[1] *= g.invert[1] ? -1 : 1;
  out[2] *= g.invert[2] ? -1 : 1;
  return out;
}

// OctahedralGroup.compose: CAYLEY_TABLE[first][second]
export function groupCompose(first, second) {
  const perm = permCompose(first.p, second.p);
  const inv = [0, 1, 2].map(a =>
    groupInvertsAxis(first, a) ^ groupInvertsAxis(second, permute(first.p, a))
  );
  const fp = (inv[2] ? 4 : 0) + (inv[1] ? 2 : 0) + (inv[0] ? 1 : 0);
  const target = PERM_NAMES.indexOf(perm) << 3 | fp;
  return GROUPS.find(g => {
    const gi = (g.invert[2] ? 4 : 0) + (g.invert[1] ? 2 : 0) + (g.invert[0] ? 1 : 0);
    return (PERM_NAMES.indexOf(g.permName) << 3 | gi) === target;
  });
}

// ---------------------------------------------------------------------------
// com/mojang/math/Quadrant.java
// ---------------------------------------------------------------------------
export const QUADRANTS = [
  { shift: 0, x: 'identity', y: 'identity', z: 'identity' },
  { shift: 1, x: 'rot_90_x_neg', y: 'rot_90_y_neg', z: 'rot_90_z_neg' },
  { shift: 2, x: 'rot_180_face_yz', y: 'rot_180_face_xz', z: 'rot_180_face_xy' },
  { shift: 3, x: 'rot_90_x_pos', y: 'rot_90_y_pos', z: 'rot_90_z_pos' },
];

export function quadrant(degrees) {
  const mod = ((degrees % 360) + 360) % 360;
  const idx = mod / 90;
  if (idx !== Math.floor(idx) || idx > 3) throw new Error('Invalid rotation ' + degrees + ' found, only 0/90/180/270 allowed');
  return idx;
}

// Quadrant.fromXYZAngles(x, y, z): zZ.compose(yY.compose(xX))
export function groupFromXYZAngles(xq, yq, zq) {
  const gx = GROUP_BY_NAME.get(QUADRANTS[xq].x);
  const gy = GROUP_BY_NAME.get(QUADRANTS[yq].y);
  const gz = GROUP_BY_NAME.get(QUADRANTS[zq].z);
  return groupCompose(gz, groupCompose(gy, gx));
}

// ---------------------------------------------------------------------------
// BlockMath.VANILLA_UV_TRANSFORM_LOCAL_TO_GLOBAL + getFaceTransformation
// ---------------------------------------------------------------------------
// The Java table keys rotations by Direction; the local +Z normal of a face
// is rotated to the face's outward normal.
const FACE_LOCAL_TO_GLOBAL = {
  3: matIdentity(),                                    // SOUTH
  5: matRotationAround([0, 1, 0], 90 * DEG),           // EAST  (rotateY +pi/2)
  4: matRotationAround([0, 1, 0], -90 * DEG),          // WEST
  2: matRotationAround([0, 1, 0], 180 * DEG),          // NORTH
  1: matRotationAround([1, 0, 0], -90 * DEG),          // UP    (rotateX -pi/2)
  0: matRotationAround([1, 0, 0], 90 * DEG),           // DOWN
};
const FACE_GLOBAL_TO_LOCAL = Object.fromEntries(
  Object.entries(FACE_LOCAL_TO_GLOBAL).map(([k, m]) => [k, matInvertAffine(m)])
);

// BlockMath.getFaceTransformation(transformation, originalSide)
export function getFaceTransformation(transformation, originalSide) {
  if (matIsIdentity(transformation)) return transformation;
  let faceAction = matMul(transformation, FACE_LOCAL_TO_GLOBAL[originalSide]);
  const normal = transformDirection(faceAction, [0, 0, 1]);
  const newSide = nearestDirection(normal);
  return matMul(FACE_GLOBAL_TO_LOCAL[newSide], faceAction);
}

// ---------------------------------------------------------------------------
// client/renderer/block/dispatch/ModelState.java + BlockModelRotation.java
// ---------------------------------------------------------------------------
export function makeModelState({ x = 0, y = 0, z = 0, uvLock = false }) {
  const group = groupFromXYZAngles(x, y, z);
  const transformation = group.matrix;
  const faceMapping = {};
  const inverseFaceMapping = {};
  for (let d = 0; d < 6; d++) {
    const ft = getFaceTransformation(transformation, d);
    faceMapping[d] = ft;
    inverseFaceMapping[d] = matInvertAffine(ft);
  }
  return {
    group,
    transformation,
    uvLock,
    // ModelState.faceTransformation / inverseFaceTransformation
    faceTransformation(dir) {
      return uvLock ? faceMapping[dir] : matIdentity();
    },
    inverseFaceTransformation(dir) {
      return uvLock ? inverseFaceMapping[dir] : matIdentity();
    },
    key: `${x}${y}${z}${uvLock ? 'L' : ''}`,
  };
}

export const IDENTITY_STATE = makeModelState({});

// ---------------------------------------------------------------------------
// net/minecraft/client/resources/model/cuboid/CuboidRotation.java
// ---------------------------------------------------------------------------
export function makeCuboidRotation(rotationJson) {
  if (!rotationJson) return null;
  const originRaw = rotationJson.origin;
  if (!Array.isArray(originRaw) || originRaw.length !== 3) throw new Error('rotation.origin is required');
  const origin = originRaw.map(v => Number(v) * 0.0625);
  let transform;
  if (rotationJson.axis !== undefined || rotationJson.angle !== undefined) {
    if (rotationJson.axis === undefined || rotationJson.angle === undefined) {
      throw new Error('rotation needs both axis and angle');
    }
    const axis = AXIS_NAME.indexOf(String(rotationJson.axis).toLowerCase());
    if (axis < 0) throw new Error('Invalid rotation axis: ' + rotationJson.axis);
    const angle = Number(rotationJson.angle);
    transform = angle === 0 ? matIdentity() : matRotationAround(axisUnit(axis), angle * DEG);
  } else if (rotationJson.x !== undefined || rotationJson.y !== undefined || rotationJson.z !== undefined) {
    transform = matEulerXYZ(Number(rotationJson.x) || 0, Number(rotationJson.y) || 0, Number(rotationJson.z) || 0);
  } else {
    throw new Error("Missing rotation value, expected either 'axis' and 'angle' or 'x', 'y' and 'z'");
  }
  const rescale = rotationJson.rescale === true;
  if (rescale && !matIsIdentity(transform)) {
    for (let axis = 0; axis < 3; axis++) {
      const rotated = transformDirection(transform, axisUnit(axis));
      const maxComponent = Math.max(Math.abs(rotated[0]), Math.abs(rotated[1]), Math.abs(rotated[2]));
      const scale = 1 / maxComponent;
      const m = matIdentity();
      m[axis + axis * 4] = scale;
      transform = matMul(m, transform);
    }
  }
  return { origin, transform, rescale };
}

function axisUnit(axis) {
  return axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
}

// ---------------------------------------------------------------------------
// client/renderer/FaceInfo.java — which box corner each vertex index selects.
// Entries are [x,y,z] selectors: 0 = from(min), 1 = to(max).
// ---------------------------------------------------------------------------
const FACE_INFO = {
  0: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], // DOWN
  1: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // UP
  2: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], // NORTH
  3: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]], // SOUTH
  4: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], // WEST
  5: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]], // EAST
};

function faceVertex(dirIdx, i, from, to) {
  const sel = FACE_INFO[dirIdx][i];
  return [
    sel[0] ? to[0] : from[0],
    sel[1] ? to[1] : from[1],
    sel[2] ? to[2] : from[2],
  ];
}

// FaceBakery.defaultFaceUV
export function defaultFaceUV(from, to, facing) {
  const [x1, y1, z1] = from, [x2, y2, z2] = to;
  switch (facing) {
    case 0: return [x1, 16 - z2, x2, 16 - z1]; // DOWN
    case 1: return [x1, z1, x2, z2];           // UP
    case 2: return [16 - x2, 16 - y2, 16 - x1, 16 - y1]; // NORTH
    case 3: return [x1, 16 - y2, x2, 16 - y1]; // SOUTH
    case 4: return [z1, 16 - y2, z2, 16 - y1]; // WEST
    case 5: return [16 - z2, 16 - y2, 16 - z1, 16 - y1]; // EAST
  }
  throw new Error('bad facing ' + facing);
}

// CuboidFace.UVs.getVertexU / getVertexV
function uvCorner(uvs, index) {
  const u = index === 0 || index === 1 ? uvs[0] : uvs[2];
  const v = index === 0 || index === 3 ? uvs[1] : uvs[3];
  return [u, v];
}

// ---------------------------------------------------------------------------
// FaceBakery.bakeQuad
// ---------------------------------------------------------------------------
export function bakeQuad(input) {
  const { from, to, face, facing, modelState, elementRotation, shade, lightEmission, texture } = input;
  let uvs = face.uvs;
  if (!uvs) uvs = defaultFaceUV(from, to, facing);
  const shift = QUADRANTS[face.rotation || 0].shift;

  const uvTransform = modelState.inverseFaceTransformation(facing);
  const uvIsIdentity = matIsIdentity(uvTransform);
  const positions = [];
  const uvsOut = [];

  for (let i = 0; i < 4; i++) {
    let vertex = faceVertex(facing, i, from, to).map(v => v / 16);
    if (elementRotation) {
      vertex = vertex.map((v, k) => v - elementRotation.origin[k]);
      vertex = transformPosition(elementRotation.transform, vertex);
      vertex = vertex.map((v, k) => v + elementRotation.origin[k]);
    }
    if (!matIsIdentity(modelState.transformation)) {
      const o = [0.5, 0.5, 0.5];
      vertex = vertex.map((v, k) => v - o[k]);
      vertex = transformPosition(modelState.transformation, vertex);
      vertex = vertex.map((v, k) => v + o[k]);
    }

    // CuboidFace.getU/getV divides by 16, so all later maths is in 0..1 space.
    const [rawU16, rawV16] = uvCorner(uvs, (i + shift) % 4);
    let tu = rawU16 / 16, tv = rawV16 / 16;
    if (!uvIsIdentity) {
      const p = transformPosition(uvTransform, [tu - 0.5, tv - 0.5, 0]);
      tu = p[0] + 0.5;
      tv = p[1] + 0.5;
    }
    positions.push(vertex);
    uvsOut.push([tu * 16, tv * 16]);
  }

  // FaceBakery.calculateFacing + recalculateWinding
  const n = quadNormal(positions);
  let finalDir = null;
  if (n && Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2])) {
    let best = -1, bestDot = 0;
    for (let d = 0; d < 6; d++) {
      const dot = n[0] * DIR_NORMAL[d][0] + n[1] * DIR_NORMAL[d][1] + n[2] * DIR_NORMAL[d][2];
      if (dot >= 0 && dot > bestDot) { bestDot = dot; best = d; }
    }
    finalDir = best >= 0 ? best : null;
  }
  if (!elementRotation && finalDir !== null) {
    reorderWinding(positions, uvsOut, finalDir);
  }
  if (finalDir === null) finalDir = 1; // Objects.requireNonNullElse(finalDirection, Direction.UP)

  // UnbakedCuboidGeometry.bake: Direction.rotate(modelState.transformation(), cull)
  const cull = face.cullface == null
    ? -1
    : nearestDirection(transformDirection(modelState.transformation, DIR_NORMAL[dirIndex(face.cullface)]));

  return {
    p: positions.flat(),
    uv: uvsOut.flat(),
    t: texture,
    d: finalDir,
    c: cull,
    ti: face.tintindex ?? -1,
    s: shade,
    le: lightEmission || 0,
    tr: face.forceTranslucent === true,
  };
}

function quadNormal(p) {
  // joml GeometryUtils.normal(v0,v1,v2,n): cross((v1-v0), (v2-v0))
  const a = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const b = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function reorderWinding(positions, uvs, direction) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  for (let vertex = 0; vertex < 4; vertex++) {
    const sel = FACE_INFO[direction][vertex];
    const target = [
      sel[0] ? max[0] : min[0],
      sel[1] ? max[1] : min[1],
      sel[2] ? max[2] : min[2],
    ];
    let found = -1;
    for (let i = vertex; i < 4; i++) {
      // Java compares floats with ==; we bake in double precision, so allow a
      // hair of slack rather than throwing on exact-equality misses.
      const p = positions[i];
      if (Math.abs(p[0] - target[0]) < 1e-7 && Math.abs(p[1] - target[1]) < 1e-7 && Math.abs(p[2] - target[2]) < 1e-7) {
        found = i;
        break;
      }
    }
    if (found === -1) throw new Error("Can't find vertex to swap");
    if (found !== vertex) {
      const tp = positions[vertex]; positions[vertex] = positions[found]; positions[found] = tp;
      const tu = uvs[vertex]; uvs[vertex] = uvs[found]; uvs[found] = tu;
    }
  }
}

// ---------------------------------------------------------------------------
// UnbakedCuboidGeometry.bake
// ---------------------------------------------------------------------------
export function bakeElements(elements, modelState, resolveSlot) {
  const quads = [];
  for (const el of elements) {
    let drawX = true, drawY = true, drawZ = true;
    if (el.from[0] === el.to[0]) { drawY = false; drawZ = false; }
    if (el.from[1] === el.to[1]) { drawX = false; drawZ = false; }
    if (el.from[2] === el.to[2]) { drawX = false; drawY = false; }
    if (!drawX && !drawY && !drawZ) continue;
    for (const dirName of DIRECTIONS) {
      const face = el.faces[dirName];
      if (!face) continue;
      const facing = dirIndex(dirName);
      const axis = DIR_AXIS[facing];
      const shouldDraw = axis === 0 ? drawX : axis === 1 ? drawY : drawZ;
      if (!shouldDraw) continue;
      const texture = resolveSlot(face.texture);
      quads.push(bakeQuad({
        from: el.from, to: el.to, face, facing, modelState,
        elementRotation: el.rotation, shade: el.shade !== false,
        lightEmission: el.lightEmission || 0, texture,
      }));
    }
  }
  return quads;
}

// ---------------------------------------------------------------------------
// Model loading: TextureSlots.Resolver + ResolvedModel.findTop*
// ---------------------------------------------------------------------------
const MISSINGNO = 'missingno';

function normalizeLocation(name) {
  return String(name).replace(/^minecraft:/, '').replace(/^models\//, '').replace(/^textures\//, '');
}

export class ModelSource {
  constructor(assetsDir) {
    this.assetsDir = assetsDir;
    this.models = new Map();
    this.missingTextures = new Set();
    this.warnings = [];
  }

  async model(name) {
    name = normalizeLocation(name);
    if (this.models.has(name)) return this.models.get(name);
    const file = path.join(this.assetsDir, 'models', name + '.json');
    if (!existsSync(file)) {
      // builtin/generated is runtime-built in vanilla; record and treat as empty.
      const stub = { name, parent: null, raw: null, textureSlots: {}, missing: true };
      this.models.set(name, stub);
      return stub;
    }
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const slots = {};
    if (raw.textures) {
      for (const [slot, value] of Object.entries(raw.textures)) {
        if (typeof value === 'string' && value.startsWith('#')) {
          slots[slot] = { ref: value.slice(1) };
        } else if (value && typeof value === 'object' && typeof value.sprite === 'string') {
          slots[slot] = { tex: normalizeLocation(value.sprite), forceTranslucent: value.force_translucent === true };
        } else if (typeof value === 'string') {
          slots[slot] = { tex: normalizeLocation(value) };
        } else {
          throw new Error(`bad texture slot ${slot} in ${name}`);
        }
      }
    }
    const elements = raw.elements
      ? raw.elements.map(e => parseElement(e, name))
      : null;
    const model = {
      name,
      parentName: raw.parent ? normalizeLocation(raw.parent) : null,
      parent: null,
      textureSlots: slots,
      elements,
      ao: raw.ambientocclusion === undefined ? null : !!raw.ambientocclusion,
      guiLight: raw.gui_light || null,
      display: raw.display || null,
      textureSize: raw.texture_size || null,
      raw,
    };
    this.models.set(name, model);
    if (raw.parent) model.parent = await this.model(raw.parent);
    return model;
  }

  // TextureSlots.Resolver.resolve — root-first, child-last, then fixed point.
  async slotsFor(name) {
    const chain = [];
    for (let m = await this.model(name); m && !m.missing; m = m.parent) chain.push(m);
    const resolved = new Map();
    const unresolved = new Map();
    for (const m of chain.slice().reverse()) {
      for (const [slot, value] of Object.entries(m.textureSlots)) {
        if (value.ref !== undefined) {
          resolved.delete(slot);
          unresolved.set(slot, value.ref);
        } else {
          unresolved.delete(slot);
          resolved.set(slot, value);
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [slot, target] of [...unresolved]) {
        const hit = resolved.get(target);
        if (hit) {
          resolved.set(slot, hit);
          unresolved.delete(slot);
          changed = true;
        }
      }
    }
    if (unresolved.size) {
      this.warnings.push(`unresolved texture refs in ${name}: ${[...unresolved].map(([k, v]) => `#${k}->#${v}`).join(', ')}`);
    }
    return { slots: resolved, chain };
  }

  // ResolvedModel.findTop* — nearest ancestor that declares the value.
  async findTop(name, field, fallback) {
    for (let m = await this.model(name); m; m = m.parent) {
      if (m[field] !== null && m[field] !== undefined) return m[field];
    }
    return fallback;
  }

  async geometryFor(name) {
    for (let m = await this.model(name); m; m = m.parent) {
      if (m.elements && m.elements.length) return m.elements;
    }
    return null;
  }
}

function parseElement(e, modelName) {
  const pos = (obj, key) => {
    const v = obj[key];
    if (!Array.isArray(v) || v.length !== 3) throw new Error(`Expected 3 ${key} values in ${modelName}`);
    const out = v.map(Number);
    for (const c of out) {
      if (c < -16 || c > 32) throw new Error(`'${key}' specifier exceeds the allowed boundaries: ${out} in ${modelName}`);
    }
    return out;
  };
  const from = pos(e, 'from');
  const to = pos(e, 'to');
  const faces = {};
  for (const [dirName, f] of Object.entries(e.faces || {})) {
    const dir = dirName.toLowerCase();
    if (!DIRECTIONS.includes(dir)) throw new Error(`Unknown facing: ${dirName} in ${modelName}`);
    if (f.rotation !== undefined && f.rotation !== 0) {
      quadrant(Number(f.rotation)); // validate only 0/90/180/270, like Quadrant.parseJson
    }
    const uvs = f.uv === undefined ? null : (() => {
      if (!Array.isArray(f.uv) || f.uv.length !== 4) throw new Error('Expected 4 uv values');
      return f.uv.map(Number);
    })();
    faces[dir] = {
      texture: f.texture,
      uvs,
      cullface: f.cullface ? String(f.cullface).toLowerCase() : null,
      tintindex: f.tintindex === undefined ? -1 : Number(f.tintindex),
      rotation: f.rotation === undefined ? 0 : quadrant(Number(f.rotation)),
      forceTranslucent: f.force_translucent === true,
    };
  }
  if (!Object.keys(faces).length) throw new Error('Expected between 1 and 6 unique faces, got 0');
  return {
    from, to, faces,
    rotation: e.rotation ? makeCuboidRotation(e.rotation) : null,
    shade: e.shade === undefined ? true : e.shade !== false,
    lightEmission: e.light_emission === undefined ? 0 : (() => {
      const v = Number(e.light_emission);
      if (!(v >= 0 && v <= 15)) throw new Error(`Expected 'light_emission' to be an Integer between 0 and 15 in ${modelName}`);
      return v;
    })(),
  };
}

// ---------------------------------------------------------------------------
// Baking one (model, modelState) pair into a quad list
// ---------------------------------------------------------------------------
export async function bakeModel(source, modelName, modelState) {
  const { slots, chain } = await source.slotsFor(modelName);
  const elements = await source.geometryFor(modelName);
  const ao = await source.findTop(modelName, 'ao', true);
  const guiLight = await source.findTop(modelName, 'guiLight', 'side');
  const display = await source.findTop(modelName, 'display', null);
  if (!elements) {
    return { quads: [], ao, guiLight, display, noGeometry: true, root: chain[0]?.name ?? modelName };
  }
  const resolveSlot = (reference) => {
    const key = String(reference).startsWith('#') ? String(reference).slice(1) : String(reference);
    const hit = slots.get(key);
    if (hit) return hit.tex === MISSINGNO ? MISSINGNO : hit.tex;
    source.missingTextures.add(key);
    return MISSINGNO;
  };
  const quads = bakeElements(elements, modelState, resolveSlot);
  return { quads, ao, guiLight, display, noGeometry: false, root: chain[0]?.name ?? modelName };
}

export { normalizeLocation, MISSINGNO, groupRotateVec };
