// Port of net.minecraft.world.level.levelgen.synth.{ImprovedNoise, PerlinNoise, NormalNoise}.
// These reproduce vanilla terrain: every octave is a 256 entry gradient permutation
// seeded from the world seed through the md5 positional factory.

import { smoothstep, smoothstepDerivative, lfloor as floor, lerp2, lerp3 } from '../../../../core/Mth.js';
import type { RandomSource } from '../../../../core/Random.js';
import type { XoroshiroRandomSource } from '../../../../core/Random.js';

/** SimplexNoise.GRADIENT (flattened; see BlendedNoise.ts) */
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

/** Port of ImprovedNoise: classic Perlin with the vanilla permutation table. */
export class ImprovedNoise {
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

  private perm(x: number): number { return this.p[x & 0xff]; }

  noise(px: number, py: number, pz: number): number {
    const x = px + this.xo;
    const y = py + this.yo;
    const z = pz + this.zo;
    const xf = floor(x);
    const yf = floor(y);
    const zf = floor(z);
    const xr = x - xf;
    const yr = y - yf;
    const zr = z - zf;
    return this.sampleAndLerp(xf, yf, zf, xr, yr, zr);
  }

  private sampleAndLerp(x: number, y: number, z: number, xr: number, yr: number, zr: number): number {
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
      smoothstep(xr), smoothstep(yr), smoothstep(zr),
      d000, d100, d010, d110, d001, d101, d011, d111,
    );
  }

  /** Vanilla uses this for the surface rule noise. */
  noiseWithDerivative(px: number, py: number, pz: number, out: number[]): number {
    const x = px + this.xo;
    const y = py + this.yo;
    const z = pz + this.zo;
    const xf = floor(x), yf = floor(y), zf = floor(z);
    const xr = x - xf, yr = y - yf, zr = z - zf;
    const x0 = this.perm(xf);
    const x1 = this.perm(xf + 1);
    const xy00 = this.perm(x0 + yf);
    const xy01 = this.perm(x0 + yf + 1);
    const xy10 = this.perm(x1 + yf);
    const xy11 = this.perm(x1 + yf + 1);
    const p000 = this.perm(xy00 + zf);
    const p100 = this.perm(xy10 + zf);
    const p010 = this.perm(xy01 + zf);
    const p110 = this.perm(xy11 + zf);
    const p001 = this.perm(xy00 + zf + 1);
    const p101 = this.perm(xy10 + zf + 1);
    const p011 = this.perm(xy01 + zf + 1);
    const p111 = this.perm(xy11 + zf + 1);
    const dot = (h: number, dx: number, dy: number, dz: number) => gradDot(h, dx, dy, dz);
    const d000 = dot(p000, xr, yr, zr);
    const d100 = dot(p100, xr - 1, yr, zr);
    const d010 = dot(p010, xr, yr - 1, zr);
    const d110 = dot(p110, xr - 1, yr - 1, zr);
    const d001 = dot(p001, xr, yr, zr - 1);
    const d101 = dot(p101, xr - 1, yr, zr - 1);
    const d011 = dot(p011, xr, yr - 1, zr - 1);
    const d111 = dot(p111, xr - 1, yr - 1, zr - 1);
    const xa = smoothstep(xr), ya = smoothstep(yr), za = smoothstep(zr);
    const g000 = (p000 & 15) * 3, g100 = (p100 & 15) * 3;
    const g010 = (p010 & 15) * 3, g110 = (p110 & 15) * 3;
    const g001 = (p001 & 15) * 3, g101 = (p101 & 15) * 3;
    const g011 = (p011 & 15) * 3, g111 = (p111 & 15) * 3;
    const d1x = lerp3(xa, ya, za, GRADIENT[g000], GRADIENT[g100], GRADIENT[g010], GRADIENT[g110], GRADIENT[g001], GRADIENT[g101], GRADIENT[g011], GRADIENT[g111]);
    const d1y = lerp3(xa, ya, za, GRADIENT[g000 + 1], GRADIENT[g100 + 1], GRADIENT[g010 + 1], GRADIENT[g110 + 1], GRADIENT[g001 + 1], GRADIENT[g101 + 1], GRADIENT[g011 + 1], GRADIENT[g111 + 1]);
    const d1z = lerp3(xa, ya, za, GRADIENT[g000 + 2], GRADIENT[g100 + 2], GRADIENT[g010 + 2], GRADIENT[g110 + 2], GRADIENT[g001 + 2], GRADIENT[g101 + 2], GRADIENT[g011 + 2], GRADIENT[g111 + 2]);
    const d2x = lerp2(ya, za, d100 - d000, d110 - d010, d101 - d001, d111 - d011);
    const d2y = lerp2(za, xa, d010 - d000, d011 - d001, d110 - d100, d111 - d101);
    const d2z = lerp2(xa, ya, d001 - d000, d101 - d100, d011 - d010, d111 - d110);
    const xsd = smoothstepDerivative(xr);
    const ysd = smoothstepDerivative(yr);
    const zsd = smoothstepDerivative(zr);
    out[0] = d1x + xsd * d2x;
    out[1] = d1y + ysd * d2y;
    out[2] = d1z + zsd * d2z;
    return lerp3(xa, ya, za, d000, d100, d010, d110, d001, d101, d011, d111);
  }

  maxValue(): number { return 1; }
}

