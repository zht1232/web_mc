// Port of Complementary Reimagined r5.9.3 sky/water lighting constants.
//
// Every formula below is transcribed from the uploaded pack (shaders/lib/colors/skyColors.glsl,
// lightAndAmbientColors.glsl, lib/atmospherics/sky.glsl and program/gbuffers_water.glsl) - the
// constants are NOT re-derived. The pack is evaluated with its shipped defaults:
//   SHADER_STYLE 1 -> WATER_STYLE 1, RAIN_PUDDLES 0, WATER_REFLECT_QUALITY 2, DETAIL_QUALITY 2
//   RAIN_STYLE 1, SUN_MOON_DURING_RAIN, SPECIAL_BIOME_WEATHER with inSnowy = inDry = 0
// That means: no water normal map (flat mirror normal), no stars/aurora/clouds in reflections
// (SKY_EFFECT_REFLECTION_TRANSLUCENT is only defined at DETAIL_QUALITY >= 3), and the rain
// colour multipliers for RAIN_STYLE 2 / biome weather stay zero.

import type { SkyState } from '../../EnvironmentLighting.js';

type Vec3 = [number, number, number];

const SKY_GLSL_UNIFORMS = `
uniform vec3 uSkyDayUp;
uniform vec3 uSkyDayMid;
uniform vec3 uSkyDayDown;
uniform vec3 uSkyNightUp;
uniform vec3 uSkyNightMid;
uniform vec3 uSkyNightDown;
uniform vec3 uSkySunsetDownP;
uniform vec3 uHighlightColor;
uniform vec3 uSunWorldDir;
uniform float uSunFactor;
uniform float uSunVisibility;
uniform float uNightFactor;
uniform float uNightFactorSqrt2;
uniform float uNightFactorM;
uniform float uNoonFactor;
uniform float uRainFactor;
uniform float uRainFactor2;
uniform float uInvRainFactor;
uniform float uShadowTime;
`;

/**
 * lib/atmospherics/sky.glsl GetSky() plus the small float helpers it relies on. Shared verbatim
 * by the sky pass and the water reflection so a reflected sky matches the one behind the water.
 */
