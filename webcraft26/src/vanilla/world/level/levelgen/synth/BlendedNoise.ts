// Port of net.minecraft.world.level.levelgen.synth.BlendedNoise, plus the two pieces of
// the noise stack it needs that Noise.ts does not expose:
//   * PerlinNoise.createLegacyForBlendedNoise  (the "old" sequential initialisation)
//   * ImprovedNoise.noise(x, y, z, yScale, yFudge)  (the smeared 5 argument variant)
//
// `old_blended_noise` is what feeds minecraft:overworld/base_3d_noise, which the vanilla
// overworld's sloped_cheese -> final_density graph depends on, so this has to be exact.
// The permutation tables and the sampling order are byte for byte the vanilla ones.

import { smoothstep } from '../../../../core/Mth.js';
import type { RandomSource } from '../../../../core/Random.js';

/** SimplexNoise.GRADIENT, flattened to keep the 40-octave loop free of tuple derefs. */
const GRADIENT = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);

function gradDot(hash: number, x: number, y: number, z: number): number {
  const g = (hash & 15) * 3;
  return GRADIENT[g] * x + GRADIENT[g + 1] * y + GRADIENT[g + 2] * z;
}

/** Mth.lerp3, inlined here to keep the hot loop free of import noise. */
function lerp3(
  a1: number, a2: number, a3: number,
  x000: number, x100: number, x010: number, x110: number,
  x001: number, x101: number, x011: number, x111: number,
): number {
  const y0 = x000 + a1 * (x100 - x000);
  const y1 = x010 + a1 * (x110 - x010);
  const y2 = x001 + a1 * (x101 - x001);
  const y3 = x011 + a1 * (x111 - x011);
  const z0 = y0 + a2 * (y1 - y0);
  const z1 = y2 + a2 * (y3 - y2);
  return z0 + a3 * (z1 - z0);
}

/**
 * Port of net.minecraft.world.level.levelgen.synth.ImprovedNoise including the deprecated
 * 5 argument `noise` overload used by BlendedNoise (vertical "smearing").
 */
export class LegacyImprovedNoise {
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;
  private readonly p = new Uint8Array(256);

  constructor(random: RandomSource) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 0; i < 256; i++) {
      const offset = random.nextInt(256 - i);
      const tmp = this.p[i];
      this.p[i] = this.p[i + offset];
      this.p[i + offset] = tmp;
    }
  }

  private perm(x: number): number {
    return this.p[x & 0xff];
  }

  noise(px: number, py: number, pz: number, yScale = 0, yFudge = 0): number {
    const x = px + this.xo;
    const y = py + this.yo;
    const z = pz + this.zo;
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const zf = Math.floor(z);
    const xr = x - xf;
    const yr = y - yf;
    const zr = z - zf;
    let yrFudge: number;
    if (yScale !== 0) {
      const fudgeLimit = yFudge >= 0 && yFudge < yr ? yFudge : yr;
      yrFudge = Math.floor(fudgeLimit / yScale + 1.0e-7) * yScale;
    } else {
      yrFudge = 0;
    }
    return this.sampleAndLerp(xf, yf, zf, xr, yr - yrFudge, zr, yr);
  }

  private sampleAndLerp(
    x: number, y: number, z: number,
    xr: number, yr: number, zr: number, yrOriginal: number,
  ): number {
    const x0 = this.perm(x);
    const x1 = this.perm(x + 1);
    const xy00 = this.perm(x0 + y);
    const xy01 = this.perm(x0 + y + 1);
    const xy10 = this.perm(x1 + y);
    const xy11 = this.perm(x1 + y + 1);
    const d000 = gradDot(this.perm(xy00 + z), xr, yr, zr);
    const d100 = gradDot(this.perm(xy10 + z), xr - 1, yr, zr);
    const d010 = gradDot(this.perm(xy01 + z), xr, yr - 1, zr);
    const d110 = gradDot(this.perm(xy11 + z), xr - 1, yr - 1, zr);
    const d001 = gradDot(this.perm(xy00 + z + 1), xr, yr, zr - 1);
    const d101 = gradDot(this.perm(xy10 + z + 1), xr - 1, yr, zr - 1);
    const d011 = gradDot(this.perm(xy01 + z + 1), xr, yr - 1, zr - 1);
    const d111 = gradDot(this.perm(xy11 + z + 1), xr - 1, yr - 1, zr - 1);
    return lerp3(
      smoothstep(xr), smoothstep(yrOriginal), smoothstep(zr),
      d000, d100, d010, d110, d001, d101, d011, d111,
    );
  }
}

/**
 * Port of PerlinNoise's legacy initialisation: every octave pulls one ImprovedNoise straight
 * off the shared RandomSource, in decreasing octave order (octave 0 last). The modern
 * initialisation used for NormalNoise lives in Noise.ts.
 */
export class LegacyPerlinNoise {
  private readonly levels: (LegacyImprovedNoise | null)[];
  private readonly firstOctave: number;
  private readonly lowestFreqInputFactor: number;
  private readonly lowestFreqValueFactor: number;
  private readonly maxVal: number;

  constructor(random: RandomSource, firstOctave: number, octaveCount: number) {
    this.firstOctave = firstOctave;
    const zeroOctaveIndex = -firstOctave;
    // amplitudes are all 1.0 for the blended noise graph
    this.levels = new Array<LegacyImprovedNoise | null>(octaveCount).fill(null);

    const zeroOctave = new LegacyImprovedNoise(random);
    if (zeroOctaveIndex >= 0 && zeroOctaveIndex < octaveCount) {
      this.levels[zeroOctaveIndex] = zeroOctave;
    }
    for (let i = zeroOctaveIndex - 1; i >= 0; i--) {
      if (i < octaveCount) this.levels[i] = new LegacyImprovedNoise(random);
      else random.consumeCount(262); // skipOctave
    }
    // Vanilla refuses positive octaves ("Positive octaves are temporarily disabled"); the
    // blended noise graph never asks for them because firstOctave is always -(count - 1).

    this.lowestFreqInputFactor = Math.pow(2, -zeroOctaveIndex);
    this.lowestFreqValueFactor = Math.pow(2, octaveCount - 1) / (Math.pow(2, octaveCount) - 1);
    this.maxVal = this.edgeValue(2);
  }

