// GLSL for the terrain pass. The lightmap is a 16x16 texture generated on the CPU
// from core/lightmap.fsh so day/night changes never require a remesh.

export const TERRAIN_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;      // texel space * 256
layout(location = 2) in uint aLayer;
layout(location = 3) in vec2 aLight;   // sky, block (0..15)
layout(location = 4) in vec4 aColor;

uniform mat4 uViewProj;
uniform vec3 uChunkOrigin;
uniform float uTime;
// Complementary WAVING_WATER_VERTEX (lib/materials/materialMethods/wavingBlocks.glsl:69-90): water surface vertices
// bob by two sines. x = water_still layer, y = water_flow layer (-1 disables), uWaveTime is frameTimeCounter in seconds.
uniform ivec2 uWaterLayers;
uniform float uWaveTime;
// Complementary WAVING_BLOCKS: aColor.a packs the per-vertex wind weight (255 = static), written by
// SectionMesher for grass/flowers/crops/leaves. 0 keeps the displacement off in programs that never
// set it (the item icon atlas shares this vertex shader).
uniform float uSwayTime;

out vec2 vUV;
flat out uint vLayer;
out vec2 vLight;
out vec4 vColor;
out float vFogDepth;
out vec3 vWorldPos;

void main() {
  vec3 world = aPos + uChunkOrigin;
  // uWaveTime stays 0 in programs that never set it (icon atlas), which keeps the displacement off there
  if (uWaveTime > 0.0 && uWaterLayers.x >= 0 && (int(aLayer) == uWaterLayers.x || int(aLayer) == uWaterLayers.y) && fract(world.y + 0.005) > 0.06) {
    float t = uWaveTime * 6.0;
    vec2 p = world.xz * 14.0;
    float wave = sin(t * 0.7 - p.y * 0.14 + p.x * 0.07) + sin(t * 0.5 - p.y * 0.10 + p.x * 0.05);
    world.y += (wave * 0.1) * 0.125 - 0.05;
  }
  // Wind: two sines with a world-space phase so neighbouring plants move together, weighted by the
  // vertex's height inside its block (root stays planted). Leaves carry a smaller weight.
  float sway = 1.0 - aColor.a;
  if (uSwayTime > 0.0 && sway > 0.004) {
    float gust = sin(uSwayTime * 1.6 + world.x * 0.35 + world.z * 0.27)
      + 0.5 * sin(uSwayTime * 3.3 - world.z * 0.6 + world.x * 0.12);
    world.x += gust * 0.06 * sway;
    world.z += cos(uSwayTime * 1.25 + world.z * 0.42 + world.x * 0.1) * 0.05 * sway;
  }
  vec4 clip = uViewProj * vec4(world, 1.0);
  gl_Position = clip;
  vUV = aUV / 4096.0;      // 16 texels -> 1.0
  vLayer = aLayer;
  vLight = aLight;
  vColor = aColor;
  vWorldPos = world;
  vFogDepth = length(world - uChunkOrigin) + 0.0;
}`;

export const TERRAIN_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUV;
flat in uint vLayer;
in vec2 vLight;
in vec4 vColor;
in vec3 vWorldPos;

uniform sampler2DArray uAtlas;
uniform sampler2D uLightmap;
uniform vec3 uFogColor;
// Fog ranges come from renderer/environment/FogState.ts (FogRenderer.setupFog / FogData.java):
// environmentalStart/End for the spherical distance, renderDistanceStart/End for the
// cylindrical one - exactly fog.glsl total_fog_value.
uniform float uFogEnvStart;
uniform float uFogEnvEnd;
uniform float uFogRdStart;
uniform float uFogRdEnd;
uniform float uFogEnabled;
uniform vec3 uCameraPos;
uniform float uAlphaTest;
uniform float uTranslucent;
uniform int uDebug;

// Shader-pipeline only (TASK-render Phase B.2). uUseShadows == 0 keeps the vanilla path.
// The depth map is a plain sampler2D and the compare is done by hand: sampler2DShadow would
// force every other user of TERRAIN_FRAG (gui/ItemIconAtlas) to back that unit with a depth
// texture, and WebGL validates sampler/format pairs on every draw.
uniform int uUseShadows;
uniform sampler2D uShadowMap;
uniform mat4 uLightViewProj;
// Second cascade (far). uCascadeCount == 1 keeps the single-map path for the icon pass.
uniform sampler2D uShadowMap1;
uniform mat4 uLightViewProj1;
uniform float uCascadeCount;
uniform float uCascadeSplit;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uShadowTexel;
/** Shadow strength gate: 1 with the sun up, 0 at night (vanilla has no moon shadows). */
uniform float uShadowDay;

// Screen-space reflections for water (OpusMC/Complementary look). LevelRenderer snapshots the
// opaque scene into uSceneColor/uSceneDepth right before the translucent pass; uWaterReflect = 0
// disables the whole branch (icon atlas, shaders off, low quality).
uniform int uWaterReflect;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
// highp to match the same uniform in TERRAIN_VERT (precision must agree on link).
uniform highp ivec2 uWaterLayers;
uniform mat4 uViewProj;

out vec4 fragColor;

/**
 * Manual depth compare with 5x5 PCF. The old 3x3 at 1.5 texel spacing left visible stair-steps
 * on large flat surfaces ("banded" shadows); 5x5 at 1.0 texel plus the normal offset below is
 * smooth at the same tap count per axis budget.
 *
 * texel is the cascade's world size of one shadow texel (uShadowTexel). It must NOT be used as
 * the PCF step: it is ~0.04 blocks, and treating that as a UV offset spread the 25 taps over
 * ±80 shadow texels, which painted faint stippled stripes over every lit surface (more visible
 * at higher shadow resolutions). The step comes from textureSize() so it follows the bound map.
 */
float sampleShadow(sampler2D smap, mat4 lvp, vec3 wp, vec3 n, float ndl, float texel) {
  float slope = clamp(1.0 - ndl, 0.0, 1.0);
  // Normal-offset bias in world units: grows with the texel footprint so a low shadow resolution
  // (big texels) does not leave acne while a high one stays tight.
  float offset = 0.03 + texel * 1.5 * (0.5 + slope);
  vec4 sc = lvp * vec4(wp + n * offset, 1.0);
  if (sc.w <= 0.0) return 1.0;
  vec3 ndc = sc.xyz / sc.w;
  vec2 suv = ndc.xy * 0.5 + 0.5;
  if (suv.x < 0.005 || suv.x > 0.995 || suv.y < 0.005 || suv.y > 0.995) return 1.0;
  float sdepth = ndc.z * 0.5 + 0.5;
  float ref = sdepth - mix(0.00018, 0.0009, slope);
  vec2 texelUV = 1.0 / vec2(textureSize(smap, 0));
  float sum = 0.0;
  for (int sx = -2; sx <= 2; sx++) {
    for (int sy = -2; sy <= 2; sy++) {
      float stored = texture(smap, suv + vec2(float(sx), float(sy)) * texelUV).r;
      sum += ref <= stored ? 1.0 : 0.0;
    }
  }
  return sum / 25.0;
}

void main() {
  // CUTOUT must sample mip 0: averaging RGBA mips mixes the black RGB of transparent texels
  // into leaves/plants (alpha stays above the 0.5 cutout), turning them into dark, solid blobs.
  // Vanilla uses sampleNearest/RGSS for cutout terrain; LOD 0 is the equivalent fix here.
  vec4 tex = uAlphaTest >= 0.25
    ? textureLod(uAtlas, vec3(vUV, float(vLayer)), 0.0)
    // Slight negative LOD bias on the opaque path: the mip chain is chosen for the steepest axis,
    // so distant ground washed out ("远处糊"). A 0.8 derivative scale is ≈ -0.3 mip - visibly
    // sharper at distance while still far away from the shimmer of raw minification.
    : textureGrad(uAtlas, vec3(vUV, float(vLayer)), dFdx(vUV) * 0.8, dFdy(vUV) * 0.8);
  if (uDebug == 1) { fragColor = vec4(vColor.rgb, 1.0); return; }
  if (uDebug == 2) { fragColor = vec4(vUV, float(vLayer) / 64.0, 1.0); return; }
  if (uDebug == 3) { fragColor = vec4(tex.rgb, 1.0); return; }
  if (uDebug == 4) { fragColor = vec4(vLight / 15.0, 0.0, 1.0); return; }
  if (tex.a < uAlphaTest) discard;

  // vLight = (sky, block); the lightmap texture is x = block light, y = sky light (core/lightmap.fsh).
  // Split the combined lightmap into its block and sky parts: the shadow map may only dim the
  // sky/sun contribution, otherwise torch light inside a shadow was multiplied down too.
  vec2 lightUV = (vLight.yx + 0.5) / 16.0;
  vec3 light = texture(uLightmap, lightUV).rgb;
  vec3 skyLight = texture(uLightmap, vec2(0.5 / 16.0, (vLight.x + 0.5) / 16.0)).rgb;
  vec3 blockLight = max(light - skyLight, vec3(0.0));
  vec3 albedo = tex.rgb * vColor.rgb;
  vec3 color = albedo * (blockLight + skyLight);
  if (uDebug == 9) { fragColor = vec4(light, 1.0); return; }
  if (uDebug == 10) { fragColor = vec4(vColor.rgb, 1.0); return; }
  float alpha = tex.a * (uTranslucent > 0.5 ? vColor.a : 1.0);

  // Direct sun / moon with a PCF shadow term. Only active in shader mode; translucent water
  // receives the lightmap result (it does not cast into the shadow map either).
  if (uUseShadows == 1 && uTranslucent < 0.5) {
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float ndl = max(dot(n, uSunDir), 0.0);
    if (uDebug == 12) { fragColor = vec4(n * 0.5 + 0.5, 1.0); return; }
    if (uDebug == 13) { fragColor = vec4(vec3(ndl), 1.0); return; }
    if (ndl > 0.0) {
      float lit = sampleShadow(uShadowMap, uLightViewProj, vWorldPos, n, ndl, uShadowTexel);
      if (uCascadeCount > 1.5) {
        // Blend into the far cascade across the last 15% of the near extent so the switch is
        // invisible; beyond the far extent the map fades out instead of ending in a hard edge.
        float dist = length(vWorldPos.xz - uCameraPos.xz);
        float farLit = sampleShadow(uShadowMap1, uLightViewProj1, vWorldPos, n, ndl, uShadowTexel);
        lit = mix(lit, farLit, smoothstep(uCascadeSplit * 0.85, uCascadeSplit, dist));
      }
      if (uDebug == 11) { fragColor = vec4(vec3(lit), 1.0); return; }
      // deep shade / caves keep the lightmap value only, like the vanilla direct term.
      // vLight.x is the SKY light (vLight = (sky, block)); the lightmap sample uses vLight.yx.
      float skyMask = smoothstep(0.0, 0.55, vLight.x / 15.0);
      // The vanilla lightmap ALREADY contains the sun's brightness and colour. Adding a second
      // sun on top made every lit surface ~50% brighter than vanilla, which read as oversaturated
      // neon ("the shader makes all colours too vivid"). The shadow map now only attenuates the
      // direct/sky component: lit = 1, shadow keeps 55% ambient. uShadowDay is computed from the
      // SUN's elevation (not uSunDir, which is the moon at night), so the night lightmap is untouched.
      float sunUp = uShadowDay;
      float shadow = mix(1.0, mix(0.55, 1.0, lit), skyMask * ndl * sunUp);
      color = albedo * (blockLight + skyLight * shadow);
    }
  }

  // Water: screen-space reflections against the pre-water colour/depth snapshots. Ray-marches the
  // reflected view ray in clip space; a hit is the first step that lands behind opaque geometry.
  // Fresnel keeps the reflection subtle head-on and strong at grazing angles, like Complementary.
  if (uDebug == 14) {
    bool dbgWater = uTranslucent > 0.5 && uWaterLayers.x >= 0
      && (int(vLayer) == uWaterLayers.x || int(vLayer) == uWaterLayers.y);
    fragColor = vec4(uWaterReflect == 1 ? 1.0 : 0.0, dbgWater ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }
  if (uWaterReflect == 1 && uTranslucent > 0.5 && uWaterLayers.x >= 0
      && (int(vLayer) == uWaterLayers.x || int(vLayer) == uWaterLayers.y)) {
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (n.y < 0.0) n = -n;
    vec3 v = normalize(vWorldPos - uCameraPos);
    vec3 r = reflect(v, n);
    float dbgRayD = 0.0;
    float dbgSceneD = 0.0;
    if (r.y > 0.0) {
      vec3 pos = vWorldPos;
      float stepLen = 0.4;
      vec2 hitUV = vec2(-1.0);
      float hitFade = 0.0;
      for (int i = 0; i < 16; i++) {
        pos += r * stepLen;
        stepLen *= 1.32;
        vec4 c = uViewProj * vec4(pos, 1.0);
        if (c.w <= 0.0) break;
        vec2 uv = (c.xy / c.w) * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float sceneD = texture(uSceneDepth, uv).r;
        float rayD = c.z / c.w * 0.5 + 0.5;
        dbgRayD = rayD;
        dbgSceneD = sceneD;
        if (rayD > sceneD && rayD - sceneD < 0.06) {
          hitUV = uv;
          hitFade = 1.0 - float(i) / 16.0;
          break;
        }
      }
      if (uDebug == 16) {
        fragColor = vec4(hitUV.x >= 0.0 ? 1.0 : 0.0, dbgRayD, dbgSceneD, 1.0);
        return;
      }
      if (hitUV.x >= 0.0) {
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
        float strength = clamp(fres * 0.9, 0.0, 0.8) * hitFade;
        color = mix(color, texture(uSceneColor, hitUV).rgb, strength);
      }
    } else if (uDebug == 16) {
      fragColor = vec4(0.0, 0.0, 1.0, 1.0); // reflected ray points down
      return;
    }
  }

  // fog.glsl total_fog_value + apply_fog: spherical distance against the environmental range,
  // cylindrical distance against the render-distance range, no extra squaring.
  if (uFogEnabled > 0.5) {
    vec3 d = vWorldPos - uCameraPos;
    float spherical = length(d);
    float cylindrical = max(length(d.xz), abs(d.y));
    float envFog = clamp((spherical - uFogEnvStart) / max(uFogEnvEnd - uFogEnvStart, 1e-4), 0.0, 1.0);
    float rdFog = clamp((cylindrical - uFogRdStart) / max(uFogRdEnd - uFogRdStart, 1e-4), 0.0, 1.0);
    color = mix(color, uFogColor, max(envFog, rdFog));
  }

  fragColor = vec4(color, alpha);
}`;

