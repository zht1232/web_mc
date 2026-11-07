export type Mat4 = Float32Array;

export function mat4(): Mat4 { return new Float32Array(16); }

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function basisFromYawPitch(yaw: number, pitch: number) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const fx = -sy * cp, fy = -sp, fz = cy * cp;
  // right = forward x up
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // up = right x forward
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  return { fx, fy, fz, rx, ry, rz, ux, uy, uz };
}

export function viewFromYawPitch(out: Mat4, yaw: number, pitch: number, ex: number, ey: number, ez: number): Mat4 {
  const { fx, fy, fz, rx, ry, rz, ux, uy, uz } = basisFromYawPitch(yaw, pitch);
  const de = rx * ex + ry * ey + rz * ez;
  const ue = ux * ex + uy * ey + uz * ez;
  const fe = fx * ex + fy * ey + fz * ez;
  out[0] = rx; out[1] = ux; out[2] = -fx; out[3] = 0;
  out[4] = ry; out[5] = uy; out[6] = -fy; out[7] = 0;
  out[8] = rz; out[9] = uz; out[10] = -fz; out[11] = 0;
  out[12] = -de; out[13] = -ue; out[14] = fe; out[15] = 1;
  return out;
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

export function translation(out: Mat4, x: number, y: number, z: number): Mat4 {
  identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function scaling(out: Mat4, x: number, y: number, z: number): Mat4 {
  identity(out);
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

export function rotationX(out: Mat4, angle: number): Mat4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  identity(out);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

export function rotationY(out: Mat4, angle: number): Mat4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  identity(out);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

export function rotationZ(out: Mat4, angle: number): Mat4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

export function lookAt(out: Mat4, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, ux: number, uy: number, uz: number): Mat4 {
  let fx = tx - ex, fy = ty - ey, fz = tz - ez;
  let fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux;
  let sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const vx = sy * fz - sz * fy, vy = sz * fx - sx * fz, vz = sx * fy - sy * fx;
  out[0] = sx; out[1] = vx; out[2] = -fx; out[3] = 0;
  out[4] = sy; out[5] = vy; out[6] = -fy; out[7] = 0;
  out[8] = sz; out[9] = vz; out[10] = -fz; out[11] = 0;
  out[12] = -(sx * ex + sy * ey + sz * ez);
  out[13] = -(vx * ex + vy * ey + vz * ez);
  out[14] = fx * ex + fy * ey + fz * ez;
  out[15] = 1;
  return out;
}

export function ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

export function invert(out: Mat4, a: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return out.fill(0);
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