/**
 * Port of PerlinNoise. 26.2 world generation only uses the "new" initialization
 * path, where every octave gets its own permutation seeded through the positional
 * md5 factory ("octave_<n>").
 */
export class PerlinNoise {
  private readonly levels: (ImprovedNoise | null)[] = [];
  private readonly amplitudes: number[];
  readonly firstOctave: number;
  private readonly lowestFreqInputFactor: number;
  private readonly lowestFreqValueFactor: number;
  private readonly maxVal: number;

  constructor(random: RandomSource, firstOctave: number, amplitudes: number[]) {
    this.firstOctave = firstOctave;
    this.amplitudes = amplitudes;
    const octaveCount = amplitudes.length;
    const zeroOctaveIndex = -firstOctave;
    const positional = (random as XoroshiroRandomSource).forkPositional();
    this.levels = new Array(octaveCount).fill(null);
    for (let i = 0; i < octaveCount; i++) {
      if (amplitudes[i] !== 0) {
        this.levels[i] = new ImprovedNoise(positional.fromHashOf(`octave_${firstOctave + i}`));
      }
    }
    this.lowestFreqInputFactor = Math.pow(2, -zeroOctaveIndex);
    this.lowestFreqValueFactor = Math.pow(2, octaveCount - 1) / (Math.pow(2, octaveCount) - 1);
    this.maxVal = this.edgeValue(2);
  }

  static create(random: RandomSource, firstOctave: number, amplitudes: number[]): PerlinNoise {
    return new PerlinNoise(random, firstOctave, amplitudes);
  }

  /** vanilla PerlinNoise.getValue */
  getValue(x: number, y: number, z: number): number {
    let value = 0;
    let factor = this.lowestFreqInputFactor;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      const noise = this.levels[i];
      if (noise) {
        value += this.amplitudes[i] * noise.noise(wrapPerlin(x * factor), wrapPerlin(y * factor), wrapPerlin(z * factor)) * valueFactor;
      }
      factor *= 2;
      valueFactor /= 2;
    }
    return value;
  }

  private edgeValue(noiseValue: number): number {
    let value = 0;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      if (this.levels[i]) value += this.amplitudes[i] * noiseValue * valueFactor;
      valueFactor /= 2;
    }
    return value;
  }

  maxValue(): number { return this.maxVal; }
}

/** vanilla PerlinNoise.wrap keeps coordinates inside the float precision window. */
export function wrapPerlin(x: number): number {
  return x - Math.floor(x / 33554432 + 0.5) * 33554432;
}

/** Port of NormalNoise: two perlin fields sampled at slightly different scales. */
export class NormalNoise {
  private static readonly INPUT_FACTOR = 1.0181268882175227;
  private readonly valueFactor: number;
  private readonly first: PerlinNoise;
  private readonly second: PerlinNoise;
  private readonly maxVal: number;

  constructor(random: RandomSource, firstOctave: number, amplitudes: number[]) {
    this.first = PerlinNoise.create(random, firstOctave, amplitudes);
    this.second = PerlinNoise.create(random, firstOctave, amplitudes);

    let minOctave = Infinity;
    let maxOctave = -Infinity;
    for (let i = 0; i < amplitudes.length; i++) {
      if (amplitudes[i] !== 0) {
        minOctave = Math.min(minOctave, i);
        maxOctave = Math.max(maxOctave, i);
      }
    }
    const span = maxOctave - minOctave;
    this.valueFactor = 0.16666666666666666 / expectedDeviation(span);
    this.maxVal = (this.first.maxValue() + this.second.maxValue()) * this.valueFactor;
  }

  getValue(x: number, y: number, z: number): number {
    const f = NormalNoise.INPUT_FACTOR;
    return (this.first.getValue(x, y, z) + this.second.getValue(x * f, y * f, z * f)) * this.valueFactor;
  }

  maxValue(): number { return this.maxVal; }
}

function expectedDeviation(octaveSpan: number): number {
  return 0.1 * (1 + 1 / (octaveSpan + 1));
}
