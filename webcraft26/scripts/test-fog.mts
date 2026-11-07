// Verification for src/client/renderer/environment/FogState.ts (Minecraft 26.2 fog port).
// Run: npx tsx scripts/test-fog.mts
//
// Every expected value below is hand-computed from the vanilla Java/GLSL sources
// (the arithmetic is quoted in the assertion comments). Nothing is compared
// against a second call of the implementation itself.
//
// Coverage: fog.glsl distance helpers, atmospheric day/night/rain/thunder,
// sunrise-sunset sun-facing mix, render-distance span clamps, water (waterVision,
// non-local camera), lava (normal/spectator/fire resistance), powder snow,
// blindness (duration ramp / infinite), darkness effect, night vision brighten,
// darkenWorldAmount, void darkness, boss overlay world fog, cloud range, custom
// fog attributes and the rain fog easing.
//
// Prints PASS/FAIL per check and a final summary; exits non-zero on any failure.

import assert from 'node:assert/strict';

import {
  argbFromRgb,
  computeFog,
  computeFogColor,
  computeRainFogMultiplier,
  computeRainFogTargetMultiplier,
  fogCylindricalDistance,
  fogSphericalDistance,
  linearFogValue,
  scaleRgb,
  srgbLerp,
  totalFogValue,
  type FogData,
} from '../src/client/renderer/environment/FogState.ts';

let passed = 0;
let failed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

function expectColor(actual: readonly number[], expected: readonly number[]): void {
  close(actual[0], expected[0]);
  close(actual[1], expected[1]);
  close(actual[2], expected[2]);
}

function expectFields(actual: FogData, expected: Partial<FogData>): void {
  for (const key of Object.keys(expected) as (keyof FogData)[]) {
    if (key === 'color') {
      expectColor(actual.color, expected.color as readonly number[]);
    } else {
      close(actual[key] as number, expected[key] as number);
    }
  }
}

/** Default day colour pipeline, hand-derived in the comments of the first test. */
const DAY_COLOR = [181 / 255, 208 / 255, 1] as const;
const DAY_FOG: Partial<FogData> = {
  environmentalStart: 0,
  environmentalEnd: 1024,
  renderDistanceStart: 172.8,
  renderDistanceEnd: 192,
  skyEnd: 192,
  cloudEnd: 2048,
};

// ---------------------------------------------------------------------------
// fog.glsl distance formulas
// ---------------------------------------------------------------------------

check('linearFogValue boundaries and interpolation (fog.glsl:13-21)', () => {
  assert.equal(linearFogValue(0, 0, 100), 0); // vertexDistance <= fogStart
  assert.equal(linearFogValue(-5, 0, 100), 0);
  assert.equal(linearFogValue(100, 0, 100), 1); // vertexDistance >= fogEnd
  assert.equal(linearFogValue(120, 0, 100), 1);
  close(linearFogValue(50, 0, 100), 0.5);
  close(linearFogValue(25, 0, 100), 0.25); // (25 - 0) / (100 - 0)
  close(linearFogValue(150, 100, 200), 0.5);
});

check('totalFogValue = max(environmental, render-distance) (fog.glsl:23-25)', () => {
  // env = (500-0)/(1000-0) = 0.5 ; rd = (10-100)/100 < 0 -> 0
  close(totalFogValue(500, 10, 0, 1000, 100, 200), 0.5);
  // env = 1 (2000 >= 1000) ; rd = (150-100)/100 = 0.5
  close(totalFogValue(2000, 150, 0, 1000, 100, 200), 1);
  // cylindrical distance decides: rd = (300-100)/100 = 2 -> clamped 1
  close(totalFogValue(50, 300, 0, 1000, 100, 200), 1);
  close(totalFogValue(0, 0, 0, 100, 100, 200), 0);
});

check('spherical / cylindrical distance (fog.glsl:32-40)', () => {
  close(fogSphericalDistance({ x: 3, y: 4, z: 0 }), 5); // 3-4-5
  close(fogCylindricalDistance({ x: 3, y: 12, z: 4 }), 12); // max(length(3,4)=5, |12|)
  close(fogSphericalDistance({ x: 3, y: 12, z: 4 }), 13); // sqrt(9+144+16)
  close(fogCylindricalDistance({ x: 0, y: -7, z: 0 }), 7); // abs(y)
  close(fogCylindricalDistance({ x: 6, y: 1, z: 8 }), 10); // length(6,8)
});

// ---------------------------------------------------------------------------
// ARGB helpers (ARGB.java / Mth.java)
// ---------------------------------------------------------------------------

