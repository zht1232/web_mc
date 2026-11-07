// Port of net.minecraft.world.level.levelgen.DensityFunction + DensityFunctions
// (every node type that appears in 26.2's shipped overworld noise router), plus the
// CubicSpline implementation the `spline` node needs.
//
// Design notes
// ------------
// * DensityFunction is an abstract class instead of an interface so `instanceof` and
//   virtual dispatch stay cheap in the hot per-block loop.
// * Every node keeps vanilla's minValue()/maxValue() bookkeeping, because vanilla's
//   `min`/`max` nodes use those bounds to skip evaluating their second argument:
//       MIN -> v1 < argument2.minValue() ? v1 : min(v1, argument2)
//   That short-circuit is not just an optimisation, it decides how often the expensive
//   cave-noise branch is evaluated, so the bounds must be exactly vanilla's.
// * `interpolated` nodes are bound to a NoiseChunk per chunk (see InterpolatorState in
//   NoiseChunk.ts). When they are evaluated through any other context - including the
//   SinglePointContext instances FindTopSurface creates internally - they fall back to
//   direct evaluation, exactly like vanilla's `NoiseInterpolator.compute`.

import { clamp, lerp } from '../../../../core/Mth.js';
import type { NormalNoise } from '../synth/Noise.js';
import type { BlendedNoise } from '../synth/BlendedNoise.js';
import type { SimplexNoise } from '../synth/SimplexNoise.js';

// ---------------------------------------------------------------- context

/** Port of DensityFunction.FunctionContext. */
export interface FunctionContext {
  readonly blockX: number;
  readonly blockY: number;
  readonly blockZ: number;
}

/** Port of DensityFunction.SinglePointContext. */
export class SinglePointContext implements FunctionContext {
  constructor(public blockX: number, public blockY: number, public blockZ: number) {}
}

// ---------------------------------------------------------------- base class

/** Port of DensityFunction. */
export abstract class DensityFunction {
  abstract compute(ctx: FunctionContext): number;
  abstract minValue(): number;
  abstract maxValue(): number;
}

// ---------------------------------------------------------------- constants / gradients

/** DensityFunctions.Constant (a bare JSON number). */
export class Constant extends DensityFunction {
  constructor(readonly value: number) { super(); }
  compute(): number { return this.value; }
  minValue(): number { return this.value; }
  maxValue(): number { return this.value; }
}

const ZERO = new Constant(0);

export function constant(value: number): Constant { return value === 0 ? ZERO : new Constant(value); }

/** DensityFunctions.YClampedGradient. */
export class YClampedGradient extends DensityFunction {
  constructor(
    readonly fromY: number, readonly toY: number,
    readonly fromValue: number, readonly toValue: number,
  ) { super(); }

  compute(ctx: FunctionContext): number {
    const t = (ctx.blockY - this.fromY) / (this.toY - this.fromY);
    const f = t < 0 ? 0 : t > 1 ? 1 : t;
    return this.fromValue + f * (this.toValue - this.fromValue);
  }

  minValue(): number { return Math.min(this.fromValue, this.toValue); }
  maxValue(): number { return Math.max(this.fromValue, this.toValue); }
}

// ---------------------------------------------------------------- noise

/** DensityFunction.NoiseHolder: a NormalNoise plus vanilla's "null noise == 0" rule. */
export class NoiseHolder {
  constructor(readonly noise: NormalNoise) {}
  getValue(x: number, y: number, z: number): number { return this.noise.getValue(x, y, z); }
  maxValue(): number { return this.noise.maxValue(); }
}

/** DensityFunctions.Noise. */
export class NoiseDF extends DensityFunction {
  constructor(readonly noise: NoiseHolder, readonly xzScale: number, readonly yScale: number) { super(); }

  compute(ctx: FunctionContext): number {
    return this.noise.getValue(ctx.blockX * this.xzScale, ctx.blockY * this.yScale, ctx.blockZ * this.xzScale);
  }

  minValue(): number { return -this.maxValue(); }
  maxValue(): number { return this.noise.maxValue(); }
}

/** DensityFunctions.ShiftNoise base: 4 * offsetNoise(x/4, y/4, z/4). */
abstract class ShiftNoise extends DensityFunction {
  constructor(readonly offsetNoise: NoiseHolder) { super(); }

  protected shift(x: number, y: number, z: number): number {
    return this.offsetNoise.getValue(x * 0.25, y * 0.25, z * 0.25) * 4;
  }

