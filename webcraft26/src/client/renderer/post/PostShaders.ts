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
 * Final composite: shadowed sun + sky ambient already baked into the HDR buffer by the
 * terrain pass, so this pass only has to add bloom, apply the tone curve, grade, vignette
 * and output to the default framebuffer.
 */
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform vec2 uResolution;

uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform float uTime;
uniform int uDebug;

out vec4 fragColor;

// ---------------------------------------------------------------- tone mapping
// Lottes-style filmic curve, the shape Complementary uses. hdrMax is the white point,
// mid is the middle grey, toe lifts the shadows so caves do not crush to pure black.
vec3 tonemapLottes(vec3 color) {
  const float hdrMax = 8.0;
  const float mid = 0.25;
  const float contrast = 1.05;

  color *= uExposure;
  color = max(color, vec3(0.0));

  // contrast around the middle grey
  vec3 x = color / hdrMax;
  vec3 xc = pow(x, vec3(contrast));
  vec3 curve = xc / (xc + vec3(0.6));
  vec3 mapped = curve * hdrMax;

  // keep the mid grey anchored, then lift the toe a little
  float midRef = mid / (mid + 0.6) * hdrMax;
  mapped = mapped / max(midRef, 1e-4) * mid;
  mapped = mapped / (1.0 + mapped * (1.0 / hdrMax));
  return mapped;
}

vec3 saturateColor(vec3 c, float amount) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), c, amount);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 color = texture(uColor, vUV).rgb;
  vec3 bloom = texture(uBloom, vUV).rgb;

  if (uDebug == 1) { fragColor = vec4(color, 1.0); return; }
  if (uDebug == 2) { fragColor = vec4(bloom, 1.0); return; }

  // Complementary mixes the bloom in at 0.12 instead of adding it on top.
  color = mix(color, max(color, bloom), uBloomStrength);

  color = tonemapLottes(color);

  // grading: slight contrast, desaturate the shadows, keep the highlights warm
  color = saturateColor(color, uSaturation);
  color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);

  // brightness-aware vignette (Complementary fades it out on bright frames)
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec2 d = vUV - 0.5;
  float vig = 1.0 - uVignette * dot(d, d) * (1.0 - luma * 0.6);
  color *= vig;

  // fine dithering to hide 8-bit banding in the sky gradient
  float dither = (hash12(vUV * uResolution + uTime) - 0.5) / 255.0;
  color += dither;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

/**
 * Bloom prefilter: soft-knee threshold. Keeps a little energy below the threshold so the
 * bloom does not pop when a highlight crosses it.
 */
export const BLOOM_PREFILTER_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uColor;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSoftKnee;
out vec4 fragColor;

void main() {
  // 4-tap box downsample doubles as the first blur step
  vec3 c = texture(uColor, vUV + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture(uColor, vUV + uTexel * vec2( 0.5, -0.5)).rgb;
  c += texture(uColor, vUV + uTexel * vec2(-0.5,  0.5)).rgb;
  c += texture(uColor, vUV + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;

  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uSoftKnee + 1e-5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, br - uThreshold) / max(br, 1e-5);

  fragColor = vec4(c * contribution, 1.0);
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
 * Depth-only pass used to build the sun shadow map. Reuses the chunk VAO, so the only
 * inputs are the position attribute and the section origin.
 */
export const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uLightViewProj;
uniform vec3 uChunkOrigin;
void main() {
  gl_Position = uLightViewProj * vec4(aPos + uChunkOrigin, 1.0);
}`;

export const SHADOW_FRAG = `#version 300 es
precision highp float;
void main() {}`;