check('srgbLerp uses Mth.lerpInt (floor, alpha included) (ARGB.java:153-159)', () => {
  // r: 10 + floor(0.5 * (250-10)) = 130, g: 20+floor(0.5*220)=130, b: 30+floor(0.5*200)=130
  assert.equal(srgbLerp(0.5, 0xff0a141e, 0xfffaf0e6), 0xff828282);
  // t = 0 -> p0 unchanged, t = 1 -> p1 unchanged
  assert.equal(srgbLerp(0, 0xff0a141e, 0xfffaf0e6), 0xff0a141e);
  assert.equal(srgbLerp(1, 0xff0a141e, 0xfffaf0e6), 0xfffaf0e6);
  // alpha is lerped too: floor(0.5 * (255-128)) = 63 -> 128+63 = 191 = 0xbf
  // rgb 0 -> 255: floor(127.5) = 127 = 0x7f
  assert.equal(srgbLerp(0.5, 0x80000000, 0xffffffff), 0xbf7f7f7f);
});

check('scaleRgb truncates each channel toward zero, alpha kept (ARGB.java:104-115)', () => {
  // r trunc(10*0.5)=5, g trunc(20*0.5)=10, b trunc(30*0.6)=18
  assert.equal(scaleRgb(0xff0a141e, 0.5, 0.5, 0.6), 0xff050a12);
  // 7 * 1.5 = 10.5 -> trunc 10 ; 255 * 0.5 = 127.5 -> 127 ; 1 * 0.5 = 0.5 -> 0
  assert.equal(scaleRgb(0xff07ff01, 1.5, 0.5, 0.5), 0xff0a7f00);
  assert.equal(scaleRgb(0xff102030, 0, 0, 0), 0xff000000);
});

check('argbFromRgb converts SkyState floats (dimension_type overworld values)', () => {
  // #c0d8ff = (192, 216, 255) -> floats
  assert.equal(argbFromRgb([192 / 255, 216 / 255, 1]), 0xffc0d8ff);
  assert.equal(argbFromRgb([120 / 255, 167 / 255, 1]), 0xff78a7ff);
  assert.equal(argbFromRgb([0, 0, 0], 0), 0x00000000);
});

// ---------------------------------------------------------------------------
// Atmospheric fog: day / night / render distance
// ---------------------------------------------------------------------------

check('atmospheric day default: colour mix + render distance span', () => {
  // EnvironmentAttributes defaults: FOG_COLOR #c0d8ff, SKY_COLOR #78a7ff,
  // SKY_FOG_END 512, FOG_END 1024, cloudRange 128 chunks, CLOUD_FOG_END 2048.
  // renderDistance = 12 chunks = 192 blocks.
  // skyFogEnd = min(512/16, 12) = 12 -> t = clampedLerp(12/32, 0.25, 1)
  //   = 0.25 + 0.375*0.75 = 0.53125 (AtmosphericFogEnvironment.java:44-46)
  // mix = 1 - 0.53125^0.25 = 0.1462617574
  // srgbLerp(0.1462618, #c0d8ff, #78a7ff):
  //   r = 192 + floor(0.1462618 * (120-192)) = 192 - 11 = 181
  //   g = 216 + floor(0.1462618 * (167-216)) = 216 -  8 = 208
  //   b = 255 + floor(0.1462618 * (255-255)) = 255
  // renderDistanceFogSpan = clamp(192/10, 4, 64) = 19.2 (FogRenderer.java:198-200)
  const fog = computeFog();
  expectColor(fog.color, DAY_COLOR);
  expectFields(fog, DAY_FOG);
});

check('atmospheric night (resolved night fog #0c0e16, sky #000000)', () => {
  // Same sky mix factor 0.1462618 as daytime (render distance unchanged).
  //   r = 12 + floor(0.1462618 * (0-12)) = 12 - 2 = 10
  //   g = 14 + floor(0.1462618 * (0-14)) = 14 - 3 = 11
  //   b = 22 + floor(0.1462618 * (0-22)) = 22 - 4 = 18
  const fog = computeFog({ fogColorArgb: 0xff0c0e16, skyColorArgb: 0xff000000 });
  expectColor(fog.color, [10 / 255, 11 / 255, 18 / 255]);
  expectFields(fog, DAY_FOG);
});

check('render distance 512: sky mix factor reaches 0 -> pure fog colour', () => {
  // skyFogEnd = min(512/16, 512/16 = 32) = 32 -> t = clampedLerp(1, 0.25, 1) = 1
  // mix = 1 - 1^0.25 = 0 -> srgbLerp(0, ...) = #c0d8ff
  const fog = computeFog({ renderDistanceBlocks: 512 });
  expectColor(fog.color, [192 / 255, 216 / 255, 1]);
  expectFields(fog, {
    environmentalStart: 0,
    environmentalEnd: 1024,
    renderDistanceStart: 460.8, // 512 - clamp(512/10 = 51.2)
    renderDistanceEnd: 512,
    skyEnd: 512, // min(512 blocks, SKY_FOG_END 512)
    cloudEnd: 2048,
  });
});

