// Port of net.minecraft.world.timeline.Timelines + Lightmap / LightmapRenderStateExtractor.
//
// 26.2 drives sky colour, fog, star brightness and the lightmap through timed
// attribute tracks instead of hard coded day/night branches. The keyframes below
// are copied verbatim from Timelines.OVERWORLD_DAY so the lighting matches the
// original client instead of "looking about right".

type Rgb = [number, number, number];

interface Keyframe<T> { tick: number; value: T }
interface Track<T> { frames: Keyframe<T>[] }

/** Vanilla FloatModifier / ColorModifier semantics used by the day timeline. */
const enum Modifier { SET, MULTIPLY, MULTIPLY_RGB, MULTIPLY_ARGB, MAXIMUM, ALPHA_BLEND }

interface ModifierTrack<T> extends Track<T> { modifier: Modifier; base: T }

function argb(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24 | (r & 255) << 16 | (g & 255) << 8 | (b & 255)) >>> 0;
}

/** Vanilla ARGB.colorFromFloat(alpha, red, green, blue), input 0..1. Mind the argument order. */
function colorFromFloat(a: number, r: number, g: number, b: number): number {
  return argb(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255));
}

function rgbOf(color: number): Rgb {
  const c = color >>> 0;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpColor(a: number, b: number, t: number): number {
  const ca = rgbOf(a), cb = rgbOf(b);
  return argb(
    Math.round(lerp(ca[0], cb[0], t) * 255),
    Math.round(lerp(ca[1], cb[1], t) * 255),
    Math.round(lerp(ca[2], cb[2], t) * 255),
  );
}

/** Vanilla color constants from Timelines. */
const NIGHT_SKY_LIGHT_COLOR = colorFromFloat(1.0, 0.48, 0.48, 1.0);
const NIGHT_FOG_COLOR_MULTIPLIER_START = colorFromFloat(1.0, 0.05, 0.05, 0.09);
const NIGHT_FOG_COLOR_MULTIPLIER_END = colorFromFloat(1.0, 0.09, 0.09, 0.09);
const NIGHT_CLOUD_COLOR_MULTIPLIER = colorFromFloat(1.0, 0.1, 0.1, 0.15);

const SUNRISE_SUNSET: Track<number> = {
  frames: [
    [71, 1609540403], [310, 703969843], [565, 117167155], [730, 16770355],
    [11270, 16770355], [11397, 83679283], [11522, 268028723], [11690, 703969843],
    [11929, 1609540403], [12243, -1310226637], [12358, -857440717], [12512, -371166669],
    [12613, -153261261], [12732, -19242189], [12841, -19440589], [13035, -321760973],
    [13252, -1043577037], [13775, 918435635], [13888, 532362547], [14039, 163001139],
    [14192, 11744051], [21807, 11678515], [21961, 163001139], [22112, 532362547],
    [22225, 918435635], [22748, -1043577037], [22965, -321760973], [23159, -19440589],
    [23272, -19242189], [23488, -371166669], [23642, -857440717], [23757, -1310226637],
  ].map(([tick, value]) => ({ tick, value: value >>> 0 })),
};

const STAR_BRIGHTNESS: ModifierTrack<number> = {
  modifier: Modifier.MAXIMUM,
  base: 0,
  frames: [
    [92, 0.037], [627, 0], [11373, 0], [11732, 0.016], [11959, 0.044], [12399, 0.143],
    [12729, 0.258], [13228, 0.5], [22772, 0.5], [23032, 0.364], [23356, 0.225], [23758, 0.101],
  ].map(([tick, value]) => ({ tick, value })),
};

const SKY_LIGHT_FACTOR: ModifierTrack<number> = {
  modifier: Modifier.MULTIPLY,
  base: 1,
  frames: [[730, 1], [11270, 1], [13140, 0.24], [22860, 0.24]].map(([tick, value]) => ({ tick, value })),
};

const SKY_LIGHT_LEVEL: ModifierTrack<number> = {
  modifier: Modifier.MULTIPLY,
  base: 15,
  frames: [[133, 1], [11867, 1], [13670, 0.26666668], [22330, 0.26666668]].map(([tick, value]) => ({ tick, value })),
};

const SKY_LIGHT_COLOR: ModifierTrack<number> = {
  modifier: Modifier.MULTIPLY_RGB,
  base: 0xffffffff,
  frames: [
    [730, 0xffffffff], [11270, 0xffffffff], [13140, NIGHT_SKY_LIGHT_COLOR], [22860, NIGHT_SKY_LIGHT_COLOR],
  ].map(([tick, value]) => ({ tick, value: value >>> 0 })),
};

const SKY_COLOR: ModifierTrack<number> = {
  modifier: Modifier.MULTIPLY_RGB,
  base: 0xffffffff,
  frames: [[133, 0xffffffff], [11867, 0xffffffff], [13670, 0xff000000], [22330, 0xff000000]]
    .map(([tick, value]) => ({ tick, value: value >>> 0 })),
};

const FOG_COLOR: ModifierTrack<number> = {
  modifier: Modifier.MULTIPLY_RGB,
  base: 0xffffffff,
  frames: [
    [133, 0xffffffff], [11867, 0xffffffff], [13670, NIGHT_FOG_COLOR_MULTIPLIER_START], [22330, NIGHT_FOG_COLOR_MULTIPLIER_END],
  ].map(([tick, value]) => ({ tick, value: value >>> 0 })),
};

const CLOUD_COLOR: ModifierTrack<number> = {
  modifier: Modifier.MULTIPLY_ARGB,
  base: 0xffffffff,
  frames: [[133, 0xffffffff], [11867, 0xffffffff], [13670, NIGHT_CLOUD_COLOR_MULTIPLIER], [22330, NIGHT_CLOUD_COLOR_MULTIPLIER]]
    .map(([tick, value]) => ({ tick, value: value >>> 0 })),
};

/** Evaluates a track with linear interpolation, wrapping at the period. */
function sample<T>(track: Track<T>, tick: number, period: number, mix: (a: T, b: T, t: number) => T): T {
  const frames = track.frames;
  if (!frames.length) throw new Error('empty track');
  const t = ((tick % period) + period) % period;
  if (t <= frames[0].tick) return frames[frames.length - 1].value; // wrapped tail
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t >= a.tick && t < b.tick) {
      const f = (t - a.tick) / (b.tick - a.tick);
      return mix(a.value, b.value, f);
    }
  }
  const last = frames[frames.length - 1];
  const first = frames[0];
  const f = (t - last.tick) / ((period - last.tick) + first.tick);
  return mix(last.value, first.value, f);
}

