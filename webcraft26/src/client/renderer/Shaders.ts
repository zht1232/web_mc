// GLSL for the terrain pass. The lightmap is a 16x16 texture generated on the CPU
// from core/lightmap.fsh so day/night changes never require a remesh.

import { BAYER_GLSL, COMPLEMENT_SKY_GLSL } from './environment/ComplementSky.js';

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
uniform mat4 uInvViewProj;
uniform vec2 uResolution;
uniform float uWaveTime;

// Water refraction (Complementary Reimagined lib/materials/materialMethods/refraction.glsl,
// only compiled at DETAIL_QUALITY >= 3 = our high/ultra shader quality):
//   DoRefraction distorts the opaque scene behind water with a noise offset scaled by the
//   view distance and the water/opaque depth difference, then composites the water over it.
uniform int uRefraction;
uniform sampler2D uNoise;
uniform float uNear;
uniform float uFar;
uniform float uProjScale;          // gbufferProjection[1][1] = 1 / tan(fovY / 2)
uniform float uRefractionIntensity;

// SKY_EFFECT_REFLECTION_TRANSLUCENT (pack: only defined at DETAIL_QUALITY >= 3 = our
// high/ultra): stars and the cloud deck are part of the reflected sky, not just the gradient.
// The coverage field is the same generated 256^2 texture the volumetric cloud pass samples.
uniform int uSkyReflectEffects;
uniform sampler2D uCloudNoise;
uniform vec3 uCloudAmbientColor;
uniform vec3 uCloudLightColor;

// Complementary Reimagined r5.9.3 sky model, shared with the sky pass (see ComplementSky.ts).
${COMPLEMENT_SKY_GLSL}
${BAYER_GLSL}

out vec4 fragColor;

// stars.glsl GetStars with NIGHT_STAR_AMOUNT 2. The reflection direction is world space, so
// no view-matrix conversion is needed (the pack goes through gbufferModelViewInverse).
float starNoise(vec2 pos) {
  return fract(sin(dot(pos, vec2(12.9898, 4.1414))) * 43758.54953);
}

vec3 getStars(vec2 starCoord, float VdotU, float VdotS) {
  if (VdotU < 0.0) return vec3(0.0);
  starCoord *= 0.2;
  float starFactor = 1024.0;
  starCoord = floor(starCoord * starFactor) / starFactor;
  float star = 1.0;
  star *= starNoise(starCoord.xy);
  star *= starNoise(starCoord.xy + 0.1);
  star *= starNoise(starCoord.xy + 0.23);
  star -= 0.7;
  star = max(star, 0.0);
  star *= star;
  star *= min(VdotU * 3.0, 1.0) * max(0.0, 1.0 - pow(abs(VdotS) * 1.002, 100.0));
  float invNoonFactor = 1.0 - uNoonFactor;
  float invNoonFactor2 = invNoonFactor * invNoonFactor;
  star *= uInvRainFactor * pow(invNoonFactor2, 4.0) * (1.0 - 0.5 * uSunVisibility);
  return 40.0 * star * vec3(0.38, 0.4, 0.5);
}

// cloudCoord.glsl GetRoundedCloudCoord (same grid as the volumetric cloud pass).
vec2 reflCloudCoord(vec2 pos, float roundness) {
  vec2 coord = pos.yx + 0.5;
  vec2 signCoord = sign(coord);
  coord = abs(coord) + 1.0;
  vec2 i = floor(coord);
  vec2 f = coord - i;
  f = smoothstep(vec2(0.5 - roundness), vec2(0.5 + roundness), f);
  coord = i + f;
  return (coord - 0.5) * signCoord / 256.0;
}

/**
 * DoSkyEffectReflection (reflectionBackground.glsl): stars first, then the cloud deck
 * composited over them. The deck is a single coverage sample at the 192-block plane shaded
 * with the CPU cloud colours - the reflection ray does not run the full slab march.
 */