  minValue(): number { return -this.maxValue(); }
  maxValue(): number { return this.offsetNoise.maxValue() * 4; }
}

/** DensityFunctions.Shift. */
export class Shift extends ShiftNoise {
  compute(ctx: FunctionContext): number { return this.shift(ctx.blockX, ctx.blockY, ctx.blockZ); }
}

/** DensityFunctions.ShiftA. */
export class ShiftA extends ShiftNoise {
  compute(ctx: FunctionContext): number { return this.shift(ctx.blockX, 0, ctx.blockZ); }
}

/** DensityFunctions.ShiftB. */
export class ShiftB extends ShiftNoise {
  compute(ctx: FunctionContext): number { return this.shift(ctx.blockZ, ctx.blockX, 0); }
}

/** DensityFunctions.ShiftedNoise. */
export class ShiftedNoise extends DensityFunction {
  constructor(
    readonly shiftX: DensityFunction, readonly shiftY: DensityFunction, readonly shiftZ: DensityFunction,
    readonly xzScale: number, readonly yScale: number, readonly noise: NoiseHolder,
  ) { super(); }

  compute(ctx: FunctionContext): number {
    const x = ctx.blockX * this.xzScale + this.shiftX.compute(ctx);
    const y = ctx.blockY * this.yScale + this.shiftY.compute(ctx);
    const z = ctx.blockZ * this.xzScale + this.shiftZ.compute(ctx);
    return this.noise.getValue(x, y, z);
  }

  minValue(): number { return -this.maxValue(); }
  maxValue(): number { return this.noise.maxValue(); }
}

/** `minecraft:old_blended_noise` (BlendedNoise). */
export class OldBlendedNoiseDF extends DensityFunction {
  constructor(readonly noise: BlendedNoise) { super(); }
  compute(ctx: FunctionContext): number {
    return this.noise.compute(ctx.blockX, ctx.blockY, ctx.blockZ);
  }
  minValue(): number { return -this.noise.maxValue(); }
  maxValue(): number { return this.noise.maxValue(); }
}

// ---------------------------------------------------------------- two argument ops

export type TwoArgumentType = 'add' | 'mul' | 'min' | 'max';

/** Port of DensityFunctions.Ap2 / MulOrAdd, collapsed into one class per operator. */
export abstract class TwoArgument extends DensityFunction {
  constructor(readonly argument1: DensityFunction, readonly argument2: DensityFunction) { super(); }
}

export class Add extends TwoArgument {
  private readonly min = this.argument1.minValue() + this.argument2.minValue();
  private readonly max = this.argument1.maxValue() + this.argument2.maxValue();
  compute(ctx: FunctionContext): number { return this.argument1.compute(ctx) + this.argument2.compute(ctx); }
  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

export class Mul extends TwoArgument {
  private readonly min: number;
  private readonly max: number;
  constructor(a1: DensityFunction, a2: DensityFunction) {
    super(a1, a2);
    const min1 = a1.minValue(), max1 = a1.maxValue();
    const min2 = a2.minValue(), max2 = a2.maxValue();
    this.min = min1 > 0 && min2 > 0 ? min1 * min2 : (max1 < 0 && max2 < 0 ? max1 * max2 : Math.min(min1 * max2, max1 * min2));
    this.max = min1 > 0 && min2 > 0 ? max1 * max2 : (max1 < 0 && max2 < 0 ? min1 * min2 : Math.max(min1 * min2, max1 * max2));
  }
  compute(ctx: FunctionContext): number {
    const v1 = this.argument1.compute(ctx);
    return v1 === 0 ? 0 : v1 * this.argument2.compute(ctx);
  }
  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

export class Min extends TwoArgument {
  private readonly min = Math.min(this.argument1.minValue(), this.argument2.minValue());
  private readonly max = Math.min(this.argument1.maxValue(), this.argument2.maxValue());
  /** hoisted: the second bound is constant for the lifetime of the graph */
  private readonly secondMin = this.argument2.minValue();
  compute(ctx: FunctionContext): number {
    const v1 = this.argument1.compute(ctx);
    if (v1 < this.secondMin) return v1;
    return Math.min(v1, this.argument2.compute(ctx));
  }
  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

export class Max extends TwoArgument {
  private readonly min = Math.max(this.argument1.minValue(), this.argument2.minValue());
  private readonly max = Math.max(this.argument1.maxValue(), this.argument2.maxValue());
  private readonly secondMax = this.argument2.maxValue();
  compute(ctx: FunctionContext): number {
    const v1 = this.argument1.compute(ctx);
    if (v1 > this.secondMax) return v1;
    return Math.max(v1, this.argument2.compute(ctx));
  }
  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

// ---------------------------------------------------------------- mapped / clamp

export type MappedType = 'abs' | 'square' | 'cube' | 'half_negative' | 'quarter_negative' | 'invert' | 'squeeze';

/** DensityFunctions.Mapped.Type, as numbers so the hot path switches on an int. */
const OP_ABS = 0;
const OP_SQUARE = 1;
const OP_CUBE = 2;
const OP_HALF_NEGATIVE = 3;
const OP_QUARTER_NEGATIVE = 4;
const OP_INVERT = 5;
const OP_SQUEEZE = 6;

const MAPPED_OPS: Record<MappedType, number> = {
  abs: OP_ABS,
  square: OP_SQUARE,
  cube: OP_CUBE,
  half_negative: OP_HALF_NEGATIVE,
  quarter_negative: OP_QUARTER_NEGATIVE,
  invert: OP_INVERT,
  squeeze: OP_SQUEEZE,
};

function mappedTransform(type: number, input: number): number {
  switch (type) {
    case OP_ABS: return Math.abs(input);
    case OP_SQUARE: return input * input;
    case OP_CUBE: return input * input * input;
    case OP_HALF_NEGATIVE: return input > 0 ? input : input * 0.5;
    case OP_QUARTER_NEGATIVE: return input > 0 ? input : input * 0.25;
    case OP_INVERT: return 1 / input;
    default: {
      const c = clamp(input, -1, 1);
      return c / 2 - (c * c * c) / 24;
    }
  }
}

/** DensityFunctions.Mapped. */
export class Mapped extends DensityFunction {
  private readonly min: number;
  private readonly max: number;
  private readonly op: number;