check('render distance 48 (3 chunks): sunrise mix skipped, sky factor clamps to 0.25', () => {
  // 3 chunks < 4 -> AtmosphericFogEnvironment.java:28 skips the sun mix.
  // skyFogEnd = min(32, 3) = 3 -> t = clampedLerp(3/32, 0.25, 1) = 0.25+0.09375*0.75
  //   = 0.3203125 ; mix = 1 - 0.3203125^0.25 = 0.2476958254
  //   r = 192 + floor(0.2476958 * -72) = 192 - 18 = 174
  //   g = 216 + floor(0.2476958 * -49) = 216 - 13 = 203
  // span = clamp(48/10, 4, 64) = 4.8 -> renderDistanceStart = 43.2
  const fog = computeFog({
    renderDistanceBlocks: 48,
    sunriseSunsetColorArgb: 0x40c8a050, // would tint the colour if applied
    sunAngleDeg: -90,
    cameraForward: { x: 1, y: 0, z: 0 },
  });
  expectColor(fog.color, [174 / 255, 203 / 255, 1]);
  expectFields(fog, {
    renderDistanceStart: 43.2,
    renderDistanceEnd: 48,
    skyEnd: 48,
  });
});

check('render distance 1280: span clamps to 64 (upper bound)', () => {
  const fog = computeFog({ renderDistanceBlocks: 1280 });
  close(fog.renderDistanceStart, 1280 - 64); // clamp(128, 4, 64) = 64
  close(fog.renderDistanceEnd, 1280);
});

check('render distance 32: span clamps to 4 (lower bound)', () => {
  const fog = computeFog({ renderDistanceBlocks: 32 });
  close(fog.renderDistanceStart, 28); // clamp(3.2, 4, 64) = 4
  close(fog.renderDistanceEnd, 32);
});

// ---------------------------------------------------------------------------
// Atmospheric fog: sunrise / sunset sun-facing tint
// ---------------------------------------------------------------------------

check('sunrise colour mixes in only when looking at the sun', () => {
  // sunAngle -90deg -> sin = -1 -> sunX = +1 (AtmosphericFogEnvironment.java:30)
  // forward.x = +1 -> lookingAtTheSunFactor = 1
  // sunrise #40c8a050 -> alpha 64/255 = 0.2509804
  // fog = srgbLerp(0.2509804, #c0d8ff, #ffc8a050 | opaque = #ffc8a050):
  //   r = 192 + floor(0.2509804*(200-192)) = 194
  //   g = 216 + floor(0.2509804*(160-216)) = 201
  //   b = 255 + floor(0.2509804*(80-255)) = 211
  // then the usual sky mix with factor 0.1462618 and sky #78a7ff:
  //   r = 194 + floor(0.1462618*(120-194)) = 183
  //   g = 201 + floor(0.1462618*(167-201)) = 196
  //   b = 211 + floor(0.1462618*(255-211)) = 217
  const fog = computeFog({
    sunriseSunsetColorArgb: 0x40c8a050,
    sunAngleDeg: -90,
    cameraForward: { x: 1, y: 0, z: 0 },
  });
  expectColor(fog.color, [183 / 255, 196 / 255, 217 / 255]);
});

check('sunrise colour is not applied when facing away from the sun', () => {
  // sunAngle -90deg -> sunX = +1 ; forward.x = -1 -> factor -1, not > 0
  const away = computeFog({
    sunriseSunsetColorArgb: 0x40c8a050,
    sunAngleDeg: -90,
    cameraForward: { x: -1, y: 0, z: 0 },
  });
  expectColor(away.color, DAY_COLOR);
  // sunAngle +90deg -> sin = +1 -> sunX = -1 ; forward.x = +1 -> factor -1
  const behind = computeFog({
    sunriseSunsetColorArgb: 0x40c8a050,
    sunAngleDeg: 90,
    cameraForward: { x: 1, y: 0, z: 0 },
  });
  expectColor(behind.color, DAY_COLOR);
});

check('sunrise colour with alpha 0 is ignored (default attribute)', () => {
  // SUNRISE_SUNSET_COLOR default is 0 (alpha 0) -> AtmosphericFogEnvironment.java:36
  const fog = computeFog({ sunAngleDeg: -90, cameraForward: { x: 1, y: 0, z: 0 } });
  expectColor(fog.color, DAY_COLOR);
});

// ---------------------------------------------------------------------------
// Atmospheric fog: rain and thunder
// ---------------------------------------------------------------------------

