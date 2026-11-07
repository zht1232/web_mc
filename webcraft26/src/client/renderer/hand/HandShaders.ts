// GLSL for the first-person hand pass and the block-breaking decal.
//
// The lit path reproduces the vanilla entity/item vertex lighting:

//   minecraft/assets/minecraft/shaders/include/light.glsl
//     MINECRAFT_LIGHT_POWER = 0.6, MINECRAFT_AMBIENT_LIGHT = 0.4
//     lightAccum = min(1, (max(0,dot(L0,N)) + max(0,dot(L1,N))) * 0.6 + 0.4)
//   com/mojang/blaze3d/platform/Lighting.java
//     LEVEL: L0 = normalize(0.2, 1, -0.7), L1 = normalize(-0.2, 1, 0.7)
//   core/lightmap.fsh -> texture(uLightmap, (block, sky)/16)
//
// uMode: 0 = 2D lit (Steve skin), 1 = texture-array lit (blocks / item sprites),
//        2 = 2D unlit (underwater screen effect), 3 = texture-array unlit (destroy stages).

export const HAND_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aLayer;
layout(location = 3) in vec3 aNormal;

uniform mat4 uProjModel;
uniform mat3 uNormalMat;
uniform vec3 uLight0;
uniform vec3 uLight1;

out vec2 vUV;
flat out float vLayer;
out float vShade;

void main() {
  gl_Position = uProjModel * vec4(aPos, 1.0);
  vUV = aUV;
  vLayer = aLayer;
  vec3 n = normalize(uNormalMat * aNormal);
  vec2 l = max(vec2(0.0), vec2(dot(uLight0, n), dot(uLight1, n)));
  vShade = min(1.0, (l.x + l.y) * 0.6 + 0.4);
}`;

export const HAND_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUV;
flat in float vLayer;
in float vShade;

uniform sampler2D uTex2D;
uniform sampler2DArray uAtlas;
uniform sampler2D uLightmap;
uniform vec2 uLightLevel;   // (sky, block) 0..15, sampled as (block, sky) like the terrain pass
uniform vec4 uColor;
uniform int uMode;
uniform float uAlphaTest;

out vec4 fragColor;

void main() {
  vec4 tex;
  if (uMode == 0 || uMode == 2) {
    tex = texture(uTex2D, vUV);
  } else {
    tex = texture(uAtlas, vec3(vUV, vLayer));
  }
  if (tex.a < uAlphaTest) discard;

  if (uMode >= 2) {
    fragColor = tex * uColor;
    return;
  }

  vec3 light = texture(uLightmap, (uLightLevel.yx + 0.5) / 16.0).rgb;
  fragColor = vec4(tex.rgb * vShade * light * uColor.rgb, tex.a * uColor.a);
}`;