  constructor(readonly type: MappedType, readonly input: DensityFunction) {
    super();
    this.op = MAPPED_OPS[type];
    const minValue = input.minValue();
    const maxValue = input.maxValue();
    const minImage = mappedTransform(this.op, minValue);
    const maxImage = mappedTransform(this.op, maxValue);
    if (type === 'invert') {
      if (minValue < 0 && maxValue > 0) { this.min = -Infinity; this.max = Infinity; }
      else { this.min = maxImage; this.max = minImage; }
    } else if (type === 'abs' || type === 'square') {
      this.min = Math.max(0, minValue);
      this.max = Math.max(minImage, maxImage);
    } else {
      this.min = minImage;
      this.max = maxImage;
    }
  }

  compute(ctx: FunctionContext): number { return mappedTransform(this.op, this.input.compute(ctx)); }
  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

/** DensityFunctions.Clamp. */
export class Clamp extends DensityFunction {
  constructor(readonly input: DensityFunction, readonly min: number, readonly max: number) { super(); }
  compute(ctx: FunctionContext): number { return clamp(this.input.compute(ctx), this.min, this.max); }
  minValue(): number { return clamp(this.min, this.min, this.max); }
  maxValue(): number { return clamp(this.max, this.min, this.max); }
}

// ---------------------------------------------------------------- control flow

/** DensityFunctions.RangeChoice. */
export class RangeChoice extends DensityFunction {
  constructor(
    readonly input: DensityFunction, readonly minInclusive: number, readonly maxExclusive: number,
    readonly whenInRange: DensityFunction, readonly whenOutOfRange: DensityFunction,
  ) { super(); }

  compute(ctx: FunctionContext): number {
    const v = this.input.compute(ctx);
    return v >= this.minInclusive && v < this.maxExclusive
      ? this.whenInRange.compute(ctx)
      : this.whenOutOfRange.compute(ctx);
  }

  minValue(): number { return Math.min(this.whenInRange.minValue(), this.whenOutOfRange.minValue()); }
  maxValue(): number { return Math.max(this.whenInRange.maxValue(), this.whenOutOfRange.maxValue()); }
}

/** DensityFunctions.IntervalSelect (26.2's replacement for weird-scaled sampling in caves). */
export class IntervalSelect extends DensityFunction {
  private readonly min: number;
  private readonly max: number;

  constructor(
    readonly input: DensityFunction, readonly thresholds: readonly number[],
    readonly functions: readonly DensityFunction[],
  ) {
    super();
    let lo = Infinity, hi = -Infinity;
    for (const f of functions) { lo = Math.min(lo, f.minValue()); hi = Math.max(hi, f.maxValue()); }
    this.min = lo;
    this.max = hi;
  }

