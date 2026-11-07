// Node test for the matrix helpers used by the renderer / depth-based post passes.
//
//   npx tsx scripts/test-glmath.mts
//
// Pure math (no WebGL): checks the column-major conventions of mat4Perspective / mat4View /
// mat4Mul / mat4Invert so the SSAO/TAA groundwork cannot silently regress.

import { mat4Identity, mat4Perspective, mat4View, mat4Mul, mat4Invert } from '../src/client/renderer/gl/Gl.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const near = 0.05;
const far = 1024;
const proj = mat4Perspective((70 * Math.PI) / 180, 1280 / 720, near, far);
const view = mat4View(12.5, 64.62, -30.5, Math.PI, 0.1);
const viewProj = mat4Mul(proj, view, new Float32Array(16));

/** Column-major 4x4 * vec4. */
function transform(m: Float32Array, v: number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[0 * 4 + r] * v[0] + m[1 * 4 + r] * v[1] + m[2 * 4 + r] * v[2] + m[3 * 4 + r] * v[3];
  }
  return out;
}

const maxAbsDiff = (a: Float32Array | number[], b: Float32Array | number[]): number => {
  let d = 0;
  for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(Number(a[i]) - Number(b[i])));
  return d;
};

// 1. mat4Invert(proj) * proj = identity
const invProj = mat4Invert(proj, new Float32Array(16));
check('[1] inv(projection) * projection = identity', maxAbsDiff(mat4Mul(proj, invProj), mat4Identity()) < 1e-5,
  `maxDiff=${maxAbsDiff(mat4Mul(proj, invProj), mat4Identity()).toExponential(2)}`);

// 2. round trip: view-space point -> NDC -> back to the same view-space point
const eye = [1.5, -2.25, -4.0];
const clip = transform(proj, [eye[0], eye[1], eye[2], 1]);
const ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
const back = transform(invProj, [ndc[0], ndc[1], ndc[2], 1]);
const backView = [back[0] / back[3], back[1] / back[3], back[2] / back[3]];
check('[2] NDC+depth -> view space round trip', Math.hypot(backView[0] - eye[0], backView[1] - eye[1], backView[2] - eye[2]) < 1e-4,
  `${backView.map((v) => v.toFixed(4)).join(',')}`);

// 3. perspective depth ordering: farther = larger window depth in [0,1]
const depthAt = (distance: number): number => {
  const c = transform(proj, [0, 0, -distance, 1]);
  return (c[2] / c[3]) * 0.5 + 0.5;
};
const dNear = depthAt(1);
const dFar = depthAt(64);
check('[3] depth grows with distance', dNear > 0 && dNear < dFar && dFar < 1,
  `1m=${dNear.toFixed(4)} 64m=${dFar.toFixed(4)}`);

// 4. view matrix places the camera at the origin looking down -Z (OpenGL convention)
const camInView = transform(view, [12.5, 64.62, -30.5, 1]);
check('[4] view matrix maps the eye to the origin', Math.hypot(camInView[0], camInView[1], camInView[2]) < 1e-5,
  camInView.slice(0, 3).map((v) => v.toFixed(4)).join(','));

// 5. viewProj round trip: world -> clip -> world, including the inverse of full transform chains
const invViewProj = mat4Invert(viewProj, new Float32Array(16));
const world = [13.25, 65.5, -35.75];
const wClip = transform(viewProj, [...world, 1]);
const wNdc = [wClip[0] / wClip[3], wClip[1] / wClip[3], wClip[2] / wClip[3]];
const wBack = transform(invViewProj, [wNdc[0], wNdc[1], wNdc[2], 1]);
const wBackWorld = [wBack[0] / wBack[3], wBack[1] / wBack[3], wBack[2] / wBack[3]];
check('[5] world -> clip -> world round trip',
  Math.hypot(wBackWorld[0] - world[0], wBackWorld[1] - world[1], wBackWorld[2] - world[2]) < 1e-3,
  wBackWorld.map((v) => v.toFixed(3)).join(','));

// 6. mat4Invert of a singular matrix falls back to identity (no NaNs)
const singular = new Float32Array(16);
singular.fill(0);
const invSingular = mat4Invert(singular, new Float32Array(16));
let finite = true;
for (const v of invSingular) if (!Number.isFinite(v)) finite = false;
check('[6] singular inverse is finite', finite && maxAbsDiff(invSingular, mat4Identity()) < 1e-6);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`}  EXIT=${failures === 0 ? 0 : 1}`);
process.exit(failures === 0 ? 0 : 1);