function sampleNumber(track: Track<number>, tick: number, period: number): number {
  return sample(track, tick, period, (a, b, f) => lerp(a, b, f));
}

function sampleColor(track: Track<number>, tick: number, period: number): number {
  return sample(track, tick, period, (a, b, f) => lerpColor(a, b, f));
}

export interface SkyState {
  /** 0..15 sky light level used for the lightmap */
  skyLightLevel: number;
  skyFactor: number;
  skyLightColor: Rgb;
  blockFactor: number;
  blockLightTint: Rgb;
  ambientColor: Rgb;
  /** base sky colour before the day modifier */
  skyColor: Rgb;
  fogColor: Rgb;
  cloudColor: Rgb;
  sunriseColor: Rgb;
  starBrightness: number;
  sunAngleDeg: number;
  moonAngleDeg: number;
  /** gamma (brightness option), 0 by default */
  brightness: number;
}

export const DAY_PERIOD = 24000;

/**
 * Vanilla EnvironmentAttributes defaults for the overworld:
 * SKY_LIGHT_COLOR 0xFFFFFFFF, BLOCK_LIGHT_TINT 0xFFFFD8CC-ish, AMBIENT_LIGHT_COLOR 0xFF000000.
 */
export const DEFAULT_SKY: SkyState = {
  skyLightLevel: 15,
  skyFactor: 1,
  skyLightColor: [1, 1, 1],
  blockFactor: 1.4,
  blockLightTint: rgbOf(0xffff8c00 >>> 0),
  ambientColor: [0, 0, 0],
  skyColor: [0.47, 0.65, 1],
  fogColor: [0.75, 0.85, 1],
  cloudColor: [1, 1, 1],
  sunriseColor: [1, 1, 1],
  starBrightness: 0,
  sunAngleDeg: 0,
  moonAngleDeg: 0,
  brightness: 0,
};

/** BLOCK_LIGHT_TINT default -10100 (signed ARGB) */
const BLOCK_LIGHT_TINT_DEFAULT = 0xffff8c6c;
const SKY_COLOR_DAY = 0xff78a7ff;
const FOG_COLOR_DAY = 0xffc0d8ff;
const CLOUD_COLOR_DAY = 0xffffffff;