  private select(ctx: FunctionContext, input: number): number {
    for (let i = 0; i < this.thresholds.length; i++) {
      if (input < this.thresholds[i]) return this.functions[i].compute(ctx);
    }
    return this.functions[this.functions.length - 1].compute(ctx);
  }

  compute(ctx: FunctionContext): number { return this.select(ctx, this.input.compute(ctx)); }
  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

/** DensityFunctions.FindTopSurface. */
export class FindTopSurface extends DensityFunction {
  constructor(
    readonly density: DensityFunction, readonly upperBound: DensityFunction,
    readonly lowerBound: number, readonly cellHeight: number,
  ) { super(); }

  compute(ctx: FunctionContext): number {
    const topY = Math.floor(this.upperBound.compute(ctx) / this.cellHeight) * this.cellHeight;
    if (topY <= this.lowerBound) return this.lowerBound;
    for (let blockY = topY; blockY >= this.lowerBound; blockY -= this.cellHeight) {
      if (this.density.compute(new SinglePointContext(ctx.blockX, blockY, ctx.blockZ)) > 0) return blockY;
    }
    return this.lowerBound;
  }

  minValue(): number { return this.lowerBound; }
  maxValue(): number { return Math.max(this.lowerBound, this.upperBound.maxValue()); }
}

/** DensityFunctions.EndIslandDensityFunction. */
export class EndIslands extends DensityFunction {
  private static readonly ISLAND_THRESHOLD = -0.9;

  constructor(private readonly islandNoise: SimplexNoise) { super(); }

  private static heightValue(noise: SimplexNoise, sectionX: number, sectionZ: number): number {
    const chunkX = Math.trunc(sectionX / 2);
    const chunkZ = Math.trunc(sectionZ / 2);
    const subSectionX = sectionX % 2;
    const subSectionZ = sectionZ % 2;
    let doffs = 100 - Math.sqrt(sectionX * sectionX + sectionZ * sectionZ) * 8;
    doffs = clamp(doffs, -100, 80);
    for (let xo = -12; xo <= 12; xo++) {
      for (let zo = -12; zo <= 12; zo++) {
        const totalChunkX = chunkX + xo;
        const totalChunkZ = chunkZ + zo;
        if (totalChunkX * totalChunkX + totalChunkZ * totalChunkZ > 4096
          && noise.getValue2d(totalChunkX, totalChunkZ) < EndIslands.ISLAND_THRESHOLD) {
          const islandSize = (Math.abs(totalChunkX) * 3439 + Math.abs(totalChunkZ) * 147) % 13 + 9;
          const xd = subSectionX - xo * 2;
          const zd = subSectionZ - zo * 2;
          let newDoffs = 100 - Math.sqrt(xd * xd + zd * zd) * islandSize;
          newDoffs = clamp(newDoffs, -100, 80);
          doffs = Math.max(doffs, newDoffs);
        }
      }
    }
    return doffs;
  }

  compute(ctx: FunctionContext): number {
    return (EndIslands.heightValue(this.islandNoise, Math.trunc(ctx.blockX / 8), Math.trunc(ctx.blockZ / 8)) - 8) / 128;
  }

  minValue(): number { return -0.84375; }
  maxValue(): number { return 0.5625; }
}

// ---------------------------------------------------------------- spline

/**
 * Port of net.minecraft.util.CubicSpline (Multipoint + Constant).
 *
 * Java does the interpolation in `float`; we keep the sample input and the leaf values in
 * float32 (Math.fround) and do the Hermite blend in float64. The difference is ~1e-7 in the
 * height of a surface, far below one block.
 */
export abstract class CubicSpline {
  abstract sample(ctx: FunctionContext): number;
  abstract minValue(): number;
  abstract maxValue(): number;
}

export class ConstantSpline extends CubicSpline {
  constructor(readonly value: number) { super(); }
  sample(): number { return this.value; }
  minValue(): number { return this.value; }
  maxValue(): number { return this.value; }
}

export class MultipointSpline extends CubicSpline {
  readonly locations: Float64Array;
  readonly derivatives: Float64Array;
  private readonly min: number;
  private readonly max: number;

