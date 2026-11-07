// GLSL for the batched entity pass. Vertex layout (stride 8 floats = 32 bytes):
//   0: aPos  vec3  world position
//   1: aUV   vec2  texture UV (0..1)
//   2: aTint vec3  face shade * per-entity colour
//
// Kept in this directory (not Shaders.ts) because the entity subsystem owns
// its own program and must not touch the shared terrain shader file.

export const ENTITY_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec3 aTint;

uniform mat4 uViewProj;

out vec2 vUV;
out vec3 vTint;

void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUV = aUV;
  vTint = aTint;
}`;

export const ENTITY_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vTint;

uniform sampler2D uTex;
out vec4 fragColor;

void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.1) discard;
  fragColor = vec4(c.rgb * vTint, c.a);
}`;
