// Minimal column-major 4x4 matrix stack for the first-person hand pass.
//
// Conventions match JOML / PoseStack as used by net.minecraft.client.renderer.ItemInHandRenderer:
//   - column-major storage, column vectors (v' = M * v)
//   - translate() / rotateX()/rotateY()/rotateZ() / scale() post-multiply (M = M * T)
//   - positive angles are counter-clockwise looking down the positive axis (right handed)
//
// Verified against joml 1.10.8: Matrix4f().rotationX(x).rotateY(y).rotateZ(z) equals
// Quaternionf().rotationXYZ(x, y, z) (used by ItemTransform.apply), so a sequence of
// rotateX/rotateY/rotateZ calls on this stack produces the same matrix as vanilla's
// `pose.rotate(new Quaternionf().rotationXYZ(...))`.

export type Mat4 = Float32Array<ArrayBuffer>;

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function copyMat4(out: Mat4, a: Mat4): Mat4 {
  out.set(a);
  return out;
}

/** out = a * b (both column-major). `out` may alias `a` or `b`. */
export function mulMat4(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const r = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    r[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    r[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    r[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    r[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  if (r !== out) out.set(r);
  return out;
}

export function translate(out: Mat4, x: number, y: number, z: number): Mat4 {
  out[12] += out[0] * x + out[4] * y + out[8] * z;
  out[13] += out[1] * x + out[5] * y + out[9] * z;
  out[14] += out[2] * x + out[6] * y + out[10] * z;
  out[15] += out[3] * x + out[7] * y + out[11] * z;
  return out;
}

export function scale(out: Mat4, x: number, y: number, z: number): Mat4 {
  out[0] *= x; out[1] *= x; out[2] *= x; out[3] *= x;
  out[4] *= y; out[5] *= y; out[6] *= y; out[7] *= y;
  out[8] *= z; out[9] *= z; out[10] *= z; out[11] *= z;
  return out;
}

const DEG = Math.PI / 180;

/** M = M * Rx(deg) */
export function rotateX(out: Mat4, deg: number): Mat4 {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const m4 = out[4], m5 = out[5], m6 = out[6], m7 = out[7];
  const m8 = out[8], m9 = out[9], m10 = out[10], m11 = out[11];
  out[4] = m4 * c + m8 * s; out[5] = m5 * c + m9 * s; out[6] = m6 * c + m10 * s; out[7] = m7 * c + m11 * s;
  out[8] = m8 * c - m4 * s; out[9] = m9 * c - m5 * s; out[10] = m10 * c - m6 * s; out[11] = m11 * c - m7 * s;
  return out;
}

/** M = M * Ry(deg) */
export function rotateY(out: Mat4, deg: number): Mat4 {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const m0 = out[0], m1 = out[1], m2 = out[2], m3 = out[3];
  const m8 = out[8], m9 = out[9], m10 = out[10], m11 = out[11];
  out[0] = m0 * c - m8 * s; out[1] = m1 * c - m9 * s; out[2] = m2 * c - m10 * s; out[3] = m3 * c - m11 * s;
  out[8] = m0 * s + m8 * c; out[9] = m1 * s + m9 * c; out[10] = m2 * s + m10 * c; out[11] = m3 * s + m11 * c;
  return out;
}

/** M = M * Rz(deg) */
export function rotateZ(out: Mat4, deg: number): Mat4 {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const m0 = out[0], m1 = out[1], m2 = out[2], m3 = out[3];
  const m4 = out[4], m5 = out[5], m6 = out[6], m7 = out[7];
  out[0] = m0 * c + m4 * s; out[1] = m1 * c + m5 * s; out[2] = m2 * c + m6 * s; out[3] = m3 * c + m7 * s;
  out[4] = m4 * c - m0 * s; out[5] = m5 * c - m1 * s; out[6] = m6 * c - m2 * s; out[7] = m7 * c - m3 * s;
  return out;
}

/** Rotates by an ItemTransform in the exact order of ItemTransform.apply (rotationXYZ). */
export function rotateXYZ(out: Mat4, rx: number, ry: number, rz: number): Mat4 {
  rotateX(out, rx);
  rotateY(out, ry);
  rotateZ(out, rz);
  return out;
}

/**
 * M = M * R(q) for a JOML Quaternionf (x, y, z, w).
 * Source: com/mojang/math/Transformation.compose -> Matrix4f.rotate(Quaternionfc),
 * used for the per-layer `transformation` of composite item models (beds).
 */
export function rotateQuat(out: Mat4, x: number, y: number, z: number, w: number): Mat4 {
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  // column-major 3x3 rotation of a unit quaternion
  const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz), r02 = 2 * (xz + wy);
  const r10 = 2 * (xy + wz), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wx);
  const r20 = 2 * (xz - wy), r21 = 2 * (yz + wx), r22 = 1 - 2 * (xx + yy);
  const m0 = out[0], m1 = out[1], m2 = out[2], m3 = out[3];
  const m4 = out[4], m5 = out[5], m6 = out[6], m7 = out[7];
  const m8 = out[8], m9 = out[9], m10 = out[10], m11 = out[11];
  out[0] = m0 * r00 + m4 * r01 + m8 * r02;
  out[1] = m1 * r00 + m5 * r01 + m9 * r02;
  out[2] = m2 * r00 + m6 * r01 + m10 * r02;
  out[3] = m3 * r00 + m7 * r01 + m11 * r02;
  out[4] = m0 * r10 + m4 * r11 + m8 * r12;
  out[5] = m1 * r10 + m5 * r11 + m9 * r12;
  out[6] = m2 * r10 + m6 * r11 + m10 * r12;
  out[7] = m3 * r10 + m7 * r11 + m11 * r12;
  out[8] = m0 * r20 + m4 * r21 + m8 * r22;
  out[9] = m1 * r20 + m5 * r21 + m9 * r22;
  out[10] = m2 * r20 + m6 * r21 + m10 * r22;
  out[11] = m3 * r20 + m7 * r21 + m11 * r22;
  return out;
}

/** Normal matrix = inverse-transpose of the upper-left 3x3, column-major mat3. */
export function normalMatrix(out: Float32Array, m: Mat4): Float32Array {
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) det = 1;
  const inv = 1 / det;
  // inverse(M)^T, written as a column-major mat3
  out[0] = b01 * inv;
  out[1] = (-a22 * a01 + a02 * a21) * inv;
  out[2] = (a12 * a01 - a02 * a11) * inv;
  out[3] = b11 * inv;
  out[4] = (a22 * a00 - a02 * a20) * inv;
  out[5] = (-a12 * a00 + a02 * a10) * inv;
  out[6] = b21 * inv;
  out[7] = (-a21 * a00 + a01 * a20) * inv;
  out[8] = (a11 * a00 - a01 * a10) * inv;
  return out;
}

/** P * M into a new (or supplied) matrix, column-major. */
export function mulProjModel(out: Mat4, proj: Mat4, model: Mat4): Mat4 {
  return mulMat4(out, proj, model);
}

export class Mat4Stack {
  private readonly stack: Mat4[] = [mat4()];

  get top(): Mat4 { return this.stack[this.stack.length - 1]; }

  reset(): this {
    this.stack.length = 0;
    this.stack.push(mat4());
    return this;
  }

  push(): this {
    this.stack.push(copyMat4(mat4(), this.top));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  translate(x: number, y: number, z: number): this { translate(this.top, x, y, z); return this; }
  scale(x: number, y: number, z: number): this { scale(this.top, x, y, z); return this; }
  rotateX(deg: number): this { rotateX(this.top, deg); return this; }
  rotateY(deg: number): this { rotateY(this.top, deg); return this; }
  rotateZ(deg: number): this { rotateZ(this.top, deg); return this; }
  rotateXYZ(x: number, y: number, z: number): this { rotateXYZ(this.top, x, y, z); return this; }
  mul(m: Mat4): this { mulMat4(this.top, this.top, m); return this; }
}