check('rain steady state: sky darkening + -160/-256 offsets', () => {
  // applyWeatherDarken(sky #78a7ff, rain 1): params (0.5, 0.5, 0.6) ->
  //   r trunc(120*0.5)=60, g trunc(167*0.5)=83, b trunc(255*0.6)=153
  // srgbLerp(0.1462618, #c0d8ff, (60,83,153)):
  //   r = 192 + floor(0.1462618*(60-192))  = 192-20 = 172
  //   g = 216 + floor(0.1462618*(83-216))  = 216-20 = 196
  //   b = 255 + floor(0.1462618*(153-255)) = 255-15 = 240
  // rainFogMultiplier target = 1*clamp((15-8)/7)*1 = 1 (AtmosphericFogEnvironment.java:86-95)
  // environmentalStart = 0 + -160*1 = -160
  // environmentalEnd = max(min(96,1024), 1024-256) = 768
  const fog = computeFog({ rainLevel: 1, rainFogMultiplier: 1 });
  expectColor(fog.color, [172 / 255, 196 / 255, 240 / 255]);
  expectFields(fog, { environmentalStart: -160, environmentalEnd: 768 });
});

check('rain without carried state uses the steady-state multiplier', () => {
  // FogInput.rainFogMultiplier omitted -> target (1) used directly.
  const fog = computeFog({ rainLevel: 1 });
  expectFields(fog, { environmentalStart: -160, environmentalEnd: 768 });
  expectColor(fog.color, [172 / 255, 196 / 255, 240 / 255]);
});

check('rain fog easing: previous 0, deltaTicks 1 -> 0.2', () => {
  // next = 0 + (1-0)*1*0.2 = 0.2 (AtmosphericFogEnvironment.java:94)
  // start = -160*0.2 = -32 ; end = max(96, 1024-256*0.2 = 972.8) = 972.8
  close(computeRainFogMultiplier({ rainLevel: 1, rainFogMultiplier: 0, deltaTicks: 1 }), 0.2);
  const fog = computeFog({ rainLevel: 1, rainFogMultiplier: 0, deltaTicks: 1 });
  expectFields(fog, { environmentalStart: -32, environmentalEnd: 972.8 });
});

check('rain fog easing: previous 0.4, deltaTicks 0.5 -> 0.46', () => {
  // 0.4 + (1-0.4)*0.5*0.2 = 0.46
  close(computeRainFogMultiplier({ rainLevel: 1, rainFogMultiplier: 0.4, deltaTicks: 0.5 }), 0.46);
  close(computeRainFogTargetMultiplier({ rainLevel: 1, skyLightLevel: 15 }), 1);
});

check('rain fog needs sky light > 8 (cave / night sky)', () => {
  // skyLightFactor = clamp((8-8)/7, 0, 1) = 0 -> target 0.
  close(computeRainFogTargetMultiplier({ rainLevel: 1, skyLightLevel: 8 }), 0);
  // carried multiplier 1 eases towards 0: 1 + (0-1)*1*0.2 = 0.8
  // start = -160*0.8 = -128 ; end = max(96, 1024-256*0.8 = 819.2) = 819.2
  const eased = computeFog({ rainLevel: 1, skyLightLevel: 8, rainFogMultiplier: 1 });
  expectFields(eased, { environmentalStart: -128, environmentalEnd: 819.2 });
  // without carried state the steady-state target is used -> no rain offsets
  const steady = computeFog({ rainLevel: 1, skyLightLevel: 8 });
  expectFields(steady, { environmentalStart: 0, environmentalEnd: 1024 });
  // skyLight 11.5 -> clamp(3.5/7) = 0.5 ; rain 0.5 ; biome false -> *0.5 => 0.125
  close(
    computeRainFogTargetMultiplier({ rainLevel: 0.5, skyLightLevel: 11.5, biomeHasPrecipitation: false }),
    0.125,
  );
});

check('rain in a dry biome halves the fog multiplier', () => {
  // biome.hasPrecipitation() = false -> target = 1*1*0.5 = 0.5
  // start = -160*0.5 = -80 ; end = max(96, 1024-128) = 896
  const fog = computeFog({ rainLevel: 1, biomeHasPrecipitation: false });
  expectFields(fog, { environmentalStart: -80, environmentalEnd: 896 });
  expectColor(fog.color, [172 / 255, 196 / 255, 240 / 255]); // weather darkening still applies
});