export const COMPLEMENT_SKY_GLSL = `
${SKY_GLSL_UNIFORMS}
float skyPow2(float x) { return x * x; }
vec2 skyPow2(vec2 x) { return x * x; }
vec3 skyPow2(vec3 x) { return x * x; }
float skyPow3(float x) { return x * x * x; }
float skySqrt1(float x) { return x * (2.0 - x); }
vec3 skySqrt1(vec3 x) { return x * (2.0 - x); }
float skySqrt2(float x) { x = 1.0 - x; x *= x; x *= x; return 1.0 - x; }
float skySqrt3(float x) { x = 1.0 - x; x *= x; x *= x; x *= x; return 1.0 - x; }
float skySmoothstep1(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }

vec3 complementSky(vec3 dir, float dither, bool doGlare, bool doGround) {
  float VdotU = dir.y;
  float VdotS = dot(dir, uSunWorldDir);
  float nightFactorSqrt2 = uNightFactorSqrt2;
  float nightFactorM = uNightFactorM;
  float VdotSM1 = skyPow2(max(VdotS, 0.0));
  float VdotSM2 = skyPow2(VdotSM1);
  float VdotSM3 = skyPow2(skyPow2(max(-VdotS, 0.0)));
  float VdotSML = uSunVisibility > 0.5 ? VdotS : -VdotS;

  float VdotUmax0 = max(VdotU, 0.0);
  float VdotUmax0M = 1.0 - skyPow2(VdotUmax0);

  vec3 upColor = mix(uSkyNightUp * (1.5 - 0.5 * nightFactorSqrt2 + nightFactorM * VdotSM3 * 1.5),
                     uSkyDayUp, uSunFactor);
  vec3 middleColor = mix(uSkyNightMid * (3.0 - 2.0 * nightFactorSqrt2),
                         uSkyDayMid * (1.0 + VdotSM2 * 0.3), uSunFactor);
  vec3 downColor = mix(uSkyNightDown, uSkyDayDown, (uSunFactor + uSunVisibility) * 0.5);

  float VdotUM1 = skyPow2(1.0 - VdotUmax0);
  VdotUM1 = pow(VdotUM1, (1.0 - VdotSM2 * 0.4) * (1.15 - 0.15 * uRainFactor2));
  VdotUM1 = mix(VdotUM1, 1.0, uRainFactor2 * 0.15);
  vec3 finalSky = mix(upColor, middleColor, VdotUM1);

  float VdotUM2 = skyPow2(1.0 - abs(VdotU));
  VdotUM2 = VdotUM2 * VdotUM2 * (3.0 - 2.0 * VdotUM2);
  VdotUM2 *= (0.7 - nightFactorM + VdotSM1 * (0.3 + nightFactorM))
    * (1.0 - uNoonFactor) * uSunFactor;
  finalSky = mix(finalSky, uSkySunsetDownP * (1.0 + VdotSM1 * 0.3),
                 VdotUM2 * uInvRainFactor);

  float VdotUM3 = min(max(VdotU * -1.0 + 0.08, 0.0) / 0.35, 1.0);
  VdotUM3 = skySmoothstep1(VdotUM3);
  vec3 scatteredGroundMixer = vec3(VdotUM3 * VdotUM3, skySqrt1(VdotUM3), skySqrt3(VdotUM3));
  scatteredGroundMixer = mix(vec3(VdotUM3), scatteredGroundMixer, 0.75 - 0.5 * uRainFactor);
  finalSky = mix(finalSky, downColor, scatteredGroundMixer);

  if (doGround)
    finalSky *= skySmoothstep1(skyPow2(1.0 + min(VdotU, 0.0)));

  if (doGlare && 0.0 < VdotSML) {
    float glareScatter = 3.0 * (2.0 - clamp(VdotS * 1000.0, 0.0, 1.0));
    float VdotSM4 = pow(abs(VdotS), glareScatter);

    float visfactor = 0.075;
    float glare = visfactor / (1.0 - (1.0 - visfactor) * VdotSM4) - visfactor;
    glare *= 0.7;

    vec3 glareColor = mix(vec3(0.38, 0.4, 0.5) * 0.3,
                          vec3(1.5, 0.7, 0.3) + vec3(0.0, 0.5, 0.5) * uNoonFactor,
                          uSunVisibility);
    glare *= 1.0 - 0.8 * uRainFactor;

    finalSky += glareColor * glare * uShadowTime;
  }

  finalSky = max(finalSky + (dither - 0.5) / 128.0, vec3(0.0));
  return finalSky;
}
`;

/** Jessie's Bayer64 from lib/util/dither.glsl (used for glare-free reflection dithering). */
export const BAYER_GLSL = `
float bayer2(vec2 c) { c = 0.5 * floor(c); return fract(1.5 * fract(c.y) + c.x); }
float bayer4(vec2 c) { return 0.25 * bayer2(0.5 * c) + bayer2(c); }
float bayer8(vec2 c) { return 0.25 * bayer4(0.5 * c) + bayer2(c); }
float bayer16(vec2 c) { return 0.25 * bayer8(0.5 * c) + bayer2(c); }
float bayer32(vec2 c) { return 0.25 * bayer16(0.5 * c) + bayer2(c); }
float bayer64(vec2 c) { return 0.25 * bayer32(0.5 * c) + bayer2(c); }
`;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const pow3 = (a: Vec3, e: number): Vec3 => [a[0] ** e, a[1] ** e, a[2] ** e];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const max3 = (a: Vec3, b: Vec3): Vec3 => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
const sqrt2f = (x: number) => { const y = 1 - x; return 1 - y * y * y * y; };

export interface ComplementSkyUniforms {
  uSkyDayUp: Vec3;
  uSkyDayMid: Vec3;
  uSkyDayDown: Vec3;
  uSkyNightUp: Vec3;
  uSkyNightMid: Vec3;
  uSkyNightDown: Vec3;
  uSkySunsetDownP: Vec3;
  uHighlightColor: Vec3;
  uSunWorldDir: Vec3;
  uSunFactor: number;
  uSunVisibility: number;
  uNightFactor: number;
  uNightFactorSqrt2: number;
  uNightFactorM: number;
  uNoonFactor: number;
  uRainFactor: number;
  uRainFactor2: number;
  uInvRainFactor: number;
  uShadowTime: number;
}

/**
 * skyColors.glsl + lightAndAmbientColors.glsl evaluated for one frame. The sun angle drives
 * sunFactor/sunVisibility exactly like gbuffers_water.glsl:52-62 (SdotU is the sun's elevation).
 */
