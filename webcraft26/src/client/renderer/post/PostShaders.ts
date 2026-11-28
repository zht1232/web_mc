// GLSL for the built-in shader pipeline.
//
// The look targets Complementary Shaders - Reimagined (r5.9.3). The pack itself cannot be
// pasted into WebGL2 (it depends on Iris built-ins), so what is reproduced here are its
// algorithms and default parameters, taken from the unpacked pack under
// `_src/thirdparty/thirdparty/complementary-reimagined-r5.9.3`:
//   - bloom is a MIX at 0.12 strength, not additive
//   - tone curve is Lottes-style: contrast 1.05, hdrMax 8, mid 0.25, toe lift, white path,
//     0.25 desaturation of the shadows
//   - there is NO auto exposure in the pack; exposure is a fixed multiplier
//   - torch light uses the two-term power curve on the block light level
//   - shadows use a distorted, texel-snapped map with rotated Poisson taps

import { COMPLEMENT_SKY_GLSL } from '../environment/ComplementSky.js';

/** Full-screen triangle. Cheaper than a quad and avoids the diagonal seam. */
export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * Final composite + tonemap, ported from the pack's composite5/final stages:
 *   composite5.glsl:36-87   DoCompTonemap (Lottes 2016; TM_EXPOSURE 1.00, TM_CONTRAST 1.05,
 *                           hdrMax 8, midIn 0.25, midOut 0.25, TM_WHITE_PATH 1.00,
 *                           TM_DARK_DESATURATION 0.25 - defaults in lib/common.glsl:279-284)
 *   composite5.glsl:89-104  DoBSLColorSaturation (T_SATURATION 1.00, T_VIBRANCE 1.00)
 *   composite5.glsl:142     bloom is MIXED in at BLOOM_STRENGTH 0.12 (lib/common.glsl:146)
 *   final.glsl:155-162      brightness-aware vignette + 1/128 dither
 *
 * Colour space note: vanilla MC's render pipeline is display-referred (nothing linearises the
 * lightmap/texture product), while Complementary's colortex0 is linear because its GBuffer is
 * written in linear space. We therefore sRGB-decode the scene / bloom before the curve and
 * keep the exact composite5 LinearToRGB encode afterwards; the round trip leaves mid grey at
 * mid grey (0.25 in -> 0.257 out), so the vanilla look is preserved instead of washed out.
 */
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform sampler2D uDepth;       // scene depth (depth-difference SSAO)
uniform sampler2D uVolumetric;  // half-res light shafts (VOLUMETRIC_FRAG)
uniform sampler2D uClouds;      // half-res volumetric clouds (CLOUD_FRAG, alpha = coverage)
uniform vec2 uResolution;

uniform float uExposure;       // TM_EXPOSURE
uniform float uBloomStrength;  // BLOOM_STRENGTH
uniform float uVolumetricStrength; // 0 disables the light-shaft add
uniform float uCloudStrength;      // 0 disables the cloud composite
uniform float uTime;
uniform int uDebug;
// Depth-based SSAO: linearised depth difference against 8 screen-space neighbours.
uniform float uNear;
uniform float uFar;
uniform float uAoRadius;    // sample radius in pixels
uniform float uAoStrength;  // 0 disables

out vec4 fragColor;

// GetLuminance, lib/util/commonFunctions.glsl:21
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// LinearToRGB, composite5.glsl:31-34
vec3 linearToSrgb(vec3 c) {
  const vec3 k = vec3(0.055);
  return mix((vec3(1.0) + k) * pow(c, vec3(1.0 / 2.4)) - k, 12.92 * c, lessThan(c, vec3(0.0031308)));
}