check('thunder darkens the sky colour by 50%', () => {
  // scaleRgb(#78a7ff, 0.5) = (60, 83, 127)
  // r = 192 + floor(0.1462618*(60-192))  = 172
  // g = 216 + floor(0.1462618*(83-216))  = 196
  // b = 255 + floor(0.1462618*(127-255)) = 236
  const fog = computeFog({ thunderLevel: 1 });
  expectColor(fog.color, [172 / 255, 196 / 255, 236 / 255]);
  expectFields(fog, DAY_FOG); // thunder does not move fog distances by itself
});

check('rain + thunder darkening composes sequentially in integers', () => {
  // rain 0.5: (0.75, 0.75, 0.8) -> (90, 125, 204)
  // thunder 0.5: (0.75) -> (67, 93, 153)
  // srgbLerp(0.1462618, #c0d8ff, (67,93,153)):
  //   r = 192 + floor(-18.2828) = 173
  //   g = 216 + floor(-17.9902) = 198
  //   b = 255 + floor(-14.9187) = 240
  const fog = computeFog({ rainLevel: 0.5, thunderLevel: 0.5, rainFogMultiplier: 0.5 });
  expectColor(fog.color, [173 / 255, 198 / 255, 240 / 255]);
  expectFields(fog, { environmentalStart: -80, environmentalEnd: 896 });
});

// ---------------------------------------------------------------------------
// Water fog (WaterFogEnvironment.java:14-35)
// ---------------------------------------------------------------------------

check('water: base colour, start/end, waterVision floor of 0.25', () => {
  // WATER_FOG_COLOR default #050533, WATER_FOG_START -8, WATER_FOG_END 96.
  // waterVision 0 -> end = 96 * max(0.25, 0) = 24 ; skyEnd = cloudEnd = 24.
  // brightenFactor = waterVision = 0 -> colour unscaled.
  const fog = computeFog({ fogType: 'water' });
  expectColor(fog.color, [5 / 255, 5 / 255, 51 / 255]);
  expectFields(fog, { environmentalStart: -8, environmentalEnd: 24, skyEnd: 24, cloudEnd: 24 });
});

check('water with waterVision 1: end 96, brighten rescales colour', () => {
  // brightenFactor 1: max channel = 0.2 -> scale 1/0.2 = 5
  //   r = g = 5/255 * 5 = 25/255 ; b = 0.2 * 5 = 1
  const fog = computeFog({ fogType: 'water', waterVision: 1 });
  expectColor(fog.color, [25 / 255, 25 / 255, 1]);
  expectFields(fog, { environmentalStart: -8, environmentalEnd: 96, skyEnd: 96, cloudEnd: 96 });
});

check('water with waterVision 0.4: end 38.4, partial brighten', () => {
  // end = 96*0.4 = 38.4
  // r = lerp(0.4, 5/255, 5/255*5) = 0.0196078 + 0.4*0.0784314 = 0.0509804
  // b = lerp(0.4, 0.2, 1.0) = 0.52
  const fog = computeFog({ fogType: 'water', waterVision: 0.4 });
  expectColor(fog.color, [13 / 255, 13 / 255, 0.52]);
  expectFields(fog, { environmentalEnd: 38.4, skyEnd: 38.4, cloudEnd: 38.4 });
});

check('water with a non-local camera ignores waterVision (brightenFactor 1)', () => {
  // FogRenderer.java:148-152 -> brightenFactor = 1 ; WaterFogEnvironment.java:19-21
  // only scales by waterVision for a LocalPlayer.
  const fog = computeFog({ fogType: 'water', isLocalPlayer: false });
  expectColor(fog.color, [25 / 255, 25 / 255, 1]);
  expectFields(fog, { environmentalEnd: 96 });
});

check('night vision does not replace the water brighten path', () => {
  // FogRenderer.java:147-158 branches on WATER first.
  const fog = computeFog({ fogType: 'water', hasNightVision: true });
  expectColor(fog.color, [5 / 255, 5 / 255, 51 / 255]);
  expectFields(fog, { environmentalEnd: 24 });
});

// ---------------------------------------------------------------------------
// Lava fog (LavaFogEnvironment.java:13-36)
// ---------------------------------------------------------------------------

check('lava: colour 0xff991900 and 0.25/1 distances', () => {
  // COLOR = -6743808 = 0xff991900 -> (153, 25, 0)
  const fog = computeFog({ fogType: 'lava' });
  expectColor(fog.color, [153 / 255, 25 / 255, 0]);
  expectFields(fog, { environmentalStart: 0.25, environmentalEnd: 1, skyEnd: 1, cloudEnd: 1 });
});

check('lava spectator: -8 / renderDistance*0.5', () => {
  const fog = computeFog({ fogType: 'lava', isSpectator: true });
  expectFields(fog, { environmentalStart: -8, environmentalEnd: 96, skyEnd: 96, cloudEnd: 96 });
});