vec3 skyReflectionEffects(vec3 dir, float dither) {
  vec3 effect = vec3(0.0);
  float VdotU = dir.y;
  float VdotS = dot(dir, uSunWorldDir);
  if (VdotU > 0.0) {
    vec2 starCoord = dir.xz / (dir.y + length(dir.xz) * 0.5);
    starCoord.x += 0.006 * uWaveTime;
    effect += getStars(starCoord, VdotU, VdotS);
  }

  const float CLOUD_ALT = 192.33;
  if (abs(dir.y) > 1e-4) {
    float t = (CLOUD_ALT - uCameraPos.y) / dir.y;
    if (t > 0.0 && t < 4000.0) {
      vec3 p = uCameraPos + dir * t;
      p.z -= uWaveTime;
      p.x += CLOUD_ALT * 64.0;
      p.xz *= 0.07;
      vec3 cloudColor = uCloudAmbientColor * 0.62 + uCloudLightColor * 0.54;
      if (texture(uCloudNoise, reflCloudCoord(p.xz, 0.125)).b > 0.25) {
        float ratio = (4000.0 - t) / 4000.0;
        float alpha = sqrt(clamp(ratio, 0.0, 0.75) * 1.33333);
        effect = mix(effect, cloudColor, alpha);
      }
    }
  }
  return effect;
}

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

/**
 * lib/lighting/ggx.glsl GetNoHSquared + GGX (Horizon Zero Dawn area light approximation),
 * transcribed from the uploaded Complementary Reimagined r5.9.3 pack.
 */
float getNoHSquared(float radiusTan, float NoL, float NoV, float VoL) {
  float radiusCos = 1.0 / sqrt(1.0 + radiusTan * radiusTan);
  float RoL = 2.0 * NoL * NoV - VoL;
  if (RoL >= radiusCos) return 1.0;
  float rOverLengthT = radiusCos * radiusTan / sqrt(1.0 - RoL * RoL);
  float NoTr = rOverLengthT * (NoV - RoL * NoL);
  float VoTr = rOverLengthT * (2.0 * NoV * NoV - 1.0 - RoL * VoL);
  float triple = sqrt(clamp(1.0 - NoL * NoL - NoV * NoV - VoL * VoL + 2.0 * NoL * NoV * VoL, 0.0, 1.0));
  float NoBr = rOverLengthT * triple, VoBr = rOverLengthT * (2.0 * triple * NoV);
  float NoLVTr = NoL * radiusCos + NoV + NoTr, VoLVTr = VoL * radiusCos + 1.0 + VoTr;
  float p = NoBr * VoLVTr, q = NoLVTr * VoLVTr, s = VoBr * NoLVTr;
  float xNum = q * (-0.5 * p + 0.25 * VoBr * NoLVTr);
  float xDenom = p * p + s * (s - 2.0 * p) + NoLVTr * ((NoL * radiusCos + NoV) * VoLVTr * VoLVTr
    + q * (-0.5 * (VoLVTr + VoL * radiusCos) - 0.5));
  float twoX1 = 2.0 * xNum / (xDenom * xDenom + xNum * xNum);
  float sinTheta = twoX1 * xDenom;
  float cosTheta = 1.0 - twoX1 * xNum;
  NoTr = cosTheta * NoTr + sinTheta * NoBr;
  VoTr = cosTheta * VoTr + sinTheta * VoBr;
  float newNoL = NoL * radiusCos + NoTr;
  float newVoL = VoL * radiusCos + VoTr;
  float NoH = NoV + newNoL;
  float HoH = 2.0 * newVoL + 2.0;
  return clamp(NoH * NoH / HoH, 0.0, 1.0);
}