  constructor(
    readonly coordinate: DensityFunction,
    locations: number[],
    readonly values: CubicSpline[],
    derivatives: number[],
  ) {
    super();
    this.locations = Float64Array.from(locations, (v) => Math.fround(v));
    this.derivatives = Float64Array.from(derivatives, (v) => Math.fround(v));

    const lastIndex = this.locations.length - 1;
    let minValue = Infinity;
    let maxValue = -Infinity;
    const minInput = Math.fround(coordinate.minValue());
    const maxInput = Math.fround(coordinate.maxValue());
    if (minInput < this.locations[0]) {
      const e1 = this.linearExtend(minInput, this.locations, values[0].minValue(), this.derivatives, 0);
      const e2 = this.linearExtend(minInput, this.locations, values[0].maxValue(), this.derivatives, 0);
      minValue = Math.min(minValue, Math.min(e1, e2));
      maxValue = Math.max(maxValue, Math.max(e1, e2));
    }
    if (maxInput > this.locations[lastIndex]) {
      const e1 = this.linearExtend(maxInput, this.locations, values[lastIndex].minValue(), this.derivatives, lastIndex);
      const e2 = this.linearExtend(maxInput, this.locations, values[lastIndex].maxValue(), this.derivatives, lastIndex);
      minValue = Math.min(minValue, Math.min(e1, e2));
      maxValue = Math.max(maxValue, Math.max(e1, e2));
    }
    for (const v of values) {
      minValue = Math.min(minValue, v.minValue());
      maxValue = Math.max(maxValue, v.maxValue());
    }
    for (let i = 0; i < lastIndex; i++) {
      const x1 = this.locations[i];
      const x2 = this.locations[i + 1];
      const xDiff = x2 - x1;
      const v1 = values[i];
      const v2 = values[i + 1];
      const min1 = v1.minValue(), max1 = v1.maxValue();
      const min2 = v2.minValue(), max2 = v2.maxValue();
      const d1 = this.derivatives[i];
      const d2 = this.derivatives[i + 1];
      if (d1 !== 0 || d2 !== 0) {
        const p1 = d1 * xDiff;
        const p2 = d2 * xDiff;
        const minLerp1 = Math.min(min1, min2);
        const maxLerp1 = Math.max(max1, max2);
        const minA = p1 - max2 + min1;
        const maxA = p1 - min2 + max1;
        const minB = -p2 + min2 - max1;
        const maxB = -p2 + max2 - min1;
        const minLerp2 = Math.min(minA, minB);
        const maxLerp2 = Math.max(maxA, maxB);
        minValue = Math.min(minValue, minLerp1 + 0.25 * minLerp2);
        maxValue = Math.max(maxValue, maxLerp1 + 0.25 * maxLerp2);
      }
    }
    this.min = minValue;
    this.max = maxValue;
  }

  private linearExtend(input: number, locations: Float64Array, value: number, derivatives: Float64Array, index: number): number {
    const d = derivatives[index];
    return d === 0 ? value : value + d * (input - locations[index]);
  }

  sample(ctx: FunctionContext): number {
    const input = Math.fround(this.coordinate.compute(ctx));
    const locations = this.locations;
    const lastIndex = locations.length - 1;
    // Mth.binarySearch(0, length, i -> input < locations[i]) - 1
    let lo = 0, hi = locations.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (input < locations[mid]) hi = mid; else lo = mid + 1;
    }
    const start = lo - 1;

    if (start < 0) return this.linearExtend(input, locations, this.values[0].sample(ctx), this.derivatives, 0);
    if (start === lastIndex) return this.linearExtend(input, locations, this.values[lastIndex].sample(ctx), this.derivatives, lastIndex);

    const x1 = locations[start];
    const x2 = locations[start + 1];
    const t = (input - x1) / (x2 - x1);
    const y1 = this.values[start].sample(ctx);
    const y2 = this.values[start + 1].sample(ctx);
    const d1 = this.derivatives[start];
    const d2 = this.derivatives[start + 1];
    const a = d1 * (x2 - x1) - (y2 - y1);
    const b = -d2 * (x2 - x1) + (y2 - y1);
    return lerp(t, y1, y2) + t * (1 - t) * lerp(t, a, b);
  }

  minValue(): number { return this.min; }
  maxValue(): number { return this.max; }
}

/** DensityFunctions.Spline (a thin wrapper so the node can expose DensityFunction). */
export class SplineDF extends DensityFunction {
  constructor(readonly spline: CubicSpline) { super(); }
  compute(ctx: FunctionContext): number { return this.spline.sample(ctx); }
  minValue(): number { return this.spline.minValue(); }
  maxValue(): number { return this.spline.maxValue(); }
}

// ---------------------------------------------------------------- markers / caches

export type MarkerType = 'interpolated' | 'flat_cache' | 'cache_2d' | 'cache_once' | 'cache_all_in_cell' | 'blend_density';

/** Port of DensityFunctions.Marker; the caching markers implement their own memoisation. */
export class MarkerDF extends DensityFunction {
  constructor(readonly type: MarkerType, readonly wrapped: DensityFunction) { super(); }

