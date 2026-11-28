// GLSL for the batched entity pass. Vertex layout (stride 12 floats = 48 bytes):
//   0: aPos     vec3  world position
//   1: aUV      vec2  texture UV (0..1)
//   2: aTint    vec3  face shade * per-entity colour
//   3: aLight   vec2  (sky, block) light levels 0..15 — see note below
//   4: aOverlay vec2  (redness, alpha) — vanilla OverlayTexture hurt / white flash
//
// Light map: the shared 16x16 RGBA lightmap has x = BLOCK light, y = SKY light
// (core/lightmap.fsh), so the sample is aLight.yx exactly like the terrain pass.
// Overlay: net.minecraft.client.renderer.texture.OverlayTexture + core/entity.fsh
//   color.rgb = mix(overlayColor.rgb, color.rgb, overlayColor.a)
//   (v=3 row is 0xB2FF0000 -> red at 0.7; v=10 row is white fading along u)
// Fog: net.minecraft.client.renderer.fog.FogRenderer + shaders/include/fog.glsl
//   total_fog_value = max(linear(spherical, envStart, envEnd),
//                         linear(cylindrical, renderStart, renderEnd))
//   spherical = length(pos); cylindrical = max(length(pos.xz), abs(pos.y))
// where FogData comes from renderer/environment/FogState.ts (owned by the light
// package; it is the single source of truth for fog once LevelRenderer uses it).
//
// Kept in this directory (not Shaders.ts) because the entity subsystem owns
// its own program and must not touch the shared terrain shader file.

export const ENTITY_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec3 aTint;
layout(location = 3) in vec2 aLight;
layout(location = 4) in vec2 aOverlay;

uniform mat4 uViewProj;

out vec2 vUV;
out vec3 vTint;
out vec2 vLight;
out vec2 vOverlay;
out vec3 vWorldPos;

void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUV = aUV;
  vTint = aTint;
  vLight = aLight;
  vOverlay = aOverlay;
  vWorldPos = aPos;
}`;

export const ENTITY_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vTint;
in vec2 vLight;
in vec2 vOverlay;
in vec3 vWorldPos;

uniform sampler2D uTex;
uniform sampler2D uLightmap;
uniform vec3 uFogColor;
uniform float uFogEnvStart;
uniform float uFogEnvEnd;
uniform float uFogRenderStart;
uniform float uFogRenderEnd;
uniform vec3 uCameraPos;

out vec4 fragColor;

float linear_fog_value(float dist, float start, float end) {
  if (dist <= start) return 0.0;
  if (dist >= end) return 1.0;
  return (dist - start) / (end - start);
}

void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.1) discard;

  // lit albedo: texture * (face shade * entity tint)
  vec3 color = c.rgb * vTint;

  // hurt / white flash overlay (OverlayTexture.v = 3 / u = progress)
  vec3 overlayRgb = vec3(1.0, 1.0 - vOverlay.x, 1.0 - vOverlay.x);
  color = mix(overlayRgb, color, vOverlay.y);

  // vLight = (sky, block); the lightmap texture is x = block light, y = sky light
  vec2 lightUV = (vLight.yx + 0.5) / 16.0;
  color *= texture(uLightmap, lightUV).rgb;

  // vanilla fog.glsl total_fog_value
  vec3 d = vWorldPos - uCameraPos;
  float sphericalDistance = length(d);
  float cylindricalDistance = max(length(d.xz), abs(d.y));
  float fogValue = max(
    linear_fog_value(sphericalDistance, uFogEnvStart, uFogEnvEnd),
    linear_fog_value(cylindricalDistance, uFogRenderStart, uFogRenderEnd)
  );
  color = mix(color, uFogColor, fogValue);

  fragColor = vec4(color, c.a);
}`;

// ---------------------------------------------------------------------------
// Dropped block items (ItemEntityRenderer GROUND 3D models)
//
// ItemEntityRenderer.submit -> ItemStackRenderState.submit (GROUND) draws the
// real baked block model with the model's ground display transform. Vertex
// layout matches the hand pass (pos3 uv2 layer1 normal3) because the same
// buildBlockMesh geometry is reused; lighting is Lighting.Entry.LEVEL
// (shaders/include/light.glsl), the lightmap sample and fog match the entity
// pass above.
// ---------------------------------------------------------------------------

export const WORLD_ITEM_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aLayer;
layout(location = 3) in vec3 aNormal;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform vec3 uLight0;
uniform vec3 uLight1;

out vec2 vUV;
flat out float vLayer;
out float vShade;
out vec3 vWorldPos;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;
  vUV = aUV;
  vLayer = aLayer;
  vWorldPos = world.xyz;
  vec3 n = normalize(uNormalMat * aNormal);
  vec2 l = max(vec2(0.0), vec2(dot(uLight0, n), dot(uLight1, n)));
  vShade = min(1.0, (l.x + l.y) * 0.6 + 0.4);
}`;

export const WORLD_ITEM_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUV;
flat in float vLayer;
in float vShade;
in vec3 vWorldPos;

uniform sampler2DArray uAtlas;
uniform sampler2D uLightmap;
uniform vec2 uLightLevel;   // (sky, block) 0..15, sampled as (block, sky)
uniform vec3 uColor;
uniform float uAlphaTest;
uniform vec3 uFogColor;
uniform float uFogEnvStart;
uniform float uFogEnvEnd;
uniform float uFogRenderStart;
uniform float uFogRenderEnd;
uniform vec3 uCameraPos;

out vec4 fragColor;

float linear_fog_value(float dist, float start, float end) {
  if (dist <= start) return 0.0;
  if (dist >= end) return 1.0;
  return (dist - start) / (end - start);
}

void main() {
  vec4 tex = texture(uAtlas, vec3(vUV, vLayer));
  if (tex.a < uAlphaTest) discard;

  vec3 color = tex.rgb * vShade * uColor;
  color *= texture(uLightmap, (uLightLevel.yx + 0.5) / 16.0).rgb;

  vec3 d = vWorldPos - uCameraPos;
  float sphericalDistance = length(d);
  float cylindricalDistance = max(length(d.xz), abs(d.y));
  float fogValue = max(
    linear_fog_value(sphericalDistance, uFogEnvStart, uFogEnvEnd),
    linear_fog_value(cylindricalDistance, uFogRenderStart, uFogRenderEnd)
  );
  color = mix(color, uFogColor, fogValue);

  fragColor = vec4(color, tex.a);
}`;

// ---------------------------------------------------------------------------
// Entity shadows (net.minecraft.client.renderer.feature.ShadowFeatureRenderer,
// textures/misc/shadow.png). One flat textured quad per block under the entity.
// ---------------------------------------------------------------------------

export const SHADOW_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aAlpha;

uniform mat4 uViewProj;

out vec2 vUV;
out float vAlpha;

void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUV = aUV;
  vAlpha = aAlpha;
}`;

export const SHADOW_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
in float vAlpha;

uniform sampler2D uTex;

out vec4 fragColor;

void main() {
  float a = texture(uTex, vUV).a * vAlpha;
  if (a < 0.01) discard;
  fragColor = vec4(0.0, 0.0, 0.0, a);
}`;