check('lava with fire resistance: 0 / 5', () => {
  const fog = computeFog({ fogType: 'lava', fireResistance: true });
  expectFields(fog, { environmentalStart: 0, environmentalEnd: 5, skyEnd: 5, cloudEnd: 5 });
});

check('lava + blindness effect keeps lava colour and lava distances', () => {
  // Colour source = Lava, first applicable shape = Lava (order FogRenderer.java:36-45).
  // Darkness is NOT multiplied in for LAVA (FogRenderer.java:133).
  const fog = computeFog({ fogType: 'lava', blindnessDurationTicks: 40 });
  expectColor(fog.color, [153 / 255, 25 / 255, 0]);
  expectFields(fog, { environmentalStart: 0.25, environmentalEnd: 1 });
});

// ---------------------------------------------------------------------------
// Powder snow fog (PowderedSnowFogEnvironment.java:11-31)
// ---------------------------------------------------------------------------

check('powder snow: colour 0xff9fbbcc and 0/2 distances', () => {
  // COLOR = -6308916 = 0xff9fbbcc -> (159, 187, 204)
  const fog = computeFog({ fogType: 'powder_snow' });
  expectColor(fog.color, [159 / 255, 187 / 255, 204 / 255]);
  expectFields(fog, { environmentalStart: 0, environmentalEnd: 2, skyEnd: 2, cloudEnd: 2 });
});

check('powder snow spectator: -8 / renderDistance*0.5', () => {
  const fog = computeFog({ fogType: 'powder_snow', isSpectator: true });
  expectFields(fog, { environmentalStart: -8, environmentalEnd: 96, skyEnd: 96, cloudEnd: 96 });
});

// ---------------------------------------------------------------------------
// Blindness fog (BlindnessFogEnvironment.java:20-46)
// ---------------------------------------------------------------------------

check('blindness duration 5: distance lerp(0.25) and endsWithin(19) darkness', () => {
  // distance = lerp(min(1,5/20)=0.25, 192, 5) = 192 + 0.25*(5-192) = 145.25
  // start = 36.3125, sky/cloud = 116.2
  // darkness = max(5/20, void 0) = 0.25 -> brightness (0.75)^2 = 0.5625
  // day colour (181,208,255) * 0.5625 = (101.8125, 117, 143.4375)
  const fog = computeFog({ blindnessDurationTicks: 5 });
  expectColor(fog.color, [101.8125 / 255, 117 / 255, 143.4375 / 255]);
  expectFields(fog, {
    environmentalStart: 36.3125,
    environmentalEnd: 145.25,
    skyEnd: 116.2,
    cloudEnd: 116.2,
  });
});

check('blindness duration 19: still endsWithin(19) -> darkness 0.95', () => {
  // distance = lerp(0.95, 192, 5) = 14.35 ; start 3.5875 ; sky/cloud 11.48
  // brightness = (1-0.95)^2 = 0.0025 -> (181,208,255)*0.0025
  const fog = computeFog({ blindnessDurationTicks: 19 });
  expectColor(fog.color, [0.4525 / 255, 0.52 / 255, 0.6375 / 255]);
  expectFields(fog, {
    environmentalStart: 3.5875,
    environmentalEnd: 14.35,
    skyEnd: 11.48,
    cloudEnd: 11.48,
  });
});

check('blindness duration 20: no longer ending soon -> darkness 1, black fog', () => {
  // distance = lerp(1, 192, 5) = 5 ; start 1.25 ; sky/cloud 4 ; brightness 0
  const fog = computeFog({ blindnessDurationTicks: 20 });
  expectColor(fog.color, [0, 0, 0]);
  expectFields(fog, { environmentalStart: 1.25, environmentalEnd: 5, skyEnd: 4, cloudEnd: 4 });
});

check('blindness infinite duration: distance fixed at 5', () => {
  // BlindnessFogEnvironment.java:25 isInfiniteDuration() -> 5
  const infinite = computeFog({ blindnessDurationTicks: -1 });
  expectColor(infinite.color, [0, 0, 0]);
  expectFields(infinite, { environmentalStart: 1.25, environmentalEnd: 5, skyEnd: 4, cloudEnd: 4 });
  const infinity = computeFog({ blindnessDurationTicks: Number.POSITIVE_INFINITY });
  expectFields(infinity, { environmentalStart: 1.25, environmentalEnd: 5 });
});

check('underwater + blindness: water colour source, blindness fog shape', () => {
  // Colour source = Water (first providing colour), shape = Blindness (order).
  // duration 40 -> darkness 1 -> water colour * 0 = black.
  const fog = computeFog({ fogType: 'water', blindnessDurationTicks: 40 });
  expectColor(fog.color, [0, 0, 0]);
  expectFields(fog, { environmentalStart: 1.25, environmentalEnd: 5, skyEnd: 4, cloudEnd: 4 });
});