  compute(ctx: FunctionContext): number { return this.wrapped.compute(ctx); }
  minValue(): number { return this.type === 'blend_density' ? -Infinity : this.wrapped.minValue(); }
  maxValue(): number { return this.type === 'blend_density' ? Infinity : this.wrapped.maxValue(); }
}

/**
 * NoiseChunk.NoiseInterpolator. The grid itself lives in the per-chunk InterpolatorState;
 * `bind` is called by the chunk before its fill loop and `unbind` at the end.
 */
export class InterpolatedDF extends MarkerDF {
  private state: InterpolatorState | null = null;

  constructor(wrapped: DensityFunction) { super('interpolated', wrapped); }

  bind(state: InterpolatorState): void { this.state = state; }
  unbind(): void { this.state = null; }

  compute(ctx: FunctionContext): number {
    const s = this.state;
    if (s !== null && s.context === ctx) return s.value;
    return this.wrapped.compute(ctx);
  }
}

/** Interface implemented by NoiseChunk's interpolation state (see NoiseChunk.ts). */
export interface InterpolatorState {
  /** the mutable context whose identity selects the interpolated fast path */
  readonly context: FunctionContext;
  readonly value: number;
}

/** DensityFunctions.BlendAlpha / BlendOffset: no neighbouring-chunk blending in a fresh world. */
export class BlendAlpha extends DensityFunction {
  compute(): number { return 1; }
  minValue(): number { return 1; }
  maxValue(): number { return 1; }
}

export class BlendOffset extends DensityFunction {
  compute(): number { return 0; }
  minValue(): number { return 0; }
  maxValue(): number { return 0; }
}

/**
 * DensityFunctions.FlatCache / Cache2D. Both memoise a y-independent value per (x, z);
 * vanilla keys them off the current column, we keep an explicit map that is cleared at the
 * start of every chunk (see CachingMarker.reset()).
 */
export class ColumnCacheDF extends MarkerDF {
  private readonly cache = new Map<number, number>();

  constructor(type: 'flat_cache' | 'cache_2d', wrapped: DensityFunction) { super(type, wrapped); }

  compute(ctx: FunctionContext): number {
    const key = (ctx.blockX + 33554432) * 67108864 + (ctx.blockZ + 33554432);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const value = this.wrapped.compute(ctx);
    if (this.cache.size > 16384) this.cache.clear(); // keep the memo bounded
    this.cache.set(key, value);
    return value;
  }

  reset(): void { this.cache.clear(); }
}

/**
 * DensityFunctions.CacheOnce: memoises a single sample. Vanilla keys it off the current
 * interpolation counter; a position key is equivalent (the function is pure) and still hits
 * when the same node is referenced several times from one parent expression.
 */
export class CacheOnceDF extends MarkerDF {
  private has = false;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastValue = 0;

  constructor(wrapped: DensityFunction) { super('cache_once', wrapped); }

  compute(ctx: FunctionContext): number {
    if (this.has && ctx.blockX === this.lastX && ctx.blockY === this.lastY && ctx.blockZ === this.lastZ) {
      return this.lastValue;
    }
    const value = this.wrapped.compute(ctx);
    this.has = true;
    this.lastX = ctx.blockX;
    this.lastY = ctx.blockY;
    this.lastZ = ctx.blockZ;
    this.lastValue = value;
    return value;
  }

  reset(): void { this.has = false; }
}

// ---------------------------------------------------------------- registry / loader

/** A JSON density function node: a number, a `minecraft:x/y` reference, or a typed node. */
export type DensityNodeJson = number | string | { readonly type: string; readonly [key: string]: unknown };

function num(node: DensityNodeJson | undefined, fallback = 0): number {
  return typeof node === 'number' ? node : fallback;
}

function str(node: DensityNodeJson | undefined): string {
  return typeof node === 'string' ? node : '';
}

/**
 * Builds the density function graph from the packed JSON. Noise instances are created with
 * the same seed derivation as RandomState + Noises.instantiate (fromHashOf the registry id).
 */
export class DensityFunctionFactory {
  private readonly cache = new Map<string, DensityFunction>();
  private readonly noises = new Map<string, NormalNoise>();
  /** every `interpolated` node in the graph, in creation order */
  readonly interpolated: InterpolatedDF[] = [];
  private readonly columnCaches: ColumnCacheDF[] = [];
  private readonly onceCaches: CacheOnceDF[] = [];