/** Evaluates the overworld day timeline. Mirrors Timelines.OVERWORLD_DAY. */
export function computeSkyState(worldTime: number, brightnessOption = 0): SkyState {
  const t = ((worldTime % DAY_PERIOD) + DAY_PERIOD) % DAY_PERIOD;

  const skyFactorMul = sampleNumber(SKY_LIGHT_FACTOR, t, DAY_PERIOD);
  const skyLevelMul = sampleNumber(SKY_LIGHT_LEVEL, t, DAY_PERIOD);
  const skyLightColor = rgbOf(sampleColor(SKY_LIGHT_COLOR, t, DAY_PERIOD));
  const skyMod = rgbOf(sampleColor(SKY_COLOR, t, DAY_PERIOD));
  const fogMod = rgbOf(sampleColor(FOG_COLOR, t, DAY_PERIOD));
  const cloudMod = rgbOf(sampleColor(CLOUD_COLOR, t, DAY_PERIOD));
  const sunrise = rgbOf(sampleColor(SUNRISE_SUNSET, t, DAY_PERIOD));
  const star = sampleNumber(STAR_BRIGHTNESS, t, DAY_PERIOD);

  const skyBase = rgbOf(SKY_COLOR_DAY);
  const fogBase = rgbOf(FOG_COLOR_DAY);
  const cloudBase = rgbOf(CLOUD_COLOR_DAY);

  // SUN_ANGLE: 0 at sunrise, 360 at noon (vanilla keyframes 6000 -> 0..360 over a day)
  const sunAngleDeg = (t / DAY_PERIOD) * 360 + 90;

  return {
    skyLightLevel: 15 * skyLevelMul,
    skyFactor: 1 * skyFactorMul,
    skyLightColor,
    blockFactor: 1.4,
    blockLightTint: rgbOf(BLOCK_LIGHT_TINT_DEFAULT),
    ambientColor: [0, 0, 0],
    skyColor: [skyBase[0] * skyMod[0], skyBase[1] * skyMod[1], skyBase[2] * skyMod[2]],
    fogColor: [fogBase[0] * fogMod[0], fogBase[1] * fogMod[1], fogBase[2] * fogMod[2]],
    cloudColor: [cloudBase[0] * cloudMod[0], cloudBase[1] * cloudMod[1], cloudBase[2] * cloudMod[2]],
    sunriseColor: sunrise,
    starBrightness: star,
    sunAngleDeg,
    moonAngleDeg: sunAngleDeg + 180,
    brightness: brightnessOption,
  };
}

/**
 * Builds the 16x16 RGBA lightmap exactly like core/lightmap.fsh.
 * x axis = block light, y axis = sky light, both indexed by level 0..15.
 */
export function buildLightmap(state: SkyState, out = new Uint8Array(16 * 16 * 4)): Uint8Array {
  const brightnessCurve = (level: number) => level / (4 - 3 * level);
  const blockFactor = state.blockFactor;
  const skyFactor = state.skyFactor;

  // Vanilla samples at texCoord = (level + 0.5) / 16 and floors back to the level,
  // so we can evaluate the formula per integer level directly.
  for (let sky = 0; sky < 16; sky++) {
    const skyLevel = sky / 15;
    const skyBrightness = brightnessCurve(skyLevel) * skyFactor;
    for (let block = 0; block < 16; block++) {
      const blockLevel = block / 15;
      const blockBrightness = brightnessCurve(blockLevel) * blockFactor;
      const parabolic = (2 * blockLevel - 1) * (2 * blockLevel - 1);
      const mixT = 0.9 * parabolic;

      const blockColor = [
        state.blockLightTint[0] * (1 - mixT) + 1 * mixT,
        state.blockLightTint[1] * (1 - mixT) + 1 * mixT,
        state.blockLightTint[2] * (1 - mixT) + 1 * mixT,
      ];

      let r = state.ambientColor[0] + state.skyLightColor[0] * skyBrightness + blockColor[0] * blockBrightness;
      let g = state.ambientColor[1] + state.skyLightColor[1] * skyBrightness + blockColor[1] * blockBrightness;
      let b = state.ambientColor[2] + state.skyLightColor[2] * skyBrightness + blockColor[2] * blockBrightness;

      r = Math.min(1, Math.max(0, r));
      g = Math.min(1, Math.max(0, g));
      b = Math.min(1, Math.max(0, b));

      // notGamma + mix by brightness (gamma slider)
      const applyGamma = (c: number) => {
        const maxComponent = Math.max(c, 1e-5);
        const maxInverted = 1 - maxComponent;
        const maxScaled = 1 - maxInverted ** 4;
        const notGamma = c * (maxScaled / maxComponent);
        return Math.min(1, Math.max(0, c + (notGamma - c) * state.brightness));
      };

      const i = (sky * 16 + block) * 4;
      out[i] = Math.round(applyGamma(r) * 255);
      out[i + 1] = Math.round(applyGamma(g) * 255);
      out[i + 2] = Math.round(applyGamma(b) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
