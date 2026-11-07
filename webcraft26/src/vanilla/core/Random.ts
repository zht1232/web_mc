// Port of net.minecraft.util.RandomSource with its two vanilla implementations:
//   LegacyRandomSource   - the java.util.Random 48 bit LCG, used by gameplay code
//   XoroshiroRandomSource- used by the world generator (with MD5 derived seeds)
// 64 bit state is held in BigInt; the arithmetic has to match vanilla exactly,
// otherwise world generation diverges from the original seeds.

const MASK64 = (1n << 64n) - 1n;
const MASK48 = (1n << 48n) - 1n;

function rotl64(x: bigint, n: bigint): bigint {
  return ((x << n) | (x >> (64n - n))) & MASK64;
}

/** Port of net.minecraft.world.level.levelgen.Xoroshiro128PlusPlus. */
export class Xoroshiro128PlusPlus {
  seedLo: bigint;
  seedHi: bigint;

  constructor(seedLo: bigint, seedHi: bigint) {
    this.seedLo = seedLo & MASK64;
    this.seedHi = seedHi & MASK64;
  }

  static fromSeed(seed: bigint): Xoroshiro128PlusPlus {
    const lo = (seed ^ 0x9e3779b97f4a7c15n) & MASK64;
    const hi = (lo + 0x6a09e667f3bcc909n) & MASK64;
    return new Xoroshiro128PlusPlus(mixStafford13(lo), mixStafford13(hi));
  }

  nextLong(): bigint {
    let lo = this.seedLo;
    let hi = this.seedHi;
    const result = (rotl64((lo + hi) & MASK64, 17n) + lo) & MASK64;
    hi ^= lo;
    this.seedLo = (rotl64(lo, 49n) ^ hi ^ (hi << 21n)) & MASK64;
    this.seedHi = rotl64(hi, 28n);
    return result;
  }
}

export function mixStafford13(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

export interface RandomSource {
  nextInt(bound?: number): number;
  nextLong(): bigint;
  nextDouble(): number;
  nextFloat(): number;
  nextBoolean(): boolean;
  nextGaussian(): number;
  consumeCount(n: number): void;
  fork(): RandomSource;
  setSeed(seed: bigint): void;
}

/** Port of net.minecraft.world.level.levelgen.LegacyRandomSource. */
export class LegacyRandomSource implements RandomSource {
  private seed: bigint;
  private haveNextNextGaussian = false;
  private nextNextGaussian = 0;

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & MASK48;
  }

  setSeed(seed: bigint): void {
    this.seed = (seed ^ 0x5deece66dn) & MASK48;
    this.haveNextNextGaussian = false;
  }

  private next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & MASK48;
    return Number(this.seed >> BigInt(48 - bits));
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32) | 0;
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits: number;
    let val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) < 0);
    return val;
  }

  nextLong(): bigint {
    const hi = BigInt(this.next(32));
    const lo = BigInt(this.next(32));
    return BigInt.asIntN(64, (hi << 32n) + lo);
  }

  nextDouble(): number {
    return ((this.next(26) * 134217728) + this.next(27)) / 9007199254740992;
  }

  nextFloat(): number {
    return this.next(24) / 16777216;
  }

  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  nextGaussian(): number {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let v1: number, v2: number, s: number;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt(-2 * Math.log(s) / s);
    this.nextNextGaussian = v2 * multiplier;
    this.haveNextNextGaussian = true;
    return v1 * multiplier;
  }

  consumeCount(n: number): void {
    for (let i = 0; i < n; i++) this.next(32);
  }

  fork(): RandomSource {
    return new LegacyRandomSource(this.nextLong());
  }

  forkPositional(): PositionalRandomFactory {
    return new LegacyPositionalRandomFactory(this.nextLong());
  }

  nextIntBetween(min: number, max: number): number { return min + this.nextInt(max - min + 1); }
  nextDoubleBetween(min: number, max: number): number { return min + this.nextDouble() * (max - min); }
  nextFloatBetween(min: number, max: number): number { return min + this.nextFloat() * (max - min); }
}

/** Port of net.minecraft.world.level.levelgen.XoroshiroRandomSource. */
export class XoroshiroRandomSource implements RandomSource {
  private gen: Xoroshiro128PlusPlus;
  private haveNextNextGaussian = false;
  private nextNextGaussian = 0;

  constructor(seedLo: bigint, seedHi?: bigint) {
    if (seedHi === undefined) {
      const lo = (seedLo ^ 0x9e3779b97f4a7c15n) & MASK64;
      const hi = (lo + 0x6a09e667f3bcc909n) & MASK64;
      this.gen = new Xoroshiro128PlusPlus(mixStafford13(lo), mixStafford13(hi));
    } else {
      this.gen = new Xoroshiro128PlusPlus(seedLo, seedHi);
    }
  }

  setSeed(seed: bigint): void {
    this.gen = Xoroshiro128PlusPlus.fromSeed(seed);
  }

  nextLong(): bigint { return this.gen.nextLong(); }