export function complementSkyUniforms(sky: SkyState, rainLevel: number): ComplementSkyUniforms {
  const sunAngleRad = (sky.sunAngleDeg * Math.PI) / 180;
  const SdotU = Math.cos(sunAngleRad); // GetSunVector().y for the overworld timeline
  const sunFactor = SdotU < 0
    ? clamp(SdotU + 0.375, 0, 0.75) / 0.75
    : clamp(SdotU + 0.03125, 0, 0.0625) / 0.0625;
  const sunVisibility = clamp(SdotU + 0.0625, 0, 0.125) / 0.125;
  const sunVisibility2 = sunVisibility * sunVisibility;
  const shadowTimeVar1 = Math.abs(sunVisibility - 0.5) * 2;
  const shadowTimeVar2 = shadowTimeVar1 * shadowTimeVar1;
  const shadowTime = shadowTimeVar2 * shadowTimeVar2;

  const noonFactor = Math.sqrt(Math.max(SdotU, 0));
  const invNoonFactor = 1 - noonFactor;
  const invNoonFactor2 = invNoonFactor * invNoonFactor;
  const nightFactor = Math.max(-SdotU, 0);
  const nightFactorSqrt2 = sqrt2f(nightFactor);
  const nightFactorM = sqrt2f(nightFactorSqrt2) * 0.4;
  const rainFactor = clamp(rainLevel, 0, 1);
  const rainFactor2 = rainFactor * rainFactor;
  const invRainFactor = 1 - rainFactor;
  const vsBrightness = clamp(sky.brightness, 0, 1);

  const skyColor = sky.skyColor as Vec3;
  const skyColorSqrt = pow3(skyColor, 0.5);
  const invRainStrength2 = (1 - rainFactor) * (1 - rainFactor);
  const skyColorM = mix3(max3(skyColorSqrt, [0.63, 0.67, 0.73]), skyColorSqrt, invRainStrength2);
  const skyColorM2 = mix3(max3(skyColor, scale3([0.265, 0.295, 0.35], sunFactor)), skyColor, invRainStrength2);

  const nuscWeatherM: Vec3 = [0.1, 0, 0.1];
  const nmscWeatherM: Vec3 = [
    -0.1, -0.4 + 0.06 * noonFactor, -0.6 + 0.12 * noonFactor,
  ];
  const ndscWeatherM: Vec3 = [
    -0.15, -0.3 + 0.02 * noonFactor, -0.42 + 0.08 * noonFactor,
  ];

  const noonUp = mul3(pow3(skyColorM, 2.9), add3([0.85, 0.92, 0.81], scale3(nuscWeatherM, rainFactor)));
  const noonMiddle = add3(
    mul3(skyColorM, add3([1.4, 1.3, 1.3], scale3(nmscWeatherM, rainFactor))),
    scale3(noonUp, 0.25),
  );
  const noonDown = add3(
    mul3(skyColorM, add3([0.9, 0.9, 0.9], scale3(ndscWeatherM, rainFactor))),
    scale3(noonUp, 0.25),
  );

  const sunsetUp = mul3(skyColorM2, add3([0.72, 0.522, 0.47], scale3([0.1, 0.2, 0.35], rainFactor2)));
  const sunsetMiddle = mul3(skyColorM2, add3([1.8, 1.3, 1.2], scale3([0.15, 0.25, -0.05], rainFactor2)));
  const sunsetDownP: Vec3 = [
    1.45 - 0.8 * rainFactor,
    0.86 - 0.3 * rainFactor,
    0.5,
  ];
  const sunsetDown = add3(scale3(sunsetDownP, 0.5), scale3(sunsetMiddle, 0.25));

  const dayUp = mix3(noonUp, sunsetUp, invNoonFactor2);
  const dayMiddle = mix3(noonMiddle, sunsetMiddle, invNoonFactor2);
  const dayDown = mix3(noonDown, sunsetDown, invNoonFactor2);

  const nightColFactor = add3(scale3([0.07, 0.14, 0.24], 0.9 * (1 - 0.5 * rainFactor)), skyColor);
  const nightUp = scale3(pow3(nightColFactor, 0.9), 0.45);
  const nightMiddle = scale3(pow3(nightUp, 0.5), 0.65);
  const nightDown = mul3(nightMiddle, [0.82, 0.82, 0.88]);

  // lightAndAmbientColors.glsl (OVERWORLD, non-COMPOSITE1) -> lightColor -> highlightColor
  const noonClearLight: Vec3 = scale3([0.65, 0.55, 0.375], 2.05);
  const noonClearAmbient = scale3(pow3(skyColor, 0.75), 0.85);
  const sunsetClearLight = scale3(pow3([0.64, 0.45, 0.3], 1.5 + invNoonFactor), 5);
  const nightClearLight = scale3([0.15, 0.14, 0.2], 0.9 * (0.4 + vsBrightness * 0.4));
  const dayRainLight = add3(scale3([0.21, 0.16, 0.13], 0.85), scale3([0, 0.02, 0.06], noonFactor));
  const nightRainLight = scale3([0.03, 0.035, 0.05], 0.5 + 0.5 * vsBrightness);
  const dayLight = mix3(sunsetClearLight, noonClearLight, noonFactor);
  const clearLight = mix3(nightClearLight, dayLight, sunVisibility2);
  const rainLight = scale3(mix3(nightRainLight, dayRainLight, sunVisibility2), 2.5);
  const lightColor = mix3(clearLight, rainLight, rainFactor);
  // mainLighting.glsl: highlightColor = normalize(pow(lightColor, 0.37)) * ...
  const lightPow = pow3(lightColor, 0.37);
  const lightLen = Math.hypot(lightPow[0], lightPow[1], lightPow[2]) || 1;
  const highlightColor = scale3(
    [lightPow[0] / lightLen, lightPow[1] / lightLen, lightPow[2] / lightLen],
    (0.3 + 1.5 * sunVisibility2) * (1 - 0.85 * rainFactor),
  );

  // Sun position from the timeline angle, same convention as LevelRenderer.updateSunLight.
  const sunDir: Vec3 = [-Math.sin(sunAngleRad), Math.cos(sunAngleRad), 0];

  return {
    uSkyDayUp: dayUp,
    uSkyDayMid: dayMiddle,
    uSkyDayDown: dayDown,
    uSkyNightUp: nightUp,
    uSkyNightMid: nightMiddle,
    uSkyNightDown: nightDown,
    uSkySunsetDownP: sunsetDownP,
    uHighlightColor: highlightColor,
    uSunWorldDir: sunDir,
    uSunFactor: sunFactor,
    uSunVisibility: sunVisibility,
    uNightFactor: nightFactor,
    uNightFactorSqrt2: nightFactorSqrt2,
    uNightFactorM: nightFactorM,
    uNoonFactor: noonFactor,
    uRainFactor: rainFactor,
    uRainFactor2: rainFactor2,
    uInvRainFactor: invRainFactor,
    uShadowTime: shadowTime,
  };
}