check('blindness fog overrides render distance fog (distance < renderDistance)', () => {
  const fog = computeFog({ blindnessDurationTicks: 40, renderDistanceBlocks: 64 });
  close(fog.environmentalEnd, 5); // lerp(1, 64, 5) = 5
  close(fog.renderDistanceEnd, 64);
});

// ---------------------------------------------------------------------------
// Darkness effect fog (DarknessFogEnvironment.java:20-38)
// ---------------------------------------------------------------------------

check('darkness blend 0.5: distance lerp(0.5, rd, 15) and darkness 0.5', () => {
  // distance = lerp(0.5, 192, 15) = 192 + 0.5*(15-192) = 103.5
  // start 77.625, sky/cloud 103.5
  // darkness = max(blend 0.5, void 0) = 0.5 -> brightness 0.25
  // day colour (181,208,255) * 0.25 = (45.25, 52, 63.75)
  const fog = computeFog({ hasDarknessEffect: true, darknessBlendFactor: 0.5 });
  expectColor(fog.color, [45.25 / 255, 52 / 255, 63.75 / 255]);
  expectFields(fog, {
    environmentalStart: 77.625,
    environmentalEnd: 103.5,
    skyEnd: 103.5,
    cloudEnd: 103.5,
  });
});

check('darkness blend 0: effect present, distances at render distance, no darkening', () => {
  // distance = lerp(0, 192, 15) = 192 ; start 144 ; sky/cloud 192
  // darkness = max(0, 0) = 0 -> colour unchanged
  const fog = computeFog({ hasDarknessEffect: true, darknessBlendFactor: 0 });
  expectColor(fog.color, DAY_COLOR);
  expectFields(fog, { environmentalStart: 144, environmentalEnd: 192, skyEnd: 192, cloudEnd: 192 });
});

check('darkness blend 1: distance 15, black fog', () => {
  // distance = lerp(1, 192, 15) = 15 ; start 11.25 ; darkness 1 -> brightness 0
  const fog = computeFog({ hasDarknessEffect: true, darknessBlendFactor: 1 });
  expectColor(fog.color, [0, 0, 0]);
  expectFields(fog, { environmentalStart: 11.25, environmentalEnd: 15, skyEnd: 15, cloudEnd: 15 });
});

// ---------------------------------------------------------------------------
// Night vision brighten (FogRenderer.java:146-171, GameRenderer.java:369-372)
// ---------------------------------------------------------------------------

check('night vision infinite: rescales a dark fog colour to white', () => {
  // fog #202020 stays #202020 after the sky mix (both endpoints equal).
  // brightenFactor = 1 ; max channel = 32/255 = 0.12549 -> scale = 1/0.12549 = 7.96875
  // every channel hits 1.
  expectColor(computeFogColor({ fogColorArgb: 0xff202020, skyColorArgb: 0xff202020, hasNightVision: true }), [1, 1, 1]);
});

check('night vision expiring (150 ticks): factor 0.7 + sin(30*pi)*0.3 = 0.7', () => {
  // GameRenderer.java:371 -> 0.7 + sin(150*0.2*pi)*0.3 = 0.7
  // r = lerp(0.7, 32/255, 1) = 32/255 + 0.7*(1 - 32/255) = 0.7376470588
  const color = computeFogColor({
    fogColorArgb: 0xff202020,
    skyColorArgb: 0xff202020,
    hasNightVision: true,
    nightVisionDurationTicks: 150,
  });
  const expected = 32 / 255 + 0.7 * (1 - 32 / 255);
  expectColor(color, [expected, expected, expected]);
});

check('night vision is ignored while the darkness effect is active', () => {
  // FogRenderer.java:154-155 requires !hasEffect(DARKNESS).
  const color = computeFogColor({
    fogColorArgb: 0xff202020,
    skyColorArgb: 0xff202020,
    hasNightVision: true,
    hasDarknessEffect: true,
    darknessBlendFactor: 0,
  });
  expectColor(color, [32 / 255, 32 / 255, 32 / 255]);
});

// ---------------------------------------------------------------------------
// darkenWorldAmount (FogRenderer.java:140-144)
// ---------------------------------------------------------------------------

check('darkenWorldAmount 0.5 scales fog colour by 0.85 / 0.8 / 0.8', () => {
  // r = lerp(0.5, r, 0.7r) = 0.85r ; g = lerp(0.5, g, 0.6g) = 0.8g ; b = 0.8b
  // day colour (181,208,255): (153.85, 166.4, 204) / 255
  expectColor(computeFogColor({ darkenWorldAmount: 0.5 }), [153.85 / 255, 166.4 / 255, 0.8]);
});