export const SKY_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = vec4(aPos, 0.9999, 1.0);
}`;

export const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec3 uSunriseColor;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uCameraForward;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uSunDir;
uniform float uSunriseStrength;
uniform int uDebug;
out vec4 fragColor;

void main() {
  vec3 dir = normalize(uCameraForward
    + uCameraRight * (vUV.x * uTanHalfFov * uAspect)
    + uCameraUp * (vUV.y * uTanHalfFov));

  if (uDebug == 5) { fragColor = vec4(dir * 0.5 + 0.5, 1.0); return; }
  if (uDebug == 8) { fragColor = vec4(vec3(clamp(dir.y, 0.0, 1.0)), 1.0); return; }
  if (uDebug == 6) { fragColor = vec4(uSkyColor, 1.0); return; }
  if (uDebug == 7) { fragColor = vec4(uFogColor, 1.0); return; }
  float up = clamp(dir.y, -1.0, 1.0);
  // vanilla sky: flat upper colour fading into the fog colour at the horizon
  float horizon = 1.0 - smoothstep(-0.02, 0.28, up);
  vec3 color = mix(uSkyColor, uFogColor, horizon * 0.85);

  // sunrise / sunset glow around the sun direction
  float sunDot = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sunDot, 8.0) * uSunriseStrength;
  color += uSunriseColor * glow;

  fragColor = vec4(color, 1.0);
}`;

