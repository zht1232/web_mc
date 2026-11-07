// Port of net.minecraft.world.level.levelgen.WorldgenRandom.
//
// Vanilla's decoration stage builds ONE of these over a XoroshiroRandomSource (see
// ChunkGenerator.applyBiomeDecoration): `new WorldgenRandom(new XoroshiroRandomSource(...))`.
// WorldgenRandom extends LegacyRandomSource but overrides `next(bits)` so that every random
// value is the TOP `bits` bits of the wrapped XOROSHIRO generator's nextLong(). The rest of
// nextInt/nextLong/nextFloat/nextDouble is inherited unchanged from BitRandomSource.
//
// setSeed() reproduces XoroshiroRandomSource.setSeed -> RandomSupport.upgradeSeedTo128bit(seed):
// lo = seed ^ SILVER, hi = lo + GOLDEN, then Stafford13-mix both. Random.ts' one-argument
// XoroshiroRandomSource has those two constants swapped, so we do the upgrade here explicitly.
//
// PERFORMANCE: BigInt is only used for the 128-bit seed upgrade (a handful of calls per chunk).
// The per-draw xoroshiro128++ step is implemented with four 32-bit NUMBER words; it was verified
// bit-for-bit against Random.ts' BigInt Xoroshiro128PlusPlus for several seeds. BigInt in the
// hot path was ~100x too slow (a chunk draws millions of random values during feature placement).

import { mixStafford13 } from '../../../../core/Random.js';

const MASK64 = (1n << 64n) - 1n;
const SILVER_RATIO_64 = 0x6a09e667f3bcc909n; // RandomSupport.SILVER_RATIO_64
const GOLDEN_RATIO_64 = 0x9e3779b97f4a7c15n; // RandomSupport.GOLDEN_RATIO_64 (unsigned)

/** The RandomSource surface worldgen features actually use. */
export interface FeatureRandom {
  nextInt(bound?: number): number;
  nextLong(): bigint;
  nextFloat(): number;
  nextDouble(): number;
  nextBoolean(): boolean;
}

/**
 * xoroshiro128++ with the 128-bit state held as four 32-bit words. next() performs one state
 * advance and returns the 64-bit result as [low32, high32]. Exact port of
 * net.minecraft.world.level.levelgen.Xoroshiro128PlusPlus.nextLong().
 */
class FastXoroshiro {
  private s0lo = 0;
  private s0hi = 0;
  private s1lo = 0;
  private s1hi = 0;

  constructor(a: bigint, b: bigint) {
    this.s0lo = Number(a & 0xffffffffn) >>> 0;
    this.s0hi = Number((a >> 32n) & 0xffffffffn) >>> 0;
    this.s1lo = Number(b & 0xffffffffn) >>> 0;
    this.s1hi = Number((b >> 32n) & 0xffffffffn) >>> 0;
  }

  next(): [number, number] {
    const a0 = this.s0lo, a1 = this.s0hi, b0 = this.s1lo, b1 = this.s1hi;
    // sum = s0 + s1 (64-bit add with carry)
    const s = a0 + b0, carry = s >= 4294967296 ? 1 : 0;
    const sL = s >>> 0, sH = (a1 + b1 + carry) >>> 0;
    // rotl(sum, 17)
    const rL = ((sL << 17) | (sH >>> 15)) >>> 0;
    const rH = ((sH << 17) | (sL >>> 15)) >>> 0;
    // result = rotl(sum,17) + s0
    const q = rL + a0, c2 = q >= 4294967296 ? 1 : 0;
    const resL = q >>> 0, resH = (rH + a1 + c2) >>> 0;
    // s1 ^= s0
    const n10 = (b0 ^ a0) >>> 0, n11 = (b1 ^ a1) >>> 0;
    // seedLo = rotl(s0,49) ^ s1 ^ (s1 << 21)   [rotl(...,49) = rotl(swap(s0),17)]
    const rot49L = ((a1 << 17) | (a0 >>> 15)) >>> 0;
    const rot49H = ((a0 << 17) | (a1 >>> 15)) >>> 0;
    const shL = (n10 << 21) >>> 0;
    const shH = ((n11 << 21) | (n10 >>> 11)) >>> 0;
    this.s0lo = (rot49L ^ n10 ^ shL) >>> 0;
    this.s0hi = (rot49H ^ n11 ^ shH) >>> 0;
    // seedHi = rotl(s1,28)
    this.s1lo = ((n10 << 28) | (n11 >>> 4)) >>> 0;
    this.s1hi = ((n11 << 28) | (n10 >>> 4)) >>> 0;
    return [resL, resH];
  }
}