// ---------------------------------------------------------------------------
// Void darkness (FogRenderer.java:123-138)
// ---------------------------------------------------------------------------

check('void darkness at camera y = -48: (32 + -64 + 48)/32 = 0.5', () => {
  // brightness = 0.5^2 = 0.25 -> day colour * 0.25
  expectColor(
    computeFogColor({ cameraPosition: { x: 0, y: -48, z: 0 } }),
    [45.25 / 255, 52 / 255, 63.75 / 255],
  );
});

check('void darkness at camera y = -32: zero, colour unchanged', () => {
  // (32 - 64 + 32)/32 = 0
  expectColor(computeFogColor({ cameraPosition: { x: 0, y: -32, z: 0 } }), DAY_COLOR);
});

check('void darkness at camera y = -80 clamps to 1 -> black fog', () => {
  // (32 - 64 + 80)/32 = 1.5 -> clamp 1 -> brightness 0
  expectColor(computeFogColor({ cameraPosition: { x: 0, y: -80, z: 0 } }), [0, 0, 0]);
});

check('void darkness does not darken lava or powder snow colours', () => {
  // FogRenderer.java:133 skips LAVA / POWDER_SNOW.
  expectColor(
    computeFogColor({ fogType: 'lava', cameraPosition: { x: 0, y: -80, z: 0 } }),
    [153 / 255, 25 / 255, 0],
  );
  expectColor(
    computeFogColor({ fogType: 'powder_snow', cameraPosition: { x: 0, y: -80, z: 0 } }),
    [159 / 255, 187 / 255, 204 / 255],
  );
});

check('blindness darkness is max(effect darkness, void darkness)', () => {
  // void darkness 0.5 beats the 0.25 blindness darkness (BlindnessFogEnvironment.java:39)
  // brightness = (1-0.5)^2 = 0.25 -> day colour * 0.25
  const fog = computeFog({ cameraPosition: { x: 0, y: -48, z: 0 }, blindnessDurationTicks: 5 });
  expectColor(fog.color, [45.25 / 255, 52 / 255, 63.75 / 255]);
  expectFields(fog, { environmentalStart: 36.3125, environmentalEnd: 145.25 });
});

// ---------------------------------------------------------------------------
// Boss overlay world fog (AtmosphericFogEnvironment.java:78-83)
// ---------------------------------------------------------------------------

check('boss overlay world fog clamps atmospheric fog to 10 / 96', () => {
  // start = min(0, 10) = 0 ; end = min(1024, 96) = 96 ; skyEnd = cloudEnd = 96
  const fog = computeFog({ bossOverlayWorldFog: true });
  expectFields(fog, { environmentalStart: 0, environmentalEnd: 96, skyEnd: 96, cloudEnd: 96 });
});

check('boss overlay with rain keeps the smaller start', () => {
  // start = min(-160, 10) = -160 ; end = min(768, 96) = 96
  const fog = computeFog({ bossOverlayWorldFog: true, rainLevel: 1 });
  expectFields(fog, { environmentalStart: -160, environmentalEnd: 96, skyEnd: 96, cloudEnd: 96 });
});

// ---------------------------------------------------------------------------
// Cloud range and custom environment attributes
// ---------------------------------------------------------------------------

check('cloud range option caps cloudEnd (Options.java:192-198)', () => {
  // cloudEnd = min(cloudRange*16, CLOUD_FOG_END 2048)
  const fog = computeFog({ cloudRangeChunks: 10 });
  close(fog.cloudEnd, 160);
  close(fog.skyEnd, 192); // unaffected: min(renderDistance 192, SKY_FOG_END 512)
  const fog512 = computeFog({ renderDistanceBlocks: 512, cloudRangeChunks: 10 });
  close(fog512.cloudEnd, 160);
  close(fog512.skyEnd, 512);
});

check('custom FOG_START / FOG_END attributes drive environmental distances', () => {
  const fog = computeFog({ fogStartDistance: 20, fogEndDistance: 200 });
  expectFields(fog, { environmentalStart: 20, environmentalEnd: 200 });
});

check('custom FOG_END below minRainFogEnd is floored at 96 with rain', () => {
  // end = max(min(96, 200), 200 - 256*0.4) ; multiplier eased 0.5 -> 0.4
  //   = max(96, 97.6) = 97.6
  const fog = computeFog({ fogStartDistance: 20, fogEndDistance: 200, rainFogMultiplier: 0.5 });
  expectFields(fog, { environmentalStart: -44, environmentalEnd: 97.6 });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`PASS: ${passed}   FAIL: ${failed}   TOTAL: ${passed + failed}`);
if (failed > 0) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS');
