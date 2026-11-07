// Port of net.minecraft.util.Mth: the numeric helpers vanilla uses everywhere.
// Keeping the exact formulas matters for physics and lighting parity.

export const PI = Math.PI;
export const HALF_PI = Math.PI / 2;
export const TWO_PI = Math.PI * 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const EPSILON = 1.0e-5;

export function clamp(v: number, min: number, max: number): number { return v < min ? min : v > max ? max : v; }
export function clampInt(v: number, min: number, max: number): number { return v < min ? min : v > max ? max : v; }
export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function absMax(a: number, b: number): number { return Math.abs(b) > Math.abs(a) ? b : a; }

export function floorDiv(a: number, b: number): number { return Math.floor(a / b); }
export function floorMod(a: number, b: number): number { return a - Math.floor(a / b) * b; }

export function positiveModulo(v: number, m: number): number { return ((v % m) + m) % m; }

export function lerp(t: number, a: number, b: number): number { return a + t * (b - a); }
export function lerp2(a1: number, a2: number, x00: number, x10: number, x01: number, x11: number): number {
  return lerp(a2, lerp(a1, x00, x10), lerp(a1, x01, x11));
}

export function lerp3(
  a1: number, a2: number, a3: number,
  x000: number, x100: number, x010: number, x110: number,
  x001: number, x101: number, x011: number, x111: number,
): number {
  return lerp(a3, lerp2(a1, a2, x000, x100, x010, x110), lerp2(a1, a2, x001, x101, x011, x111));
}
export function lerpInt(t: number, a: number, b: number): number { return Math.trunc(a + t * (b - a)); }
export function lerpDiscrete(t: number, a: number, b: number): number {
  const f = 1 - t;
  return Math.trunc(a * f + b * t);
}

export function invLerp(a: number, b: number, v: number): number { return (v - a) / (b - a); }

export function map(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(invLerp(inMin, inMax, v), outMin, outMax);
}

export function square(v: number): number { return v * v; }
export function cube(v: number): number { return v * v * v; }

/** vanilla Mth.sin: expects radians, uses the same parabolic approximation as vanilla? No - vanilla uses Math.sin. */
export function sin(v: number): number { return Math.sin(v); }
export function cos(v: number): number { return Math.cos(v); }
export function atan2(y: number, x: number): number { return Math.atan2(y, x); }
export function sqrt(v: number): number { return Math.sqrt(v); }

/** vanilla Mth.wrapDegrees */
export function wrapDegrees(v: number): number {
  let d = v % 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function degreesDifference(a: number, b: number): number { return wrapDegrees(b - a); }

export function rotateIfNecessary(a: number, b: number, max: number): number {
  const d = degreesDifference(a, b);
  return b - clamp(d, -max, max);
}

/** vanilla Mth.approachDegrees */
export function approachDegrees(a: number, b: number, step: number): number {
  const d = degreesDifference(a, b);
  return a + clamp(d, -step, step);
}

/** vanilla Mth.isPowerOfTwo */
export function isPowerOfTwo(v: number): boolean { return v > 0 && (v & (v - 1)) === 0; }

/** vanilla Mth.smallestEncompassingPowerOfTwo */
export function smallestEncompassingPowerOfTwo(v: number): number {
  let r = v - 1;
  r |= r >> 1; r |= r >> 2; r |= r >> 4; r |= r >> 8; r |= r >> 16;
  return r + 1;
}

export function nextFloat(...args: number[]): number { return 0; }

/** vanilla Mth.hsvToRgb */
export function hsvToRgb(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const r = [v, q, p, p, t, v][(i + 6) % 6];
  const g = [t, v, v, q, p, p][(i + 6) % 6];
  const b = [p, p, t, v, v, q][(i + 6) % 6];
  return (Math.trunc(r * 255) << 16) | (Math.trunc(g * 255) << 8) | Math.trunc(b * 255);
}

/** vanilla Mth.murmurHash3Mixer (used for chunk-ish hashing) */
export function murmurHash3Mixer(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, -2048144789);
  h ^= h >>> 13;
  h = Math.imul(h, -1028477387);
  h ^= h >>> 16;
  return h;
}

/** vanilla Mth.binarySearch over an implicit [0, length) range */
export function binarySearch(min: number, max: number, pred: (v: number) => boolean): number {
  let lo = min;
  let hi = max;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** vanilla Mth.packDegrees */
export function packDegrees(v: number): number { return Math.round(wrapDegrees(v) * 256 / 360) & 255; }
export function unpackDegrees(v: number): number { return v * 360 / 256; }

/** vanilla Mth.roundToward */
export function roundToward(v: number, steps: number): number { return (v - Math.sign(v) * 0.5) / steps * steps; }

/** vanilla Mth.lfloor */
export function lfloor(v: number): number { return Math.floor(v); }

/** vanilla Mth.ceil */
export function ceil(v: number): number { return Math.ceil(v); }

/** vanilla Mth.log2 (integer) */
export function log2i(v: number): number { return 31 - Math.clz32(v); }

/** vanilla Mth.ceilLog2 */
export function ceilLog2(v: number): number { return v <= 0 ? 0 : log2i(v - 1) + 1; }

/** vanilla Mth.easeInOutSine */
export function easeInOutSine(t: number): number { return -(Math.cos(Math.PI * t) - 1) / 2; }

/** vanilla Mth.smoothstep */
export function smoothstep(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }

/** vanilla Mth.smoothstepDerivative */
export function smoothstepDerivative(t: number): number { return 30 * t * t * (t - 1) * (t - 1); }

/** vanilla Mth.degreesToRadians */
export function rad(v: number): number { return v * DEG_TO_RAD; }
export function deg(v: number): number { return v * RAD_TO_DEG; }

/** vanilla Mth.randomBetween */
export function randomBetween(random: { nextFloat(): number }, min: number, max: number): number {
  return lerp(random.nextFloat(), min, max);
}