// DoCompTonemap, composite5.glsl:36-87 - constants kept exactly as in the pack.
vec3 tonemapComplementary(vec3 color) {
  color = uExposure * color;
  float initialLuminance = dot(color, LUMA);

  vec3 a      = vec3(1.05);  // TM_CONTRAST
  vec3 d      = vec3(1.0);   // roll-off control
  vec3 hdrMax = vec3(8.0);   // maximum input brightness
  vec3 midIn  = vec3(0.25);  // input middle gray
  vec3 midOut = vec3(0.25);  // output middle gray

  vec3 a_d = a * d;
  vec3 hdrMaxA = pow(hdrMax, a);
  vec3 hdrMaxAD = pow(hdrMax, a_d);
  vec3 midInA = pow(midIn, a);
  vec3 midInAD = pow(midIn, a_d);
  vec3 HM1 = hdrMaxA * midOut;
  vec3 HM2 = hdrMaxAD - midInAD;

  vec3 b = (-midInA + HM1) / (HM2 * midOut);
  vec3 c = (hdrMaxAD * midInA - HM1 * midInAD) / (HM2 * midOut);

  vec3 colorOut = pow(color, a) / (pow(color, a_d) * b + c);

  colorOut = linearToSrgb(colorOut);

  // Remove tonemapping from darker colors for better readability (composite5.glsl:66-71).
  const float darkLiftStart = 0.1;
  const float darkLiftMix = 0.75;
  float darkLift = smoothstep(darkLiftStart, 0.0, initialLuminance);
  vec3 smoothColor = pow(color, vec3(1.0 / 2.2));
  colorOut = mix(colorOut, smoothColor, darkLift * darkLiftMix * max(0.0, 0.55 - abs(1.05 - 1.05)) / 0.55);

  // Path to White (composite5.glsl:73-78); TM_WHITE_PATH = 1.00.
  const float wpInputCurveStart = 0.0;
  const float wpInputCurveMax = 16.0;
  float modifiedLuminance = pow(initialLuminance / wpInputCurveMax, 2.0 - 1.00) * wpInputCurveMax;
  float whitePath = smoothstep(wpInputCurveStart, wpInputCurveMax, modifiedLuminance);
  colorOut = mix(colorOut, vec3(1.0), whitePath);

  // Desaturate dark colors (composite5.glsl:80-84); TM_DARK_DESATURATION = 0.25.
  const float dpInputCurveStart = 0.1;
  const float dpInputCurveMax = 0.0;
  float desaturatePath = smoothstep(dpInputCurveStart, dpInputCurveMax, initialLuminance);
  colorOut = mix(colorOut, vec3(dot(colorOut, LUMA)), desaturatePath * 0.25);

  return clamp(colorOut, 0.0, 1.0);
}

