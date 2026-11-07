// Port of net.minecraft.world.level.levelgen.synth.SimplexNoise.
//
// 26.2's overworld graph never samples it, but `minecraft:end_islands` does (End preset), so
// it is ported rather than stubbed: the permutation table, gradient table and the 2D/3D
// corner layout are all vanilla's.

import type { RandomSource } from '../../../../core/Random.js';

const SQRT_3 = Math.sqrt(3);
const F2 = 0.5 * (SQRT_3 - 1);
const G2 = (3 - SQRT_3) / 6;

const GRADIENT: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];

export class SimplexNoise {
  private readonly p = new Uint8Array(256);
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;

  constructor(random: RandomSource) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 0; i < 256; i++) {
      const offset = random.nextInt(256 - i);
      const tmp = this.p[i];
      this.p[i] = this.p[offset + i];
      this.p[offset + i] = tmp;
    }
  }

  private perm(x: number): number { return this.p[x & 0xff]; }

  private corner3d(index: number, x: number, y: number, z: number, base: number): number {
    let t0 = base - x * x - y * y - z * z;
    if (t0 < 0) return 0;
    t0 *= t0;
    const g = GRADIENT[index];
    return t0 * t0 * (g[0] * x + g[1] * y + g[2] * z);
  }

  getValue2d(xin: number, yin: number): number {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 0xff;
    const jj = j & 0xff;
    const gi0 = this.perm(ii + this.perm(jj)) % 12;
    const gi1 = this.perm(ii + i1 + this.perm(jj + j1)) % 12;
    const gi2 = this.perm(ii + 1 + this.perm(jj + 1)) % 12;
    const n0 = this.corner3d(gi0, x0, y0, 0, 0.5);
    const n1 = this.corner3d(gi1, x1, y1, 0, 0.5);
    const n2 = this.corner3d(gi2, x2, y2, 0, 0.5);
    return 70 * (n0 + n1 + n2);
  }

  getValue(xin: number, yin: number, zin: number): number {
    const s = (xin + yin + zin) * 0.3333333333333333;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * 0.16666666666666666;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
    const x1 = x0 - i1 + 0.16666666666666666;
    const y1 = y0 - j1 + 0.16666666666666666;
    const z1 = z0 - k1 + 0.16666666666666666;
    const x2 = x0 - i2 + 0.3333333333333333;
    const y2 = y0 - j2 + 0.3333333333333333;
    const z2 = z0 - k2 + 0.3333333333333333;
    const x3 = x0 - 1 + 0.5;
    const y3 = y0 - 1 + 0.5;
    const z3 = z0 - 1 + 0.5;
    const ii = i & 0xff;
    const jj = j & 0xff;
    const kk = k & 0xff;
    const gi0 = this.perm(ii + this.perm(jj + this.perm(kk))) % 12;
    const gi1 = this.perm(ii + i1 + this.perm(jj + j1 + this.perm(kk + k1))) % 12;
    const gi2 = this.perm(ii + i2 + this.perm(jj + j2 + this.perm(kk + k2))) % 12;
    const gi3 = this.perm(ii + 1 + this.perm(jj + 1 + this.perm(kk + 1))) % 12;
    const n0 = this.corner3d(gi0, x0, y0, z0, 0.6);
    const n1 = this.corner3d(gi1, x1, y1, z1, 0.6);
    const n2 = this.corner3d(gi2, x2, y2, z2, 0.6);
    const n3 = this.corner3d(gi3, x3, y3, z3, 0.6);
    return 32 * (n0 + n1 + n2 + n3);
  }
}