float ggx(vec3 normalM, vec3 geoNormal, vec3 nViewPos, vec3 lightVec, float NdotLmax0, float smoothnessG) {
  smoothnessG = skySqrt1(smoothnessG * 0.9 + 0.1);
  float roughnessP = 1.35 - smoothnessG;
  float roughness = skyPow2(skyPow2(roughnessP));
  vec3 halfVec = normalize(lightVec - nViewPos);
  float dotLH = clamp(dot(halfVec, lightVec), 0.0, 1.0);
  float dotNV = dot(normalM, -nViewPos);
  float dotNH = getNoHSquared(0.01, NdotLmax0, dotNV, dot(-nViewPos, lightVec));
  float denom = dotNH * roughness - dotNH + 1.0;
  float D = roughness / (3.141592653589793 * skyPow2(denom));
  float f0 = 0.05;
  float F = exp2((-5.55473 * dotLH - 6.98316) * dotLH) * (1.0 - f0) + f0;
  float NdotLmax0M = skySqrt3(NdotLmax0 * max(dot(geoNormal, lightVec), 0.0));
  float specular = max(NdotLmax0M * D * F / skyPow2(dotLH), 0.0);
  specular = specular / (0.125 * specular + 1.0);
  return specular;
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

  // Water: port of Complementary Reimagined r5.9.3 (lib/materials/materialMethods/reflections.glsl,
  // reflectionBackground.glsl, sky.glsl, water.glsl). The pack's shipped defaults are WATER_STYLE 1
  // and WATER_REFLECT_QUALITY 2, i.e. a flat mirror normal + 30-sample ray march with 6 refinements
  // + GetSky() for rays the depth buffer cannot resolve.
  if (uDebug == 14) {
    bool dbgWater = uTranslucent > 0.5 && uWaterLayers.x >= 0
      && (int(vLayer) == uWaterLayers.x || int(vLayer) == uWaterLayers.y);
    fragColor = vec4(uWaterReflect == 1 ? 1.0 : 0.0, dbgWater ? 1.0 : 0.0, 0.0, 1.0);
    return;
  }
  if (uWaterReflect == 1 && uTranslucent > 0.5 && uWaterLayers.x >= 0
      && (int(vLayer) == uWaterLayers.x || int(vLayer) == uWaterLayers.y)) {
    // gbuffers_water.glsl:216-220 + water.glsl Step 2: default WATER_STYLE 1 keeps the geometric
    // normal (no normal map), so the surface is a plane mirror modulated by Fresnel.
    vec3 geoNormal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (geoNormal.y < 0.0) geoNormal = -geoNormal;
    vec3 nViewPos = normalize(vWorldPos - uCameraPos);
    float VdotN = dot(nViewPos, geoNormal);
    vec3 normalM = VdotN > 0.0 ? -geoNormal : geoNormal;
    float fresnel = clamp(1.0 + dot(normalM, nViewPos), 0.0, 1.0);
    float fresnel2 = skyPow2(fresnel);
    float fresnel4 = skyPow2(fresnel2);
    float lViewPos = length(vWorldPos - uCameraPos);
    float dither = bayer64(gl_FragCoord.xy);

    // reflections.glsl Method 1 (WORLD_SPACE_REFLECTIONS_INTERNAL == -1 -> rEdge 0.6/0.55,
    // 30 samples, 6 refinements). Distances are world-space; the march itself is the pack's.
    vec2 rEdge = vec2(0.6, 0.55);
    vec3 start = vWorldPos + normalM * (lViewPos * 0.025 * (1.0 - fresnel) + 0.05);
    vec3 vector = reflect(nViewPos, normalM) * 0.5;
    vec3 rayPos = start + vector;
    vec3 tvector = vector;
    int sr = 0;
    float err = 9999999.0;
    float sampleDepth = 1.0;
    vec3 refPos = vec3(0.0);
    vec3 rfragpos = vec3(0.0);
    for (int i = 0; i < 30; i++) {
      vec4 clip = uViewProj * vec4(rayPos, 1.0);
      if (clip.w <= 0.0) break;
      refPos = clip.xyz / clip.w * 0.5 + 0.5;
      if (abs(refPos.x - 0.5) > rEdge.x || abs(refPos.y - 0.5) > rEdge.y) break;

      sampleDepth = texture(uSceneDepth, refPos.xy).r;
      vec4 unproj = uInvViewProj * vec4(refPos.xy * 2.0 - 1.0, sampleDepth * 2.0 - 1.0, 1.0);
      rfragpos = unproj.xyz / unproj.w;

      err = length(rayPos - rfragpos);
      if (err * 0.33333 < length(vector)) {
        sr++;
        if (sr >= 6) break;
        tvector -= vector;
        vector *= 0.1;
      }
      vector *= 2.0;
      tvector += vector * (0.95 + 0.1 * dither);
      rayPos = start + tvector;
    }
    float lViewPosRT = length(rfragpos);
    float reflAlpha = 0.0;
    vec3 sceneRefl = vec3(0.0);
    bool possibleReflection = dot(normalize(rfragpos - start), geoNormal) > 0.0;
    if (sampleDepth < 1.0 && possibleReflection && err * (1.0 - fresnel) < 1.0 + lViewPosRT * 0.2) {
      vec2 absPos = abs(refPos.xy - 0.5);
      vec2 cdist = absPos / rEdge;
      reflAlpha = clamp(1.0 - pow(max(cdist.x, cdist.y), 50.0), 0.0, 1.0);
      if (uDebug == 16) {
        fragColor = vec4(reflAlpha, err, sampleDepth, 1.0);
        return;
      }
      if (reflAlpha > 0.001) {
        vec2 edgeFactor = skyPow2(skyPow2(skyPow2(cdist)));
        refPos.y += (dither - 0.5) * (0.05 * (edgeFactor.x + edgeFactor.y));
        sceneRefl = texture(uSceneColor, refPos.xy).rgb;
        edgeFactor.x = skyPow2(edgeFactor.x);
        edgeFactor = vec2(1.0) - edgeFactor;
        float lum = dot(sceneRefl, vec3(0.299, 0.587, 0.114));
        reflAlpha *= pow(edgeFactor.x * edgeFactor.y, 2.0 + 3.0 * lum);
      }
      reflAlpha *= clamp(lViewPosRT - lViewPos + 3.0, 0.0, 1.0);
    } else if (uDebug == 16) {
      fragColor = vec4(0.0, err, sampleDepth, 1.0);
      return;
    }

    // AddBackgroundReflection: GetSky in the reflected direction * GetSkyLightFactor, plus the
    // WATER_STYLE 1 GGX highlight (gbuffers_water.glsl Step 4 + ggx.glsl).
    vec3 reflDir = normalize(reflect(nViewPos, normalM));
    float lmY = min(((vLight.x + 0.5) / 16.0) * 1.07, 1.0);
    float skyLightFactor = max(lmY - 0.7, 0.0) * 3.33333;
    skyLightFactor *= skyLightFactor;
    // shadowMult on water is 1.0, so the pack's max() term is a constant 0.333333.
    skyLightFactor = max(skyLightFactor, 0.333333);
    vec3 skyBase = complementSky(reflDir, dither, true, true);
    if (uSkyReflectEffects == 1) skyBase += skyReflectionEffects(reflDir, dither);
    vec3 skyRefl = skyBase * skyLightFactor;
    if (uDebug == 20) { fragColor = vec4(skyBase.r, skyRefl.r, 0.0, 1.0); return; }

    float highlightMult = min(skyPow2(skyPow2(dot(tex.rgb, tex.rgb) * 0.4)), 0.5);
    highlightMult *= (16.0 - 15.0 * fresnel2) * (uSunVisibility > 0.5 ? 0.85 : 0.425);
    float NdotLmax0 = max(dot(normalM, uSunWorldDir), 0.0);
    float specular = ggx(normalM, geoNormal, nViewPos, uSunWorldDir, NdotLmax0, 0.5);
    skyRefl += specular * uHighlightColor * highlightMult * uInvRainFactor;

    vec3 reflection = mix(skyRefl, sceneRefl, reflAlpha);
    float reflectMult = 0.5 + 0.5 * max(geoNormal.y, 0.0);   // water.glsl Step 4
    float fresnelM = (skyPow3(fresnel) * 0.85 + 0.15) * reflectMult;
    color = mix(color, reflection, fresnelM);

    // Water alpha (water.glsl Step 3 + Step 4): sqrt1 of the sprite alpha, distance-based water
    // fog opacity, then fade to opaque at grazing angles.
    vec2 screenUV = gl_FragCoord.xy / uResolution;
    float depthT = texture(uSceneDepth, screenUV).r;
    vec4 unprojT = uInvViewProj * vec4(screenUV * 2.0 - 1.0, depthT * 2.0 - 1.0, 1.0);
    float lViewPosT = length(unprojT.xyz / unprojT.w - uCameraPos);
    float waterFog = max(0.0, 1.0 - exp((lViewPos - lViewPosT) * 0.075));
    alpha = skySqrt1(tex.a) * (0.25 + 0.75 * waterFog);
    alpha = mix(alpha, 1.0, fresnel4);

    // Refraction (refraction.glsl DoRefraction, DETAIL_QUALITY >= 3). The pack runs this in
    // composite with the opaque colortex behind the water; the forward pass reproduces the
    // same result by replacing the background under the water with the refracted sample and
    // compositing the water colour over it as an opaque pixel.
    if (uRefraction == 1) {
      float depth1 = texture(uSceneDepth, screenUV).r;
      if (depth1 < 1.0) {
        // GetApproxDistance(depth) = near * far / (far - depth * far)
        float approx0 = uNear * uFar / (uFar - gl_FragCoord.z * uFar);
        float approx1 = uNear * uFar / (uFar - depth1 * uFar);
        float depthDif = clamp(approx1 - approx0, 0.0, 1.0);
        vec2 worldPosRM = vWorldPos.xz * 0.02 + vWorldPos.y * 0.01 + 0.01 * uWaveTime;
        vec2 refractNoise = texture(uNoise, worldPosRM).rb - vec2(0.5);
        refractNoise *= uRefractionIntensity * uProjScale / (3.0 + lViewPos);
        refractNoise *= 0.015;               // WATER_STYLE < 3
        refractNoise *= depthDif;
        vec3 refracted = texture(uSceneColor, screenUV + refractNoise).rgb;
        color = mix(refracted, color, alpha);
        alpha = 1.0;
      }
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