// DoBSLColorSaturation, composite5.glsl:89-104 with T_SATURATION = 1.00, T_VIBRANCE = 1.00.
vec3 bslSaturation(vec3 color) {
  float saturationFactor = 1.00 + 0.07;
  float grayVibrance = (color.r + color.g + color.b) / 3.0;
  float graySaturation = grayVibrance;
  float mn = min(color.r, min(color.g, color.b));
  float mx = max(color.r, max(color.g, color.b));
  float sat = (1.0 - (mx - mn)) * (1.0 - mx) * grayVibrance * 5.0;
  vec3 lightness = vec3((mn + mx) * 0.5);
  // T_VIBRANCE = 1.0 makes the two vibrance mixes no-ops; kept for fidelity with the source.
  color = mix(color, mix(color, lightness, 1.0 - 1.00), sat);
  color = mix(color, lightness, (1.0 - lightness) * (2.0 - 1.00) / 2.0 * abs(1.00 - 1.00));
  return color * saturationFactor - graySaturation * (saturationFactor - 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Window depth -> eye-space distance (same near/far the projection was built with).
float linearDepth(float d) {
  return uNear * uFar / (uFar - d * (uFar - uNear));
}

/**
 * Depth-difference SSAO (HANDOFF §8-2). For every screen-space neighbour that is closer to the
 * camera than the centre sample, the centre pixel is partially occluded. Cheap and robust: no
 * matrices, no sampling of reconstructed positions, so it cannot drift out of sync with the
 * projection. uAoRadius/uAoStrength are tuned per quality tier by PostProcessor.
 */
float ssaoTerm(vec2 uv, vec2 texel) {
  float d0 = texture(uDepth, uv).r;
  if (d0 >= 0.999999) return 1.0; // sky: no occlusion
  float z0 = linearDepth(d0);
  float occ = 0.0;
  const float TAU = 6.2831853;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * (TAU / 8.0);
    vec2 dir = vec2(cos(a), sin(a));
    for (int s = 1; s <= 2; s++) {
      vec2 suv = uv + dir * texel * uAoRadius * (float(s) * 0.5);
      float d1 = texture(uDepth, suv).r;
      if (d1 >= 0.999999) continue;
      float z1 = linearDepth(d1);
      float diff = z0 - z1;             // > 0: neighbour is closer to the camera
      if (diff > 0.0) {
        // Only occluders within the sampling footprint count: a screen-space radius of
        // uAoRadius pixels at distance z0 covers about z0 * 0.02 world units. Bigger depth
        // jumps are silhouettes/foreground leaks and must not darken the surface.
        float maxDiff = z0 * 0.02 + 0.05;
        occ += clamp(1.0 - diff / maxDiff, 0.0, 1.0);
      }
    }
  }
  return clamp(1.0 - (occ / 16.0) * uAoStrength, 0.0, 1.0);
}

void main() {
  vec3 color = srgbToLinear(texture(uColor, vUV).rgb);
  vec3 bloom = texture(uBloom, vUV).rgb;   // prefilter already stores linear values
  float ao = ssaoTerm(vUV, 1.0 / uResolution);
  color *= ao;

  if (uDebug == 1) { fragColor = vec4(texture(uColor, vUV).rgb, 1.0); return; }
  if (uDebug == 2) { fragColor = vec4(bloom, 1.0); return; }
  if (uDebug == 4) { fragColor = vec4(vec3(ao), 1.0); return; }
  // Light-shaft mask for the volumetric probe: x8 so the (subtle) shafts are measurable.
  if (uDebug == 5) { fragColor = vec4(clamp(texture(uVolumetric, vUV).rgb * 8.0, 0.0, 1.0), 1.0); return; }
  // Cloud coverage mask (alpha) for the volumetric-cloud probe.
  if (uDebug == 6) { fragColor = vec4(vec3(texture(uClouds, vUV).a), 1.0); return; }

  // composite5.glsl:142 - mix, never add.
  color = mix(color, bloom, uBloomStrength);

  // Volumetric clouds are alpha-composited (deferred1.glsl:404 mixes them into the sky
  // background before the tonemap). Terrain occlusion is handled inside CLOUD_FRAG.
  vec4 clouds = texture(uClouds, vUV);
  color = mix(color, clouds.rgb, clamp(clouds.a * uCloudStrength, 0.0, 1.0));

  // composite1.glsl:325 - light shafts are ADDED after the display->linear decode (the pack
  // adds them after pow(color, 2.2)), so they interact with the tonemap like sun light.
  color += texture(uVolumetric, vUV).rgb * uVolumetricStrength;

  color = tonemapComplementary(color);
  color = bslSaturation(color);

  // final.glsl:155-159 - brightness-aware vignette.
  vec2 d = vUV - 0.5;
  float vignette = 1.0 - dot(d, d) * (1.0 - dot(color, LUMA));
  color *= vignette;

  // final.glsl:161-162 - dither before the 8-bit write. The noise MUST be a
  // static function of the pixel coordinate: vanilla uses gl_FragCoord only.
  // Feeding uTime (which changes every frame) made the whole screen shimmer
  // with faint grey speckle/lines under TAA, the "global noise flicker" bug.
  float dither = hash12(floor(vUV * uResolution));
  color += vec3((dither - 0.5) / 255.0);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

/**
 * Bloom prefilter: sRGB-decode (same reason as the composite), 4-tap box downsample that
 * doubles as the first blur step, then a soft-knee threshold. The pack has no threshold
 * (composite4.glsl:31-51 blurs the whole scene), so the threshold here is deliberately low
 * and only trims the mid-tones; the 0.12 mix strength does the heavy lifting.
 */
export const BLOOM_PREFILTER_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSoftKnee;
uniform float uLinearize;   // 1 only for the first pass; later downsamples are already linear
out vec4 fragColor;

void main() {
  // 4-tap box downsample doubles as the first blur step
  vec3 c = texture(uColor, vUV + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture(uColor, vUV + uTexel * vec2( 0.5, -0.5)).rgb;
  c += texture(uColor, vUV + uTexel * vec2(-0.5,  0.5)).rgb;
  c += texture(uColor, vUV + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  // Linear working space. This used to run on every downsample level too, which raised values above 1
  // to the power 2.2 once per mip (1.5 -> 2.4 -> 5.9 -> 14 -> 33 ...) and blew the sun up into a huge blob.
  if (uLinearize > 0.5) c = pow(max(c, vec3(0.0)), vec3(2.2));

  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uSoftKnee + 1e-5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, br - uThreshold) / max(br, 1e-5);

  fragColor = vec4(c * contribution, 1.0);
}`;

/** Weighted bilinear upsample used in additive mode (ONE, ONE) to reconstruct the bloom. */
export const UPSAMPLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor;
uniform float uWeight;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(uColor, vUV).rgb * uWeight, 1.0);
}`;

/** Separable 9-tap gaussian. Run twice (horizontal, vertical) per mip. */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor;
uniform vec2 uDirection;   // texel-sized step, e.g. (1/width, 0)
out vec4 fragColor;

void main() {
  // Gaussian weights for sigma ~= 2.2
  const float w0 = 0.2270270270;
  const float w1 = 0.1945945946;
  const float w2 = 0.1216216216;
  const float w3 = 0.0540540541;
  const float w4 = 0.0162162162;

  vec3 c = texture(uColor, vUV).rgb * w0;
  c += texture(uColor, vUV + uDirection * 1.0).rgb * w1;
  c += texture(uColor, vUV - uDirection * 1.0).rgb * w1;
  c += texture(uColor, vUV + uDirection * 2.0).rgb * w2;
  c += texture(uColor, vUV - uDirection * 2.0).rgb * w2;
  c += texture(uColor, vUV + uDirection * 3.0).rgb * w3;
  c += texture(uColor, vUV - uDirection * 3.0).rgb * w3;
  c += texture(uColor, vUV + uDirection * 4.0).rgb * w4;
  c += texture(uColor, vUV - uDirection * 4.0).rgb * w4;

  fragColor = vec4(c, 1.0);
}`;

/**
 * FXAA 3.11 quality preset, trimmed to what matters for a blocky scene.
 * The voxel edges are long straight lines, so the luma-based edge search works well.
 */
export const FXAA_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor;
uniform vec2 uTexel;
out vec4 fragColor;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec3 rgbM = texture(uColor, vUV).rgb;
  vec3 rgbNW = texture(uColor, vUV + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(uColor, vUV + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(uColor, vUV + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture(uColor, vUV + vec2( 1.0,  1.0) * uTexel).rgb;

  float lM = luma(rgbM);
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

  // early out on flat areas
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { fragColor = vec4(rgbM, 1.0); return; }

  vec2 dir = vec2(
    -((lNW + lNE) - (lSW + lSE)),
     ((lNW + lSW) - (lNE + lSE))
  );
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uTexel;

  vec3 rgbA = 0.5 * (
    texture(uColor, vUV + dir * (1.0 / 3.0 - 0.5)).rgb +
    texture(uColor, vUV + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture(uColor, vUV + dir * -0.5).rgb +
    texture(uColor, vUV + dir *  0.5).rgb
  );

  float lB = luma(rgbB);
  fragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}`;

/**
 * Temporal anti-aliasing (HANDOFF §8-2). The world is rendered with a sub-pixel jittered
 * projection; this pass reprojects last frame's resolved colour through the depth buffer
 * (camera-only motion vectors, no per-object velocity) and blends it with the current frame.
 * The history is clipped to the 3x3 neighbourhood of the current frame to suppress ghosting;
 * samples that reproject outside the screen use the current frame directly (disocclusion).
 */
export const TAA_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor;     // current (jittered) HDR scene
uniform sampler2D uHistory;   // previous resolved frame
uniform sampler2D uDepth;     // depth copy (world only, pre-hand)
uniform mat4 uInvViewProj;    // current frame, jittered
uniform mat4 uPrevViewProj;   // previous frame, jittered
uniform vec2 uResolution;
uniform float uBlend;         // weight of the current frame (0.1 = 90% history)
uniform float uReset;         // 1 on the first frame after (re)allocating the history
out vec4 fragColor;

void main() {
  vec3 current = texture(uColor, vUV).rgb;

  // 3x3 neighbourhood clamp (variance clipping keeps moving edges from smearing).
  vec3 nmin = current;
  vec3 nmax = current;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture(uColor, vUV + vec2(float(x), float(y)) / uResolution).rgb;
      nmin = min(nmin, c);
      nmax = max(nmax, c);
    }
  }

  vec2 prevUV = vec2(0.5);
  float d = texture(uDepth, vUV).r;
  bool hasWorld = d < 0.999999;
  if (hasWorld) {
    vec4 clip = vec4(vUV * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 world = uInvViewProj * clip;
    world /= world.w;
    vec4 prevClip = uPrevViewProj * world;
    if (prevClip.w > 0.0) prevUV = prevClip.xy / prevClip.w * 0.5 + 0.5;
    else hasWorld = false;
  }

  bool inside = hasWorld && prevUV.x > 0.0 && prevUV.x < 1.0 && prevUV.y > 0.0 && prevUV.y < 1.0;
  float alpha = (inside && uReset < 0.5) ? uBlend : 1.0;
  vec3 history = inside ? clamp(texture(uHistory, prevUV).rgb, nmin, nmax) : current;
  fragColor = vec4(mix(history, current, alpha), 1.0);
}`;

/**
 * Depth-only pass used to build the sun shadow map (TASK-render Phase B.1). It reuses the
 * chunk VAO, so it needs the same attribute layout as TERRAIN_VERT: position (location 0),
 * texel UV (1), texture-array layer (2). UV/layer feed the alpha test so leaves and plants
 * cast cut-out shadows; water is never drawn into this pass by the caller.
 */
export const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;      // texel space * 256, same encoding as TERRAIN_VERT
layout(location = 2) in uint aLayer;
layout(location = 4) in vec4 aColor;   // alpha = wind weight (255 = static), see SectionMesher
uniform mat4 uLightViewProj;
uniform vec3 uChunkOrigin;
uniform float uSwayTime;
out vec2 vUV;
flat out uint vLayer;
void main() {
  vUV = aUV / 4096.0;
  vLayer = aLayer;
  vec3 world = aPos + uChunkOrigin;
  // Same wind formula as TERRAIN_VERT so plant/leaf shadows follow the geometry.
  float sway = 1.0 - aColor.a;
  if (uSwayTime > 0.0 && sway > 0.004) {
    float gust = sin(uSwayTime * 1.6 + world.x * 0.35 + world.z * 0.27)
      + 0.5 * sin(uSwayTime * 3.3 - world.z * 0.6 + world.x * 0.12);
    world.x += gust * 0.06 * sway;
    world.z += cos(uSwayTime * 1.25 + world.z * 0.42 + world.x * 0.1) * 0.05 * sway;
  }
  gl_Position = uLightViewProj * vec4(world, 1.0);
}`;

export const SHADOW_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
flat in uint vLayer;
uniform sampler2DArray uAtlas;
uniform float uAlphaTest;
out vec4 fragColor;
void main() {
  if (texture(uAtlas, vec3(vUV, float(vLayer))).a < uAlphaTest) discard;
  fragColor = vec4(1.0);
}`;

/**
 * Volumetric light / god rays, ported from the pack's
 * lib/atmospherics/volumetricLight/volumetricLight.glsl (GetVolumetricLight) with the
 * COMPOSITE1 default parameters:
 *   LIGHTSHAFT_QUALI 2  -> 10 near samples, 1 far sample
 *   fogCurve 0.9, sampleDistribution 2.0, sampleDistributionFar 2.5
 *   maxDistance = max(far * 0.98, 128), qualityThreshold = min(far, shadowDistance) * 0.98
 *   vlColor from lib/colors/lightAndAmbientColors.glsl (COMPOSITE1 branch): noon
 *   (0.4,0.75,1.3), sunset `pow((0.62,0.39,0.24), 1.5 + invNoon) * 6.8`, night (0.08,0.12,0.23)
 *   and the Step 1 / Step 5 multipliers (VdotUM * VdotLM * vlTime, invNoonFactor2 * 0.875 +
 *   0.125, 1.4 - 0.4 * rain).
 *
 * Differences forced by the engine: the two shadow cascades replace shadowtex0/1 (near 40
 * blocks, far 132; beyond that a sample counts as lit), and the "sky visible" gate
 * (SALS, colortex5.a) is approximated by the sky light at the camera (uEyeBrightness for the
 * far sample). The result is a half-resolution additive buffer consumed by COMPOSITE_FRAG.
 */
export const VOLUMETRIC_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;

uniform sampler2D uDepth;        // pre-hand depth copy (full res)
uniform sampler2D uShadow0;      // near cascade depth (40 blocks)
uniform sampler2D uShadow1;      // far cascade depth (132 blocks)
uniform mat4 uInvViewProj;
uniform mat4 uLightViewProj0;
uniform mat4 uLightViewProj1;
uniform vec3 uCameraPos;
uniform vec3 uLightDir;          // direction TO the sun (same convention as the pack's sunVec)
uniform vec2 uResolution;        // half-res target size
uniform float uFar;
uniform float uRain;
uniform float uEyeBrightness;    // sky light at the camera / 15 (pack: eyeBrightnessM)
uniform float uStrength;
uniform float uTexel0;
uniform float uTexel1;

out vec4 fragColor;

float smoothstep1(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2x2 PCF visibility: 1 = lit, 0 = shadowed.
float shadowTap(sampler2D map, vec2 uv, float z, float texel) {
  float sum = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 o = (vec2(float(x), float(y)) - 0.5) * texel;
      float stored = texture(map, uv + o).r;
      sum += (z - 0.0008 <= stored) ? 1.0 : 0.0;
    }
  }
  return sum * 0.25;
}

// pack GetShadowPos/GetShadow: near cascade first, then far, else "no occluder".
float visibility(vec3 worldPos) {
  vec4 p0 = uLightViewProj0 * vec4(worldPos, 1.0);
  vec3 s0 = p0.xyz / p0.w * 0.5 + 0.5;
  if (s0.x > 0.0 && s0.x < 1.0 && s0.y > 0.0 && s0.y < 1.0 && s0.z < 1.0) {
    return shadowTap(uShadow0, s0.xy, s0.z, uTexel0);
  }
  vec4 p1 = uLightViewProj1 * vec4(worldPos, 1.0);
  vec3 s1 = p1.xyz / p1.w * 0.5 + 0.5;
  if (s1.x > 0.0 && s1.x < 1.0 && s1.y > 0.0 && s1.y < 1.0 && s1.z < 1.0) {
    return shadowTap(uShadow1, s1.xy, s1.z, uTexel1);
  }
  return 1.0;
}

void main() {
// ============================== Step 1: factors ============================== //
  float depth = texture(uDepth, vUV).r;
  bool sky = depth >= 0.999999;
  vec4 clip = vec4(vUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * clip;
  world /= world.w;
  vec3 delta = world.xyz - uCameraPos;
  float sceneDist = length(delta);
  vec3 rayDir = delta / max(sceneDist, 1e-4);
  float lViewPos1 = sky ? uFar : sceneDist;

  float sunVisibility = clamp(uLightDir.y + 0.0625, 0.0, 0.125) / 0.125;
  float sunVisibility2 = sunVisibility * sunVisibility;
  float noonFactor = sqrt(max(uLightDir.y, 0.0));
  float nightFactor = sqrt(max(-uLightDir.y, 0.0));
  float invNoonFactor = 1.0 - noonFactor;
  float invNoonFactor2 = invNoonFactor * invNoonFactor;
  float rainFactor = clamp(uRain, 0.0, 1.0);
  float rainFactor2 = rainFactor * rainFactor;
  const float vsBrightness = 0.5;

  // lightAndAmbientColors.glsl (COMPOSITE1 / light-shaft colours).
  vec3 noonClearLightColor = vec3(0.4, 0.75, 1.3);
  vec3 sunsetClearLightColor = pow(vec3(0.62, 0.39, 0.24), vec3(1.5 + invNoonFactor)) * 6.8;
  vec3 nightClearLightColor = vec3(0.08, 0.12, 0.23);
  vec3 dayRainLightColor = vec3(0.21, 0.16, 0.13) * 0.85 + noonFactor * vec3(0.0, 0.02, 0.06);
  vec3 nightRainLightColor = vec3(0.03, 0.035, 0.05) * (0.5 + 0.5 * vsBrightness);
  float noonFactorDM = noonFactor * noonFactor;
  vec3 dayLightColor = mix(sunsetClearLightColor, noonClearLightColor, noonFactorDM);
  vec3 clearLightColor = mix(nightClearLightColor, dayLightColor, sunVisibility2);
  vec3 rainLightColor = mix(nightRainLightColor, dayRainLightColor * 0.6, sunVisibility2) * 2.5;
  vec3 vlColor = mix(clearLightColor, rainLightColor, rainFactor);

  float vlMult = 1.0;
  float vlSceneIntensity = 1.0;
  float rainyNight = (1.0 - sunVisibility) * rainFactor;
  float invRainFactor = 1.0 - rainFactor;
  if (sunVisibility < 0.5) {
    vlSceneIntensity = 0.0;
    float vlMultNightModifier = 0.3 + 0.4 * rainFactor2 + 0.5 * max(0.0, uFar - lViewPos1) / uFar;
    vlMult *= vlMultNightModifier;
    vlColor = normalize(pow(vlColor, vec3(1.0 - max(0.0, 1.0 - 1.5 * nightFactor) + rainFactor)));
    vlColor *= 0.0766 + 0.0766 * vsBrightness;
  }

  // Step 5 (volumetricLight.glsl:351-367): LIGHTSHAFT_SUNSET_SATURATION 0.25, all
  // LIGHTSHAFT_*_I intensities at their default 100 (=no-op).
  vlColor = pow(vlColor, vec3(0.5 + (0.5 + 0.25 * sunVisibility) * invNoonFactor * invRainFactor
    + 0.3 * rainFactor));
  vlColor *= 1.0 - (0.3 + 0.3 * noonFactor) * rainFactor - 0.5 * rainyNight
    + sunVisibility * invNoonFactor2 * invRainFactor;

  float VdotL = dot(rayDir, uLightDir);
  float VdotU = rayDir.y;
  float VdotLM = max((VdotL + 1.0) / 2.0, 0.0);
  float VdotUmax0 = max(VdotU, 0.0);
  float VdotUM = mix((1.0 - VdotUmax0) * (1.0 - VdotUmax0), 1.0, 0.5 * vlSceneIntensity);
  VdotUM = smoothstep1(VdotUM);
  float vdotExponent = max(min(lViewPos1 / uFar, 1.0) * (3.0 - 2.0 * vlSceneIntensity), 1e-4);
  VdotUM = pow(VdotUM, vdotExponent);
  float vlTime = clamp((abs(uLightDir.y) - 0.05) / 0.15, 0.0, 1.0);
  vlMult *= mix(VdotUM * VdotLM, 1.0, 0.4 * rainyNight) * vlTime;
  vlMult *= mix(invNoonFactor2 * 0.875 + 0.125, 1.0, max(vlSceneIntensity, rainFactor2));
  vlMult *= 1.4 - 0.4 * rainFactor;

  vlMult *= uStrength;

// ============================== Step 2/3: trace ============================== //
  float maxDistance = max(uFar * 0.98, 128.0);
  float qualityThreshold = min(uFar, 132.0) * 0.98;
  float activeThreshold = min(qualityThreshold, maxDistance);
  float rayEnd = sky ? maxDistance : min(sceneDist, maxDistance);
  float dither = hash12(floor(vUV * uResolution));

  const int nearSamples = 10;
  const int farSamples = 1;
  vec3 accum = vec3(0.0);
  float accumWeight = 0.0;
  float lastDistance = 0.0;

  for (int i = 0; i <= nearSamples + farSamples; i++) {
    float nextDistance;
    float density;
    if (i <= nearSamples) {
      float t = (float(i) + dither) / float(nearSamples);
      nextDistance = pow(t, 2.0) * activeThreshold;
      if (nextDistance >= rayEnd) break;
      density = visibility(uCameraPos + rayDir * nextDistance);
    } else {
      float t = (float(i - nearSamples) + dither) / float(farSamples);
      nextDistance = mix(activeThreshold, maxDistance, pow(t, 2.5));
      if (nextDistance >= rayEnd) nextDistance = rayEnd;
      density = uEyeBrightness;
    }

    // The fog curve makes the slice weights independent of the sample distribution.
    float currentWeight = smoothstep1(pow(clamp(lastDistance / maxDistance, 0.0, 1.0), 0.9));
    float nextWeight = smoothstep1(pow(clamp(nextDistance / maxDistance, 0.0, 1.0), 0.9));
    float sliceWeight = nextWeight - currentWeight;
    accum += density * sliceWeight * vlColor;
    accumWeight += sliceWeight;
    lastDistance = nextDistance;
  }

// ============================== Step 5: output ============================== //
  fragColor = vec4(max(accum * vlMult, vec3(0.0)), accumWeight);
}`;

/**
 * Volumetric clouds, ported from the pack's lib/atmospherics/clouds/reimaginedClouds.glsl
 * (CLOUD_STYLE 1, CLOUD_QUALITY 2) and mainClouds.glsl:
 *   - one slab, altitude CLOUD_ALT1 = 192 blocks +/- cloudStretch 4.2, cloudTallness 8.4
 *   - density is sampled from the cloud coverage field through GetRoundedCloudCoord
 *     (cloudNarrowness 0.07, cloudRoundness 0.125) with the isosurface threshold
 *     `noise > pow(|alt - y| / stretch, 8) * 0.5 + 0.25`
 *   - CLOUD_QUALITY 2 shading: two extra 2D samples along the sun direction, `light` starts
 *     at 2.0; cloud shading = (VdotSM1 * shadowTime * 0.25 + 0.5 * shading + 0.08) * light
 *   - colour = cloudAmbientColor * 0.95 * (1 - 0.35 * shading)
 *            + cloudLightColor * 0.9 * (0.1 + shading), mixed with the sky gradient by the
 *     horizontal distance fade, alpha = sqrt(clamp(distanceRatio, 0, 0.75) * 1.33333)
 *   - sun shadow darkens samples inside the cascade (lightMult 0.25)
 *
 * Engine differences: the slab march is capped at 48 samples at half resolution, and the
 * scene depth copy terminates the ray so terrain occludes the clouds. The pack's gaux4
 * cloud-water texture is replaced by the generated field in TextureManager.cloudNoise.
 */
export const CLOUD_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;

uniform sampler2D uDepth;
uniform sampler2D uCloudNoise;
uniform sampler2D uShadow0;
uniform sampler2D uShadow1;
uniform mat4 uInvViewProj;
uniform mat4 uLightViewProj0;
uniform mat4 uLightViewProj1;
uniform vec3 uCameraPos;
uniform vec2 uResolution;
uniform float uFar;
uniform float uTexel0;
uniform float uTexel1;
uniform float uCloudAltitude;
uniform float uCloudWind;
uniform vec3 uCloudAmbientColor;
uniform vec3 uCloudLightColor;

out vec4 fragColor;

${COMPLEMENT_SKY_GLSL}

const float CLOUD_STRETCH = 4.2;
const float CLOUD_TALLNESS = 8.4;
const float CLOUD_DISTANCE = 4000.0;
const float CLOUD_ROUNDNESS = 0.125;
const float CLOUD_NARROWNESS = 0.07;

float cloudHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// cloudCoord.glsl GetRoundedCloudCoord: snaps the scaled world position to the coverage grid
// and rounds the cell corners (the cloud silhouette).
vec2 roundedCloudCoord(vec2 pos, float roundness) {
  vec2 coord = pos.yx + 0.5;
  vec2 signCoord = sign(coord);
  coord = abs(coord) + 1.0;
  vec2 i = floor(coord);
  vec2 f = coord - i;
  f = smoothstep(vec2(0.5 - roundness), vec2(0.5 + roundness), f);
  coord = i + f;
  return (coord - 0.5) * signCoord / 256.0;
}

vec3 modifyTracePos(vec3 p) {
  // 1 block/s wind, matching CLOUD_SPEED_MULT 100 (syncedTime).
  p.z -= uCloudWind;
  p.x += uCloudAltitude * 64.0;
  p.xz *= CLOUD_NARROWNESS;
  return p;
}

float cloudDensity(vec2 coord) {
  return texture(uCloudNoise, roundedCloudCoord(coord, CLOUD_ROUNDNESS)).b;
}

bool sampleCloudNoise(vec3 tracePos, out vec3 tracePosM) {
  tracePosM = modifyTracePos(tracePos);
  vec2 coord = roundedCloudCoord(tracePosM.xz, CLOUD_ROUNDNESS);
  float noise = texture(uCloudNoise, coord).b;
  float threshold = clamp(abs(uCloudAltitude - tracePos.y) / CLOUD_STRETCH, 0.001, 0.999);
  threshold = threshold * threshold;
  threshold = threshold * threshold;
  threshold = threshold * threshold;
  return noise > threshold * 0.5 + 0.25;
}

float shadowTap(sampler2D map, vec2 uv, float z, float texel) {
  float sum = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 o = (vec2(float(x), float(y)) - 0.5) * texel;
      float stored = texture(map, uv + o).r;
      sum += (z - 0.0008 <= stored) ? 1.0 : 0.0;
    }
  }
  return sum * 0.25;
}