  private nextBits(bits: number): bigint {
    return this.gen.nextLong() >> BigInt(64 - bits);
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return Number(BigInt.asIntN(32, this.gen.nextLong()));
    if (bound <= 0) throw new Error('bound must be positive');
    let randomBits = Number(BigInt.asUintN(32, this.gen.nextLong()));
    let multiplied = randomBits * bound;
    let fractional = multiplied >>> 0;
    if (fractional < bound) {
      const unbiased = (0x100000000 % bound);
      while (fractional < unbiased) {
        randomBits = Number(BigInt.asUintN(32, this.gen.nextLong()));
        multiplied = randomBits * bound;
        fractional = multiplied >>> 0;
      }
    }
    return Math.floor(multiplied / 4294967296);
  }

  nextDouble(): number { return Number(this.nextBits(53)) * 1.1102230246251565e-16; }
  nextFloat(): number { return Number(this.nextBits(24)) * 5.9604645e-8; }
  nextBoolean(): boolean { return (this.gen.nextLong() & 1n) !== 0n; }

  nextGaussian(): number {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let v1: number, v2: number, s: number;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.nextNextGaussian = v2 * m;
    this.haveNextNextGaussian = true;
    return v1 * m;
  }

  consumeCount(n: number): void { for (let i = 0; i < n; i++) this.gen.nextLong(); }

  fork(): RandomSource {
    return new XoroshiroRandomSource(this.gen.nextLong(), this.gen.nextLong());
  }

  forkPositional(): PositionalRandomFactory {
    return new XoroshiroPositionalRandomFactory(this.gen.nextLong(), this.gen.nextLong());
  }
}

export interface PositionalRandomFactory {
  at(x: number, y: number, z: number): RandomSource;
  fromHashOf(name: string): RandomSource;
  fromSeed(seed: bigint): RandomSource;
}

class XoroshiroPositionalRandomFactory implements PositionalRandomFactory {
  constructor(private seedLo: bigint, private seedHi: bigint) {}

  at(x: number, y: number, z: number): RandomSource {
    const positional = Mth_getSeed(x, y, z);
    return new XoroshiroRandomSource((positional ^ this.seedLo) & MASK64, this.seedHi);
  }

  fromHashOf(name: string): RandomSource {
    const h = seedFromHashOf(name);
    return new XoroshiroRandomSource((h.lo ^ this.seedLo) & MASK64, (h.hi ^ this.seedHi) & MASK64);
  }

  fromSeed(seed: bigint): RandomSource {
    return new XoroshiroRandomSource((seed ^ this.seedLo) & MASK64, (seed ^ this.seedHi) & MASK64);
  }
}

class LegacyPositionalRandomFactory implements PositionalRandomFactory {
  constructor(private seed: bigint) {}

  at(x: number, y: number, z: number): RandomSource {
    return new LegacyRandomSource(Mth_getSeed(x, y, z) ^ this.seed);
  }

  fromHashOf(name: string): RandomSource {
    return new LegacyRandomSource(BigInt(javaStringHash(name)) ^ this.seed);
  }

  fromSeed(seed: bigint): RandomSource { return new LegacyRandomSource(seed); }
}

/** Port of net.minecraft.util.Mth.getSeed. */
export function Mth_getSeed(x: number, y: number, z: number): bigint {
  let l = BigInt.asIntN(64, BigInt(x) * 3129871n);
  l = l ^ (BigInt(z) * 116129781n);
  l = l ^ BigInt(y);
  l = BigInt.asIntN(64, l * l * 42317861n + l * 11n);
  return l >> 16n;
}

/** java.lang.String.hashCode */
export function javaStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// --------------------------------------------------------------------- MD5

/** Compact MD5, only used to derive world generation seeds the way vanilla does. */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

export function md5(input: Uint8Array): Uint8Array {
  const len = input.length;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(input);
  withPad[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
  dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + m[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const s = MD5_S[i];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return out;
}

/** Port of RandomSupport.seedFromHashOf: MD5 of the UTF-8 name, big endian longs. */
export function seedFromHashOf(name: string): { lo: bigint; hi: bigint } {
  const bytes = new TextEncoder().encode(name);
  const digest = md5(bytes);
  const dv = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const lo = BigInt.asIntN(64, (BigInt(dv.getUint32(0, false)) << 32n) | BigInt(dv.getUint32(4, false)));
  const hi = BigInt.asIntN(64, (BigInt(dv.getUint32(8, false)) << 32n) | BigInt(dv.getUint32(12, false)));
  return { lo, hi };
}

/** vanilla RandomSource.create(seed) used all over gameplay code */
export function createRandom(seed?: number): RandomSource {
  return new LegacyRandomSource(seed === undefined ? BigInt(Date.now()) : BigInt(Math.trunc(seed)));
}

/** A deterministic random for world features: same seed + pos => same result. */
export function positionalRandom(seed: number, x: number, y: number, z: number): LegacyRandomSource {
  return new LegacyRandomSource(Mth_getSeed(x, y, z) ^ BigInt(seed));
}
