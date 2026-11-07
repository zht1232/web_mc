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

out vec2 vUV;
flat out uint vLayer;
out vec2 vLight;
out vec4 vColor;
out float vFogDepth;
out vec3 vWorldPos;

void main() {
  vec3 world = aPos + uChunkOrigin;
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
uniform float uFogStart;
uniform float uFogEnd;
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
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uShadowTexel;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uAtlas, vec3(vUV, float(vLayer)));
  if (uDebug == 1) { fragColor = vec4(vColor.rgb, 1.0); return; }
  if (uDebug == 2) { fragColor = vec4(vUV, float(vLayer) / 64.0, 1.0); return; }
  if (uDebug == 3) { fragColor = vec4(tex.rgb, 1.0); return; }
  if (uDebug == 4) { fragColor = vec4(vLight / 15.0, 0.0, 1.0); return; }
  if (tex.a < uAlphaTest) discard;

  // vLight = (sky, block); the lightmap texture is x = block light, y = sky light (core/lightmap.fsh)
  vec2 lightUV = (vLight.yx + 0.5) / 16.0;
  vec3 light = texture(uLightmap, lightUV).rgb;
  if (uDebug == 9) { fragColor = vec4(light, 1.0); return; }
  if (uDebug == 10) { fragColor = vec4(vColor.rgb, 1.0); return; }

  vec3 color = tex.rgb * vColor.rgb * light;
  float alpha = tex.a * (uTranslucent > 0.5 ? vColor.a : 1.0);

  // Direct sun / moon with a PCF shadow term. Only active in shader mode; translucent water
  // receives the lightmap result (it does not cast into the shadow map either).
  if (uUseShadows == 1 && uTranslucent < 0.5) {
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float ndl = max(dot(n, uSunDir), 0.0);
    if (uDebug == 12) { fragColor = vec4(n * 0.5 + 0.5, 1.0); return; }
    if (uDebug == 13) { fragColor = vec4(vec3(ndl), 1.0); return; }
    if (ndl > 0.0) {
      // slope-scaled, world-space normal offset + a small constant depth bias
      float slope = clamp(1.0 - ndl, 0.0, 1.0);
      vec4 sc = uLightViewProj * vec4(vWorldPos + n * (0.05 + 0.25 * slope), 1.0);
      vec3 ndc = sc.xyz / max(sc.w, 1e-5);
      vec2 suv = ndc.xy * 0.5 + 0.5;
      float sdepth = ndc.z * 0.5 + 0.5;
      float lit = 1.0;
      if (sc.w > 0.0 && suv.x > 0.004 && suv.x < 0.996 && suv.y > 0.004 && suv.y < 0.996) {
        // 3x3 PCF, manual depth compare (see the sampler note above); 1.5 texel spacing gives a
        // wider penumbra than the raw map resolution.
        float ref = sdepth - 0.0006;
        float sum = 0.0;
        for (int sx = -1; sx <= 1; sx++) {
          for (int sy = -1; sy <= 1; sy++) {
            float stored = texture(uShadowMap, suv + vec2(sx, sy) * uShadowTexel * 1.5).r;
            sum += ref <= stored ? 1.0 : 0.0;
          }
        }
        lit = sum / 9.0;
      }
      if (uDebug == 11) { fragColor = vec4(vec3(lit), 1.0); return; }
      // deep shade / caves keep the lightmap value only, like the vanilla direct term
      float skyMask = smoothstep(0.0, 0.55, vLight.y / 15.0);
      color += tex.rgb * vColor.rgb * uSunColor * ndl * lit * skyMask;
    }
  }

  // cylindrical fog like vanilla (max of horizontal distance and vertical distance)
  vec3 d = vWorldPos - uCameraPos;
  float dist = max(length(d.xz), abs(d.y));
  float fog = clamp((dist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
  color = mix(color, uFogColor, fog * fog);

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
void main() {
  gl_Position = uViewProj * vec4(aPos + uOffset, 1.0);
}`;

export const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;