/** 1 = cloud lit by the sun, 0.25 = inside a terrain shadow (pack GetShadowOnCloud). */
float cloudSunVisibility(vec3 worldPos) {
  vec4 p0 = uLightViewProj0 * vec4(worldPos, 1.0);
  vec3 s0 = p0.xyz / p0.w * 0.5 + 0.5;
  if (s0.x > 0.0 && s0.x < 1.0 && s0.y > 0.0 && s0.y < 1.0 && s0.z < 1.0) {
    return mix(0.25, 1.0, shadowTap(uShadow0, s0.xy, s0.z, uTexel0));
  }
  vec4 p1 = uLightViewProj1 * vec4(worldPos, 1.0);
  vec3 s1 = p1.xyz / p1.w * 0.5 + 0.5;
  if (s1.x > 0.0 && s1.x < 1.0 && s1.y > 0.0 && s1.y < 1.0 && s1.z < 1.0) {
    return mix(0.25, 1.0, shadowTap(uShadow1, s1.xy, s1.z, uTexel1));
  }
  return 1.0;
}

void main() {
  float depth = texture(uDepth, vUV).r;
  bool sky = depth >= 0.999999;
  vec4 clip = vec4(vUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * clip;
  world /= world.w;
  vec3 rel = world.xyz - uCameraPos;
  float sceneDist = sky ? uFar : length(rel);
  vec3 dir = rel / max(length(rel), 1e-4);

  float dither = cloudHash(floor(vUV * uResolution));
  float higherAlt = uCloudAltitude + CLOUD_STRETCH;
  float lowerAlt = uCloudAltitude - CLOUD_STRETCH;

  // Slab entry/exit along the view ray; a ray parallel to the plane is nudged so the
  // division stays finite (the distance checks below handle the result).
  float ny = dir.y;
  if (abs(ny) < 1e-4) ny = ny < 0.0 ? -1e-4 : 1e-4;
  float dLower = (lowerAlt - uCameraPos.y) / ny;
  float dHigher = (higherAlt - uCameraPos.y) / ny;
  float enter = max(min(dLower, dHigher), 0.0);
  float exitT = max(dLower, dHigher);
  if (exitT < 0.0) { fragColor = vec4(0.0); return; }
  exitT = min(exitT, min(CLOUD_DISTANCE, sceneDist));
  if (exitT <= enter) { fragColor = vec4(0.0); return; }

  float span = exitT - enter;
  int samples = clamp(int(span / 8.0), 8, 48);
  float stepLength = span / float(samples);
  vec3 traceAdd = dir * stepLength;
  vec3 tracePos = uCameraPos + dir * enter + traceAdd * dither;
  tracePos.y -= traceAdd.y;

  float VdotS = dot(dir, uSunWorldDir);
  float VdotSM1 = max(uSunVisibility > 0.5 ? VdotS : -VdotS, 0.0);
  float gradientNoise = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x
    + 0.00583715 * gl_FragCoord.y));

  for (int i = 0; i < 48; i++) {
    if (i >= samples) break;
    tracePos += traceAdd;
    vec3 traceRel = tracePos - uCameraPos;
    float lTrace = length(traceRel);
    float lTraceXZ = length(traceRel.xz);
    if (lTrace > sceneDist) break;
    if (lTraceXZ > CLOUD_DISTANCE) break;

    vec3 tracePosM;
    if (!sampleCloudNoise(tracePos, tracePosM)) continue;

    float lightMult = cloudSunVisibility(tracePos);
    float shading = 1.0 - (higherAlt - tracePos.y) / CLOUD_TALLNESS;
    shading = pow(max(shading, 0.0), 0.8);

    // CLOUD_QUALITY 2: march the coverage field a little way toward the sun.
    float shadingM = 1.0 - shading;
    vec3 lightPos = tracePosM;
    vec3 lightStep = uSunWorldDir * 0.08 * uShadowTime;
    float light = 2.0;
    lightPos += (1.0 + gradientNoise) * lightStep;
    light -= cloudDensity(lightPos.xz) * shadingM;
    lightPos += gradientNoise * lightStep;
    light -= cloudDensity(lightPos.xz) * shadingM;

    float lit = VdotSM1 * uShadowTime * 0.25 + 0.5 * shading + 0.08;
    shading = lit * light * lightMult;

    vec3 colorSample = uCloudAmbientColor * 0.95 * (1.0 - 0.35 * shading)
      + uCloudLightColor * 0.9 * (0.1 + shading);
    vec3 cloudSkyColor = complementSky(dir, dither, false, false);
    float distanceRatio = (CLOUD_DISTANCE - lTraceXZ) / CLOUD_DISTANCE;
    float fogFactor = pow(clamp(distanceRatio, 0.0, 1.0), 2.0) * 0.707;
    colorSample *= 1.0 - 0.2 * max(uSunVisibility * uSunVisibility, uNightFactor);
    colorSample = mix(cloudSkyColor, colorSample, fogFactor * 0.707);

    float alpha = sqrt(clamp(distanceRatio, 0.0, 0.75) * 1.33333);
    fragColor = vec4(colorSample, alpha);
    return;
  }

  fragColor = vec4(0.0);
}`;