export const CELESTIAL_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uScale;
out vec2 vUV;
void main() {
  vec3 world = uCenter + uRight * (aPos.x * uScale) + uUp * (aPos.y * uScale);
  gl_Position = uViewProj * vec4(world, 1.0);
  vUV = aUV;
}`;

export const CELESTIAL_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uTint;
out vec4 fragColor;
void main() {
  vec4 c = texture(uTex, vUV) * uTint;
  if (c.a < 0.02) discard;
  fragColor = c;
}`;

export const CLOUD_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uViewProj;
uniform vec3 uOffset;
out vec2 vUV;
out float vShade;
void main() {
  vec3 world = aPos + uOffset;
  gl_Position = uViewProj * vec4(world, 1.0);
  vUV = aUV;
  vShade = 1.0;
}`;

export const CLOUD_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vShade;
uniform sampler2D uTex;
uniform vec4 uTint;
out vec4 fragColor;
void main() {
  vec4 c = texture(uTex, vUV);
  c *= uTint;
  if (c.a < 0.02) discard;
  fragColor = vec4(c.rgb * vShade, c.a);
}`;

export const LINE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform vec2 uClipOffset;   // sub-pixel shift in NDC, used to thicken GL_LINES (always 1px wide)
void main() {
  gl_Position = uViewProj * vec4(aPos + uOffset, 1.0);
  gl_Position.xy += uClipOffset * gl_Position.w;
}`;

export const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;
