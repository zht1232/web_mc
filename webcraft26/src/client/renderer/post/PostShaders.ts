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
uniform vec2 uResolution;

uniform float uExposure;       // TM_EXPOSURE
uniform float uBloomStrength;  // BLOOM_STRENGTH
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

  // composite5.glsl:142 - mix, never add.
  color = mix(color, bloom, uBloomStrength);

  color = tonemapComplementary(color);
  color = bslSaturation(color);

  // final.glsl:155-159 - brightness-aware vignette.
  vec2 d = vUV - 0.5;
  float vignette = 1.0 - dot(d, d) * (1.0 - dot(color, LUMA));
  color *= vignette;

  // final.glsl:161-162 - dither before the 8-bit write.
  float dither = hash12(vUV * uResolution + uTime);
  color += vec3((dither - 0.25) / 128.0);

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
uniform mat4 uLightViewProj;
uniform vec3 uChunkOrigin;
out vec2 vUV;
flat out uint vLayer;
void main() {
  vUV = aUV / 4096.0;
  vLayer = aLayer;
  gl_Position = uLightViewProj * vec4(aPos + uChunkOrigin, 1.0);
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