  getOctaveNoise(i: number): LegacyImprovedNoise | null {
    return this.levels[this.levels.length - 1 - i] ?? null;
  }

  /** vanilla PerlinNoise.getValue(x, y, z, yScale, yFudge) */
  getValue(x: number, y: number, z: number, yScale: number, yFudge: number): number {
    let value = 0;
    let factor = this.lowestFreqInputFactor;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      const noise = this.levels[i];
      if (noise) {
        value += noise.noise(
          wrapPerlin(x * factor), wrapPerlin(y * factor), wrapPerlin(z * factor),
          yScale * factor, yFudge * factor,
        ) * valueFactor;
      }
      factor *= 2;
      valueFactor /= 2;
    }
    return value;
  }

  maxValue(): number { return this.maxVal; }

  maxBrokenValue(yScale: number): number { return this.edgeValue(yScale + 2); }

  private edgeValue(noiseValue: number): number {
    let value = 0;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      if (this.levels[i]) value += noiseValue * valueFactor;
      valueFactor /= 2;
    }
    return value;
  }
}

/**
 * vanilla PerlinNoise.wrap. The wrap only ever changes coordinates above 2^24; world
 * generation stays far below that for any chunk a browser client will request, so the
 * common case is a single comparison.
 */
export function wrapPerlin(x: number): number {
  if (x >= -16777216 && x <= 16777216) return x;
  return x - Math.floor(x / 3.3554432e7 + 0.5) * 3.3554432e7;
}

/**
 * Port of net.minecraft.world.level.levelgen.synth.BlendedNoise. The density function node
 * `minecraft:old_blended_noise` is a thin wrapper around this class.
 */
export class BlendedNoise {
  private readonly minLimitNoise: LegacyPerlinNoise;
  private readonly maxLimitNoise: LegacyPerlinNoise;
  private readonly mainNoise: LegacyPerlinNoise;
  private readonly xzMultiplier: number;
  private readonly yMultiplier: number;
  private readonly xzFactor: number;
  private readonly yFactor: number;
  private readonly smearScaleMultiplier: number;
  private readonly maxVal: number;

  constructor(
    random: RandomSource,
    readonly xzScale: number,
    readonly yScale: number,
    xzFactor: number,
    yFactor: number,
    smearScaleMultiplier: number,
  ) {
    this.minLimitNoise = new LegacyPerlinNoise(random, -15, 16);
    this.maxLimitNoise = new LegacyPerlinNoise(random, -15, 16);
    this.mainNoise = new LegacyPerlinNoise(random, -7, 8);
    this.xzFactor = xzFactor;
    this.yFactor = yFactor;
    this.smearScaleMultiplier = smearScaleMultiplier;
    this.xzMultiplier = 684.412 * xzScale;
    this.yMultiplier = 684.412 * yScale;
    this.maxVal = this.minLimitNoise.maxBrokenValue(this.yMultiplier);
  }

  compute(blockX: number, blockY: number, blockZ: number): number {
    const limitX = blockX * this.xzMultiplier;
    const limitY = blockY * this.yMultiplier;
    const limitZ = blockZ * this.xzMultiplier;
    const mainX = limitX / this.xzFactor;
    const mainY = limitY / this.yFactor;
    const mainZ = limitZ / this.xzFactor;
    const limitSmear = this.yMultiplier * this.smearScaleMultiplier;
    const mainSmear = limitSmear / this.yFactor;
    let blendMin = 0;
    let blendMax = 0;
    let mainNoiseValue = 0;
    let pow = 1;

    for (let i = 0; i < 8; i++) {
      const noise = this.mainNoise.getOctaveNoise(i);
      if (noise) {
        mainNoiseValue += noise.noise(
          wrapPerlin(mainX * pow), wrapPerlin(mainY * pow), wrapPerlin(mainZ * pow),
          mainSmear * pow, mainY * pow,
        ) / pow;
      }
      pow /= 2;
    }

    const factor = (mainNoiseValue / 10 + 1) / 2;
    const isMax = factor >= 1;
    const isMin = factor <= 0;
    pow = 1;

    for (let i = 0; i < 16; i++) {
      const wx = wrapPerlin(limitX * pow);
      const wy = wrapPerlin(limitY * pow);
      const wz = wrapPerlin(limitZ * pow);
      const yScalePow = limitSmear * pow;
      if (!isMax) {
        const minNoise = this.minLimitNoise.getOctaveNoise(i);
        if (minNoise) blendMin += minNoise.noise(wx, wy, wz, yScalePow, limitY * pow) / pow;
      }
      if (!isMin) {
        const maxNoise = this.maxLimitNoise.getOctaveNoise(i);
        if (maxNoise) blendMax += maxNoise.noise(wx, wy, wz, yScalePow, limitY * pow) / pow;
      }
      pow /= 2;
    }

    return clampedLerp(factor, blendMin / 512, blendMax / 512) / 128;
  }

  maxValue(): number { return this.maxVal; }
}

function clampedLerp(factor: number, min: number, max: number): number {
  if (factor < 0) return min;
  return factor > 1 ? max : min + factor * (max - min);
}