  constructor(
    private readonly nodes: Readonly<Record<string, DensityNodeJson>>,
    private readonly noiseFactory: (id: string) => NormalNoise,
    private readonly blendedNoiseFactory: (node: { xz_scale: number; y_scale: number; xz_factor: number; y_factor: number; smear_scale_multiplier: number }) => BlendedNoise,
    private readonly endIslandsFactory: () => EndIslands,
  ) {}

  resetCaches(): void {
    for (const c of this.columnCaches) c.reset();
    for (const c of this.onceCaches) c.reset();
  }

  /** Resolves a string reference, building the named function once. */
  get(name: string): DensityFunction {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const node = this.nodes[name];
    if (node === undefined) throw new Error(`unknown density function ${name}`);
    const built = this.parse(node);
    this.cache.set(name, built);
    return built;
  }

  noise(id: string): NormalNoise {
    let n = this.noises.get(id);
    if (!n) { n = this.noiseFactory(id); this.noises.set(id, n); }
    return n;
  }

  parse(node: DensityNodeJson): DensityFunction {
    if (typeof node === 'number') return constant(node);
    if (typeof node === 'string') return this.get(node);

    const type = node.type.replace('minecraft:', '');
    const arg = (key: string): DensityFunction => this.parse(node[key] as DensityNodeJson);

    switch (type) {
      case 'constant':
        return constant(num(node.argument as DensityNodeJson));
      case 'y_clamped_gradient':
        return new YClampedGradient(num(node.from_y as DensityNodeJson), num(node.to_y as DensityNodeJson),
          num(node.from_value as DensityNodeJson), num(node.to_value as DensityNodeJson));
      case 'noise':
        return new NoiseDF(new NoiseHolder(this.noise(str(node.noise as DensityNodeJson))),
          num(node.xz_scale as DensityNodeJson, 1), num(node.y_scale as DensityNodeJson, 1));
      case 'shifted_noise':
        return new ShiftedNoise(arg('shift_x'), arg('shift_y'), arg('shift_z'),
          num(node.xz_scale as DensityNodeJson, 1), num(node.y_scale as DensityNodeJson, 1),
          new NoiseHolder(this.noise(str(node.noise as DensityNodeJson))));
      case 'shift_a':
        return new ShiftA(new NoiseHolder(this.noise(str(node.argument as DensityNodeJson))));
      case 'shift_b':
        return new ShiftB(new NoiseHolder(this.noise(str(node.argument as DensityNodeJson))));
      case 'shift':
        return new Shift(new NoiseHolder(this.noise(str(node.argument as DensityNodeJson))));
      case 'add': return new Add(arg('argument1'), arg('argument2'));
      case 'mul': return new Mul(arg('argument1'), arg('argument2'));
      case 'min': return new Min(arg('argument1'), arg('argument2'));
      case 'max': return new Max(arg('argument1'), arg('argument2'));
      case 'abs': return new Mapped('abs', arg('argument'));
      case 'square': return new Mapped('square', arg('argument'));
      case 'cube': return new Mapped('cube', arg('argument'));
      case 'half_negative': return new Mapped('half_negative', arg('argument'));
      case 'quarter_negative': return new Mapped('quarter_negative', arg('argument'));
      case 'invert': return new Mapped('invert', arg('argument'));
      case 'squeeze': return new Mapped('squeeze', arg('argument'));
      case 'clamp':
        return new Clamp(arg('input'), num(node.min as DensityNodeJson), num(node.max as DensityNodeJson));
      case 'range_choice':
        return new RangeChoice(arg('input'), num(node.min_inclusive as DensityNodeJson),
          num(node.max_exclusive as DensityNodeJson), arg('when_in_range'), arg('when_out_of_range'));
      case 'interval_select': {
        const thresholds = (node.thresholds as number[]) ?? [];
        const fns = (node.functions as DensityNodeJson[]).map((f) => this.parse(f));
        return new IntervalSelect(arg('input'), thresholds, fns);
      }
      case 'spline':
        return new SplineDF(this.parseSpline(node.spline as SplineJson | number));
      case 'find_top_surface':
        return new FindTopSurface(arg('density'), arg('upper_bound'),
          num(node.lower_bound as DensityNodeJson), num(node.cell_height as DensityNodeJson, 8));
      case 'interpolated': {
        const df = new InterpolatedDF(arg('argument'));
        this.interpolated.push(df);
        return df;
      }
      case 'flat_cache': {
        const df = new ColumnCacheDF('flat_cache', arg('argument'));
        this.columnCaches.push(df);
        return df;
      }
      case 'cache_2d': {
        const df = new ColumnCacheDF('cache_2d', arg('argument'));
        this.columnCaches.push(df);
        return df;
      }
      case 'cache_once': {
        const df = new CacheOnceDF(arg('argument'));
        this.onceCaches.push(df);
        return df;
      }
      case 'cache_all_in_cell':
        // Vanilla hoists this into a 4x4x8 cell array that is filled once per cell. The wrapped
        // graph (final density) is evaluated exactly once per block anyway, so a pass-through
        // is equivalent here - only cheaper.
        return new MarkerDF('cache_all_in_cell', arg('argument'));
      case 'blend_density':
        // No Blender on a fresh single-player world: vanilla replaces this marker with its
        // wrapped function when the blender is empty.
        return new MarkerDF('blend_density', arg('argument'));
      case 'blend_alpha':
        return new BlendAlpha();
      case 'blend_offset':
        return new BlendOffset();
      case 'old_blended_noise':
        return new OldBlendedNoiseDF(this.blendedNoiseFactory({
          xz_scale: num(node.xz_scale as DensityNodeJson, 0.25),
          y_scale: num(node.y_scale as DensityNodeJson, 0.25),
          xz_factor: num(node.xz_factor as DensityNodeJson, 80),
          y_factor: num(node.y_factor as DensityNodeJson, 160),
          smear_scale_multiplier: num(node.smear_scale_multiplier as DensityNodeJson, 4),
        }));
      case 'end_islands':
        return this.endIslandsFactory();
      case 'weird_scaled_sampler':
        // Not produced by 26.2's datapack any more (interval_select replaced it), but kept so
        // older exports still load. Vanilla's formula: sample the noise at 1/scale, map it
        // through rarity, and scale the *input* by it.
        return new WeirdScaledSampler(this.parse(node.input as DensityNodeJson),
          new NoiseHolder(this.noise(str(node.noise as DensityNodeJson))),
          str(node.rarity_value_mapper as DensityNodeJson) === 'type_2' ? 2 : 1);
      default:
        throw new Error(`unsupported density function type ${type}`);
    }
  }