/** Minimal GlProgram surface the sky uniforms need (avoids importing the GL class here). */
export interface SkyUniformTarget {
  set3f(name: string, x: number, y: number, z: number): void;
  set1f(name: string, x: number): void;
}

export function setComplementSkyUniforms(target: SkyUniformTarget, u: ComplementSkyUniforms): void {
  target.set3f('uSkyDayUp', ...u.uSkyDayUp);
  target.set3f('uSkyDayMid', ...u.uSkyDayMid);
  target.set3f('uSkyDayDown', ...u.uSkyDayDown);
  target.set3f('uSkyNightUp', ...u.uSkyNightUp);
  target.set3f('uSkyNightMid', ...u.uSkyNightMid);
  target.set3f('uSkyNightDown', ...u.uSkyNightDown);
  target.set3f('uSkySunsetDownP', ...u.uSkySunsetDownP);
  target.set3f('uHighlightColor', ...u.uHighlightColor);
  target.set3f('uSunWorldDir', ...u.uSunWorldDir);
  target.set1f('uSunFactor', u.uSunFactor);
  target.set1f('uSunVisibility', u.uSunVisibility);
  target.set1f('uNightFactor', u.uNightFactor);
  target.set1f('uNightFactorSqrt2', u.uNightFactorSqrt2);
  target.set1f('uNightFactorM', u.uNightFactorM);
  target.set1f('uNoonFactor', u.uNoonFactor);
  target.set1f('uRainFactor', u.uRainFactor);
  target.set1f('uRainFactor2', u.uRainFactor2);
  target.set1f('uInvRainFactor', u.uInvRainFactor);
  target.set1f('uShadowTime', u.uShadowTime);
}