/** Exact port of net.minecraft.world.level.levelgen.WorldgenRandom (XOROSHIRO backing). */
export class WorldgenRandom implements FeatureRandom {
  private gen: FastXoroshiro;
  /** number of next() calls, mirroring WorldgenRandom.count */
  count = 0;

  constructor(seed: bigint = 0n) {
    this.gen = new FastXoroshiro(GOLDEN_RATIO_64, SILVER_RATIO_64);
    this.setSeed(seed);
  }

  /** WorldgenRandom.setSeed -> randomSource.setSeed(seed) (XOROSHIRO). */
  setSeed(seed: bigint): void {
    const s = BigInt.asUintN(64, seed);
    const lo = (s ^ SILVER_RATIO_64) & MASK64;
    const hi = (lo + GOLDEN_RATIO_64) & MASK64;
    let a = mixStafford13(lo);
    let b = mixStafford13(hi);
    // Xoroshiro128PlusPlus substitutes default seeds when both are zero.
    if ((a | b) === 0n) { a = GOLDEN_RATIO_64; b = SILVER_RATIO_64; }
    this.gen = new FastXoroshiro(a, b);
    this.count = 0;
  }

  /** WorldgenRandom.next(bits) = (int)(xoroshiro.nextLong() >>> (64 - bits)). */
  private next(bits: number): number {
    this.count++;
    const r = this.gen.next();
    // for bits <= 32, (long >>> (64-bits)) == (high32 >>> (32-bits))
    return (r[1] >>> (32 - bits)) | 0;
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & (bound - 1)) === 0) {
      // (int)((long)bound * next(31) >> 31)
      return Math.floor((bound * this.next(31)) / 2147483648);
    }
    let sample: number, modulo: number;
    do {
      sample = this.next(31);
      modulo = sample % bound;
      // Java int overflow: sample - modulo + (bound - 1) < 0
    } while (((sample - modulo + (bound - 1)) | 0) < 0);
    return modulo;
  }

  /**
   * BitRandomSource.nextLong() = ((long)upper << 32) + lower with both ints SIGN-EXTENDED.
   * The sign extension of a negative `lower` borrows into the high word, so this is NOT a plain
   * OR of the two 32-bit patterns. BigInt is fine here: nextLong() is only used by
   * setDecorationSeed/setLargeFeatureSeed (~a dozen calls per chunk), never in the hot loop.
   */
  nextLong(): bigint {
    const upper = this.next(32);
    const lower = this.next(32);
    const shifted = BigInt.asIntN(64, BigInt.asIntN(64, BigInt(upper)) << 32n);
    return BigInt.asIntN(64, shifted + BigInt.asIntN(64, BigInt(lower)));
  }

  nextFloat(): number { return this.next(24) * 5.9604645e-8; }
  nextDouble(): number {
    const upper = this.next(26);
    const lower = this.next(27);
    return (upper * 134217728 + lower) * 1.110223e-16;
  }
  nextBoolean(): boolean { return this.next(1) !== 0; }

  /** Vanilla: seed + chunkX*xScale + chunkZ*zScale... with |1 on the scales. */
  setDecorationSeed(seed: bigint, chunkX: number, chunkZ: number): bigint {
    this.setSeed(seed);
    const xScale = this.nextLong() | 1n;
    const zScale = this.nextLong() | 1n;
    const mx = BigInt.asUintN(64, BigInt(chunkX) * xScale);
    const mz = BigInt.asUintN(64, BigInt(chunkZ) * zScale);
    const result = BigInt.asUintN(64, mx + mz) ^ BigInt.asUintN(64, seed);
    this.setSeed(result);
    return result;
  }

  setFeatureSeed(seed: bigint, index: number, step: number): void {
    const result = BigInt.asUintN(64, BigInt.asUintN(64, seed) + BigInt(index) + 10000n * BigInt(step));
    this.setSeed(result);
  }

  setLargeFeatureSeed(seed: bigint, chunkX: number, chunkZ: number): void {
    this.setSeed(seed);
    const xScale = this.nextLong();
    const zScale = this.nextLong();
    const mx = BigInt.asUintN(64, BigInt(chunkX) * xScale);
    const mz = BigInt.asUintN(64, BigInt(chunkZ) * zScale);
    const result = (mx ^ mz) ^ BigInt.asUintN(64, seed);
    this.setSeed(result);
  }

  setLargeFeatureWithSalt(seed: bigint, x: number, z: number, blend: number): void {
    const result = BigInt.asUintN(64,
      341873128712n * BigInt(x) + 132897987541n * BigInt(z) +
      BigInt.asUintN(64, seed) + BigInt(blend));
    this.setSeed(result);
  }
}