  private parseSpline(spline: SplineJson | number): CubicSpline {
    if (typeof spline === 'number') return new ConstantSpline(spline);
    const coordinate = this.parse(spline.coordinate as DensityNodeJson);
    const points = spline.points ?? [];
    const locations: number[] = [];
    const values: CubicSpline[] = [];
    const derivatives: number[] = [];
    for (const p of points) {
      locations.push(p.location);
      const v = p.value as SplineJson | number;
      values.push(typeof v === 'number' ? new ConstantSpline(v) : this.parseSpline(v));
      derivatives.push(p.derivative ?? 0);
    }
    return new MultipointSpline(coordinate, locations, values, derivatives);
  }
}

interface SplineJsonPoint { location: number; value: SplineJson | number; derivative?: number }
/** A spline JSON value is either a constant number or a nested multipoint object. */
export interface SplineJson {
  coordinate?: DensityNodeJson;
  points?: SplineJsonPoint[];
}

/**
 * Port of DensityFunctions.WeirdScaledSampler (1.18-1.21 shape). Unused by the 26.2
 * overworld preset; kept for older data.
 */
export class WeirdScaledSampler extends DensityFunction {
  constructor(readonly input: DensityFunction, readonly noise: NoiseHolder, readonly rarity: 1 | 2) { super(); }

  compute(ctx: FunctionContext): number {
    const scale = this.rarity === 1 ? 0.1 : 0.03;
    const n = this.noise.getValue(ctx.blockX * scale, ctx.blockY * scale, ctx.blockZ * scale);
    let rarity: number;
    if (n < 0) {
      rarity = Math.abs(n) * 75;
    } else {
      rarity = Math.abs(n) * (this.rarity === 1 ? 15 : 45);
    }
    const v = this.input.compute(ctx);
    return v > 0 ? rarity : -rarity;
  }

  minValue(): number { return -Math.abs(this.input.maxValue()); }
  maxValue(): number { return Math.abs(this.input.maxValue()); }
}
