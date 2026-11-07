// Node test for src/client/EnvironmentLighting.ts (sky timeline + lightmap).
//
//   cd G:\web_mc\webcraft26 && npx tsx scripts/test-lighting.mts
//
// Expected values are hand-derived from the decompiled sources, not from the
// implementation:
//   * sky/fog/cloud/star/angle values: Timelines.java + KeyframeTrackSampler.java
//   * lightmap bytes: vanilla/assets/minecraft/shaders/core/lightmap.fsh
//   * weather modulation: net/minecraft/world/attribute/WeatherAttributes.java
//   * gameplay sky light: net/minecraft/world/level/Level.java:738-740 (skyDarken)
//
// The lightmap is a 16x16 RGBA texture: x = block light, y = sky light, and the
// terrain shader samples texel (block, sky) at ((level + 0.5) / 16), so
// lightmapByte(state, sky, block) is what the GPU receives for that pair.

import assert from 'node:assert/strict';
import {
  buildLightmap, computeSkyState, colorFromFloat, multiply, srgbLerp,
  DAY_PERIOD, DEFAULT_SKY, effectiveSkyBrightness, isBrightOutside,
} from '../src/client/EnvironmentLighting.ts';

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}: ${(error as Error).message}`);
    failures++;
  }
}
let failures = 0;

const DAY = 6000;
const NOON = 6000;
const MIDNIGHT = 18000;
const byte = (state: ReturnType<typeof computeSkyState>, sky: number, block: number): [number, number, number] => {
  const lm = buildLightmap(state);
  const i = (sky * 16 + block) * 4;
  return [lm[i], lm[i + 1], lm[i + 2]];
};
const approx = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);
const approxRgb = (actual: number[], expected: number[], eps = 1 / 255 + 1e-9) => {
  assert.equal(actual.length, 3);
  for (let i = 0; i < 3; i++) approx(actual[i], expected[i], eps);
};

// ---------------------------------------------------------------------------
// Timelines.OVERWORLD_DAY values (Timelines.java:44-160)
// ---------------------------------------------------------------------------

test('day (t=6000): sky #78a7ff, fog #c0d8ff, full sky light', () => {
  const s = computeSkyState(NOON);
  approxRgb(s.skyColor, [0x78 / 255, 0xa7 / 255, 0xff / 255]);
  approxRgb(s.fogColor, [0xc0 / 255, 0xd8 / 255, 0xff / 255]);
  approxRgb(s.skyLightColor, [1, 1, 1]);
  approx(s.skyFactor, 1);
  approx(s.skyLightLevel, 15);
  assert.equal(s.skyDarken, 0);
  approx(s.starBrightness, 0);
  approx(s.sunAngleDeg, 0); // noon: sun at the zenith
  approx(s.moonAngleDeg, 180); // moon at the nadir
});

test('night (t=18000): sky black, fog deep blue grey, factor 0.24, level 4', () => {
  const s = computeSkyState(MIDNIGHT);
  approxRgb(s.skyColor, [0, 0, 0]);
  // sampler at 18000: half way between #0c0c16 (13670) and #161616 (22330) -> #111116,
  // then ARGB.multiply(#c0d8ff, #111116) = (12, 14, 22)
  assert.deepEqual(s.fogColor.map((v) => Math.round(v * 255)), [12, 14, 22]);
  approxRgb(s.skyLightColor, [0x7a / 255, 0x7a / 255, 1]);
  approx(s.skyFactor, 0.24);
  approx(s.skyLightLevel, 4.0000002, 1e-6);
  // Java float: (int)(15.0F - 15.0F * 0.26666668F) = (int)10.9999998 = 10
  assert.equal(s.skyDarken, 10);
  approx(s.starBrightness, 0.5);
  approx(s.sunAngleDeg, 180); // sun at the nadir
  approx(s.moonAngleDeg, 360); // moon at the zenith (360 == 0)
  // no red bias: the fog is a deep blue grey
  assert.ok(s.fogColor[2] > s.fogColor[0] && s.fogColor[0] <= 0.05, 'night fog must be blue-grey');
});

test('dawn wrap segment (t=0): sky/fog are still interpolating towards day', () => {
  // The sampler's leading wrap segment runs from (22330, night) to (133, day), so
  // at t=0 the sky modifier is ~0.93 white rather than the night multiplier.
  const s = computeSkyState(0);
  for (let i = 0; i < 3; i++) assert.ok(s.skyColor[i] > 0.35 && s.skyColor[i] < 0.95, `sky[${i}]=${s.skyColor[i]}`);
  approx(s.skyFactor, 0.703, 1e-3); // 0.24 + eased(0.61) * (1 - 0.24)
  assert.ok(s.skyLightLevel > 14 && s.skyLightLevel < 15, `level=${s.skyLightLevel}`);
});

test('sunset / sunrise easing (bezier): sun crosses the horizon at t~12600 / t~23400', () => {
  const before = computeSkyState(12000).sunAngleDeg;
  const after = computeSkyState(13000).sunAngleDeg;
  assert.ok(before < 90 && after > 90, `12000=${before} 13000=${after}`);
  const dusk = computeSkyState(12600).sunAngleDeg;
  assert.ok(dusk > 85 && dusk < 90, `dusk=${dusk}`);
  assert.ok(computeSkyState(12800).sunAngleDeg > 90, `12800=${computeSkyState(12800).sunAngleDeg}`);
  assert.ok(computeSkyState(23200).sunAngleDeg < 270, `23200=${computeSkyState(23200).sunAngleDeg}`);
  assert.ok(computeSkyState(23500).sunAngleDeg > 270, `23500=${computeSkyState(23500).sunAngleDeg}`);
  // the eased curve is not linear in time: at 1/4 of the arc it is only ~77 deg
  approx(before, 77.6, 0.5);
});

test('sunrise/sunset colour keeps its alpha (used as the glow strength)', () => {
  const dusk = computeSkyState(12841);
  // keyframe 12841 = 0xfed75c33 -> alpha 0xfe, red 0xd7 (215)
  assert.equal(dusk.sunriseColorArgb >>> 24, 0xfe);
  assert.equal((dusk.sunriseColorArgb >>> 16) & 255, 0xd7);
  // full daylight has alpha 0 (no glow)
  assert.equal(computeSkyState(9000).sunriseColorArgb >>> 24, 0x00);
});

test('moon phase follows the MOON timeline (period 192000)', () => {
  assert.equal(computeSkyState(0).moonPhase, 0);
  assert.equal(computeSkyState(24000 * 3 + 10).moonPhase, 3);
  assert.equal(computeSkyState(24000 * 7 + 10).moonPhase, 7);
  assert.equal(computeSkyState(24000 * 8 + 10).moonPhase, 0);
});

test('per-biome sky colour (biome attributes override the dimension)', () => {
  const desert = computeSkyState(NOON, 0, { biomeName: 'minecraft:desert' });
  approxRgb(desert.skyColor, [0x6e / 255, 0xb1 / 255, 0xff / 255]);
  const plains = computeSkyState(NOON, 0, { biomeName: 'minecraft:plains' });
  approxRgb(plains.skyColor, [0x78 / 255, 0xa7 / 255, 0xff / 255]);
});

// ---------------------------------------------------------------------------
// Lightmap: core/lightmap.fsh
// ---------------------------------------------------------------------------

test('lightmap texel orientation: x = block light, y = sky light', () => {
  const day = computeSkyState(NOON);
  // open sky, no block light -> ambient + sky
  assert.deepEqual(byte(day, 0, 0), [10, 10, 10]); // ambient #0a0a0a only
  assert.deepEqual(byte(day, 15, 0), [255, 255, 255]); // full sky
  // full block light at daytime is clamped to white
  assert.deepEqual(byte(day, 0, 15), [255, 255, 255]);
});

test('lightmap day samples match the shader formula by hand', () => {
  const day = computeSkyState(NOON);
  assert.deepEqual(byte(day, 7, 0), [56, 56, 56]);
  assert.deepEqual(byte(day, 7, 7), [120, 110, 91]);
  assert.deepEqual(byte(day, 0, 1), [16, 16, 15]);
});

test('lightmap night samples: dark blue sky light, warm block light', () => {
  const night = computeSkyState(MIDNIGHT);
  // sky level 15 -> 1 * 0.24 * skyLightColor(#7a7aff) -> (39, 39, 71)
  assert.deepEqual(byte(night, 15, 0), [39, 39, 71]);
  assert.deepEqual(byte(night, 7, 0), [15, 15, 21]);
  // block light is unaffected by the time of day (torch stays warm)
  assert.deepEqual(byte(night, 0, 7), [74, 64, 45]);
  assert.deepEqual(byte(night, 0, 0), [10, 10, 10]);
});

test('alphaBlend of sky and block light: night open-sky is dimmer than day', () => {
  const day = computeSkyState(NOON);
  const night = computeSkyState(MIDNIGHT);
  const daySum = byte(day, 15, 0).reduce((a, b) => a + b, 0);
  const nightSum = byte(night, 15, 0).reduce((a, b) => a + b, 0);
  assert.ok(nightSum < daySum * 0.2, `day=${daySum} night=${nightSum}`);
});

test('notGamma uses max(r,g,b), not the per-channel value (gamma slider)', () => {
  // With BrightnessFactor=1 the shader returns notGamma(clamp(color)).
  // night (sky=15, block=0): color = (0.15442, 0.15442, 0.27922)
  // maxComponent = 0.27922 -> scale = (1-0.72078^4)/0.27922 = 2.61479
  // notGamma = (0.40371, 0.40371, 0.73009) -> bytes (103, 103, 186)
  const night = computeSkyState(MIDNIGHT);
  night.brightness = 1;
  assert.deepEqual(byte(night, 15, 0), [103, 103, 186]);
  // the old per-channel implementation would have produced (125, 125, 186)
});

test('darkness effect subtracts from the lightmap and clamps to black', () => {
  const night = computeSkyState(MIDNIGHT);
  night.darknessScale = 0.2;
  // color (0.15442, 0.15442, 0.27922) - 0.2 -> red/green clamp to 0, blue survives
  assert.deepEqual(byte(night, 15, 0), [0, 0, 20]);
  assert.deepEqual(byte(night, 0, 0), [0, 0, 0]);
});

test('night vision replaces the ambient term with a bright tint', () => {
  const night = computeSkyState(MIDNIGHT);
  night.nightVisionIntensity = 1;
  night.nightVisionColor = [0.6, 0.6, 0.6];
  assert.deepEqual(byte(night, 0, 0), [153, 153, 153]); // 0.6 * 255
});

// ---------------------------------------------------------------------------
// WeatherAttributes.java: rain / thunder attribute layers
// ---------------------------------------------------------------------------

test('rain at noon: sky light factor -> lerp(0.3125, 1, 0.24) = 0.7625', () => {
  const s = computeSkyState(NOON, 0, { rainLevel: 1 });
  approx(s.skyFactor, 0.7625);
  approx(s.skyLightLevel, 11.5625); // lerp(0.3125, 15, 4)
  assert.equal(s.skyDarken, 3); // (int)(15 - 11.5625)
  approx(s.starBrightness, 0);
  // SKY_COLOR BLEND_TO_GRAY(0.6, 0.75): #78a7ff -> (102, 114, 136)
  assert.deepEqual(s.skyColor.map((v) => Math.round(v * 255)), [102, 114, 136]);
  // FOG_COLOR multiply #c0d8ff * #7f7f99 = (95, 107, 153)
  assert.deepEqual(s.fogColor.map((v) => Math.round(v * 255)), [95, 107, 153]);
});

test('thunder at noon: sky goes nearly black-grey', () => {
  const s = computeSkyState(NOON, 0, { thunderLevel: 1 });
  assert.deepEqual(s.skyColor.map((v) => Math.round(v * 255)), [42, 45, 51]);
  assert.deepEqual(s.fogColor.map((v) => Math.round(v * 255)), [47, 53, 76]);
  approx(s.skyFactor, lerpRef(0.52734375, 1, 0.24));
  approx(s.skyLightLevel, lerpRef(0.52734375, 15, 4));
});

test('rain at night keeps the night factor (weather target equals the night value)', () => {
  const s = computeSkyState(MIDNIGHT, 0, { rainLevel: 1 });
  approx(s.skyFactor, 0.24);
  approx(s.skyLightLevel, 4.0000002, 1e-6);
  // Java float again: (int)(15 - 4.0000002) = 10
  assert.equal(s.skyDarken, 10);
});

test('rain level scales the layer linearly', () => {
  // WeatherAttributes applies ALPHA_BLEND first: lerp(1, 0.24, 0.3125) = 0.7625,
  // then the layer is mixed in by the rain level.
  const half = computeSkyState(NOON, 0, { rainLevel: 0.5 });
  approx(half.skyFactor, 1 + 0.5 * (0.7625 - 1));
});

// helper for the hand calculation above (Mth.lerp)
function lerpRef(alpha: number, p0: number, p1: number): number { return p0 + alpha * (p1 - p0); }

// ---------------------------------------------------------------------------
// Java colour helper regression (the ARGB.colorFromFloat argument-order bug)
// ---------------------------------------------------------------------------

test('ARGB.colorFromFloat(alpha, r, g, b) keeps the argument order', () => {
  assert.equal(colorFromFloat(1.0, 0.48, 0.48, 1.0) >>> 0, 0xff7a7aff);
  assert.equal(colorFromFloat(1.0, 0.05, 0.05, 0.09) >>> 0, 0xff0c0c16);
  assert.equal(colorFromFloat(1.0, 0.09, 0.09, 0.09) >>> 0, 0xff161616);
  assert.equal(colorFromFloat(1.0, 0.1, 0.1, 0.15) >>> 0, 0xff191926);
});

test('ARGB.multiply / srgbLerp integer semantics', () => {
  assert.equal(multiply(0xffc0d8ff | 0, -1) >>> 0, 0xffc0d8ff);
  assert.equal(multiply(-1, 0xff0c0c16 | 0) >>> 0, 0xff0c0c16);
  assert.equal(multiply(0xffc0d8ff | 0, 0xff7f7f99 | 0) >>> 0, 0xff5f6b99);
  assert.equal(srgbLerp(0.5, 0xff000000 | 0, 0xffffffff | 0) >>> 0, 0xff7f7f7f);
});

test('SKY_LIGHT_LEVEL is gameplay-only: skyDarken / isBrightOutside semantics', () => {
  // Level.java:738-740 updateSkyBrightness, Level.java:384 isBrightOutside,
  // LevelReader.java:164-175 getRawBrightness = raw sky light - skyDarken.
  const noon = computeSkyState(NOON);
  assert.equal(noon.skyDarken, 0);
  assert.equal(isBrightOutside(noon), true);
  assert.equal(effectiveSkyBrightness(15, noon), 15);

  const midnight = computeSkyState(MIDNIGHT);
  assert.equal(midnight.skyDarken, 10);
  assert.equal(isBrightOutside(midnight), false);
  assert.equal(effectiveSkyBrightness(15, midnight), 5);

  // 12500 is the dusk ramp: skyLightLevel 11.14 -> skyDarken 3 -> still "bright outside"
  const dusk = computeSkyState(12500);
  assert.equal(dusk.skyDarken, 3);
  assert.equal(isBrightOutside(dusk), true);
  assert.equal(isBrightOutside(computeSkyState(13000)), false); // 8.09 -> darken 6
});

test('DEFAULT_SKY is internally consistent', () => {
  approx(DEFAULT_SKY.skyFactor, 1);
  assert.deepEqual(DEFAULT_SKY.ambientColor.map((v) => Math.round(v * 255)), [10, 10, 10]);
  assert.deepEqual(DEFAULT_SKY.blockLightTint.map((v) => Math.round(v * 255)), [255, 216, 140]);
  assert.equal(DAY_PERIOD, 24000);
});

// ---------------------------------------------------------------------------

console.log(`\nSUMMARY: ${passed} PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);
console.log('OK');
