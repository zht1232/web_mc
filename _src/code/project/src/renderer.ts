import type { LoadedAssets } from './assets.js';
import type { BlockRegistry } from './blocks.js';
import type { World } from './world.js';
import { buildChunkMesh, disposeMesh, type ChunkMesh } from './mesher.js';
import { ShaderProgram } from './gl.js';
import { PostFX } from './postfx.js';
import { basisFromYawPitch, clamp, hexToRgb, invert, lookAt, mat4, multiply, ortho, perspective, rotationX, rotationY, rotationZ, scaling, translation, viewFromYawPitch, smoothstep } from './math.js';

const CHUNK_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in float aLayer;
layout(location=3) in float aAnim;
layout(location=4) in vec2 aLight;
layout(location=5) in float aAo;
layout(location=6) in vec3 aTint;
layout(location=7) in float aShade;
layout(location=8) in vec3 aNormal;
uniform mat4 uViewProj;
uniform int uAnimFrames[8];
out vec2 vUv;
out vec2 vLight;
out float vAo;
out vec3 vTint;
out float vShade;
out vec3 vWorld;
out vec3 vNormal;
flat out int vLayer;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUv = aUv;
  vLight = aLight;
  vAo = aAo;
  vTint = aTint;
  vShade = aShade;
  vWorld = aPos;
  vNormal = aNormal;
  int layer = int(aLayer + 0.5);
  if (aAnim >= 0.0) layer = uAnimFrames[int(aAnim + 0.5)];
  vLayer = layer;
}`;

const CHUNK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform vec3 uCam;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uAlphaCutoff;
uniform vec3 uAmbientColor;
uniform vec3 uSkyLightColor;
uniform vec3 uBlockLightColor;
uniform float uSkyFactor;
uniform float uBlockFactor;
uniform float uGamma;
uniform sampler2D uShadowMap;
uniform mat4 uLightVP;
uniform float uShadowStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTopColor;
uniform vec3 uSkyHorizonColor;
uniform float uTime;
uniform int uWaterLayer;
uniform int uDebugMode;
in vec2 vUv;
in vec2 vLight;
in float vAo;
in vec3 vTint;
in float vShade;
in vec3 vWorld;
in vec3 vNormal;
flat in int vLayer;
out vec4 outColor;

float curve(float l) { return l / (4.0 - 3.0 * l); }
vec3 notGamma(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m <= 0.0001) return c;
  return c * (1.0 - pow(1.0 - m, 4.0)) / m;
}
float sunShadow(vec3 world, vec3 normal) {
  if (uShadowStrength <= 0.0) return 1.0;
  vec4 sp = uLightVP * vec4(world + normal * 0.08, 1.0);
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x <= 0.001 || p.x >= 0.999 || p.y <= 0.001 || p.y >= 0.999 || p.z <= 0.0 || p.z >= 1.0) return 1.0;
  float ndl = max(dot(normalize(normal), normalize(uSunDir)), 0.0);
  float bias = mix(0.0018, 0.0005, ndl);
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float d = texture(uShadowMap, p.xy + vec2(float(x), float(y)) * texel).r;
      lit += p.z - bias <= d ? 1.0 : 0.0;
    }
  }
  return lit / 9.0;
}
void main() {
  vec4 tex = texture(uTex, vec3(vUv, float(vLayer)));
  if (tex.a < uAlphaCutoff) discard;
  vec3 texColor = tex.a > 0.0001 ? tex.rgb / tex.a : vec3(0.0);
  if (uDebugMode == 1) { outColor = vec4(texColor * vTint, 1.0); return; }
  if (uDebugMode == 2) { outColor = vec4(vec3(vAo), 1.0); return; }
  if (uDebugMode == 3) { outColor = vec4(vNormal * 0.5 + 0.5, 1.0); return; }
  float shadow = mix(1.0, sunShadow(vWorld, vNormal), uShadowStrength);
  vec3 skyTerm = uSkyLightColor * curve(vLight.x) * uSkyFactor * mix(0.32, 1.0, shadow);
  vec3 light = uAmbientColor
    + skyTerm
    + uBlockLightColor * curve(vLight.y) * uBlockFactor;
  light = clamp(light, 0.0, 1.0);
  light = mix(light, notGamma(light), uGamma);
  vec3 c = texColor * vTint * light * vShade * vAo;
  float alpha = tex.a;
  if (uWaterLayer >= 0 && vLayer == uWaterLayer) {
    vec2 wuv = vUv * 2.0;
    vec2 drift = vec2(uTime * 0.012, uTime * 0.008);
    vec2 uvA = wuv + drift;
    vec2 uvB = wuv - drift.yx;
    float e = 0.045;
    float hL = texture(uTex, vec3(uvA - vec2(e, 0.0), float(vLayer))).r;
    float hR = texture(uTex, vec3(uvA + vec2(e, 0.0), float(vLayer))).r;
    float hD = texture(uTex, vec3(uvB - vec2(0.0, e), float(vLayer))).r;
    float hU = texture(uTex, vec3(uvB + vec2(0.0, e), float(vLayer))).r;
    vec3 wn = normalize(vec3((hL - hR) * 2.2, 1.0, (hD - hU) * 2.2));
    vec3 V = normalize(uCam - vWorld);
    float ndv = clamp(dot(wn, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 4.0);
    vec3 reflected = reflect(-V, wn);
    vec3 reflColor = mix(uSkyHorizonColor, uSkyTopColor, clamp(reflected.y, 0.0, 1.0));
    c = mix(c, reflColor, fres * 0.34);
    vec3 hv = normalize(uSunDir + V);
    float spec = pow(max(dot(wn, hv), 0.0), 220.0);
    c += uSunColor * spec * shadow * max(uSunDir.y, 0.0) * 0.45;
    alpha = mix(alpha, 1.0, fres * 0.28);
  }
  float dist = length(vWorld - uCam);
  float fog = clamp((dist - uFogStart) / max(1.0, uFogEnd - uFogStart), 0.0, 1.0);
  c = mix(c, uFogColor, fog);
  outColor = vec4(c, alpha);
}`;

const SKY_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  vNdc = pos[gl_VertexID];
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform float uStarAlpha;
in vec2 vNdc;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCam);
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(up, 0.55));
  if (dir.y < 0.0) c = uSkyHorizon;
  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  c += uSunGlow * pow(sun, 320.0);
  if (uStarAlpha > 0.01 && dir.y > 0.02) {
    vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
    vec2 grid = sph * vec2(90.0, 45.0);
    vec2 id = floor(grid);
    vec2 f = fract(grid);
    float h = hash21(id);
    float star = step(0.986, h) * smoothstep(0.18, 0.0, length(f - 0.5));
    c += vec3(0.9, 0.95, 1.0) * star * uStarAlpha;
  }
  outColor = vec4(c, 1.0);
}`;

const SHADOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in float aLayer;
layout(location=3) in float aAnim;
uniform mat4 uLightVP;
uniform int uAnimFrames[8];
out vec2 vUv;
flat out int vLayer;
void main() {
  gl_Position = uLightVP * vec4(aPos, 1.0);
  vUv = aUv;
  int layer = int(aLayer + 0.5);
  if (aAnim >= 0.0) layer = uAnimFrames[int(aAnim + 0.5)];
  vLayer = layer;
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uAlphaCutoff;
in vec2 vUv;
flat in int vLayer;
out vec4 outColor;
void main() {
  float a = texture(uTex, vec3(vUv, float(vLayer))).a;
  if (a < uAlphaCutoff) discard;
  outColor = vec4(1.0);
}`;

const TEXTURED_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
uniform mat4 uViewProj;
out vec2 vUv;
out vec3 vWorld;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUv = aUv;
  vWorld = aPos;
}`;

const CELESTIAL_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uColor;
in vec2 vUv;
in vec3 vWorld;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUv);
  outColor = vec4(t.rgb * uColor.rgb, t.a * uColor.a);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uColor;
uniform vec3 uCam;
uniform float uFadeEnd;
in vec2 vUv;
in vec3 vWorld;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUv);
  if (t.a < 0.02) discard;
  float dist = length(vWorld - uCam);
  float fade = 1.0 - smoothstep(uFadeEnd * 0.55, uFadeEnd, dist);
  outColor = vec4(t.rgb * uColor.rgb, t.a * uColor.a * fade);
}`;

const VIEWMODEL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in float aLayer;
layout(location=3) in vec3 aColor;
uniform mat4 uProj;
uniform mat4 uModel;
out vec2 vUv;
out vec3 vColor;
flat out int vLayer;
void main() {
  gl_Position = uProj * uModel * vec4(aPos, 1.0);
  vUv = aUv;
  vColor = aColor;
  vLayer = int(aLayer + 0.5);
}`;

const VIEWMODEL_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uAlphaCutoff;
in vec2 vUv;
in vec3 vColor;
flat in int vLayer;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vec3(vUv, float(vLayer)));
  if (t.a < uAlphaCutoff) discard;
  vec3 c = (t.a > 0.0001 ? t.rgb / t.a : vec3(0.0)) * vColor;
  outColor = vec4(c, t.a);
}`;

const HAND_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uProj;
uniform mat4 uModel;
out vec3 vColor;
void main() {
  gl_Position = uProj * uModel * vec4(aPos, 1.0);
  vColor = aColor;
}`;

const HAND_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
void main() { gl_Position = uViewProj * vec4(uOrigin + (aPos - 0.5) * 1.004 + 0.5, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const VIEW_FACE_LIGHT = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

interface DrawStats { chunks: number; translucent: number; triangles: number; }

export interface RenderTarget { x: number; y: number; z: number; }

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly assets: LoadedAssets;
  readonly rocks: BlockRegistry;
  readonly meshes = new Map<string, ChunkMesh>();
  readonly drawStats: DrawStats = { chunks: 0, translucent: 0, triangles: 0 };

  private chunkProgram: ShaderProgram;
  private skyProgram: ShaderProgram;
  private celestialProgram: ShaderProgram;
  private cloudProgram: ShaderProgram;
  private lineProgram: ShaderProgram;
  private shadowProgram: ShaderProgram;
  private viewProgram: ShaderProgram;
  private handProgram: ShaderProgram;
  private viewVao: WebGLVertexArrayObject | null = null;
  private viewVbo: WebGLBuffer | null = null;
  private viewCount = 0;
  private viewMeshFor = -1;
  private handVao: WebGLVertexArrayObject;
  private handVbo: WebGLBuffer;
  private handCount = 0;
  private heldId = 0;
  private viewVisible = true;
  private viewTouch = false;
  private swingStart = -1;
  private viewSpeed = 0;
  private viewGround = true;
  private bobPhase = 0;
  private lastViewTime = 0;
  private shadowFbo: WebGLFramebuffer | null = null;
  private shadowTex: WebGLTexture | null = null;
  private shadowSize = 2048;
  private shadowVP = mat4();
  private shadowReady = false;
  shadowEnabled = true;
  private shadowStrength = 0;
  private postfx: PostFX;
  private usePost = true;
  private extraWorldRenderer: ((gl: WebGL2RenderingContext, vp: Float32Array, eye: [number, number, number], elapsed: number, day: number) => void) | null = null;
  private skyVao: WebGLVertexArrayObject;
  private celestialVao: WebGLVertexArrayObject;
  private celestialVbo: WebGLBuffer;
  private cloudVao: WebGLVertexArrayObject;
  private cloudVbo: WebGLBuffer;
  private lineVao: WebGLVertexArrayObject;
  private sunTex: WebGLTexture;
  private moonTex: WebGLTexture;
  private cloudTex: WebGLTexture;
  private animFrames = new Int32Array(8);
  private frameTime = 0;
  private view = mat4();
  private proj = mat4();
  private vp = mat4();
  private invVp = mat4();
  private eye = [0, 0, 0];
  private yaw = 0;
  private pitch = 0;
  private frustum = new Float32Array(24);
  private debugMode = 0;
  private fov = 70;

  constructor(gl: WebGL2RenderingContext, assets: LoadedAssets, rocks: BlockRegistry) {
    this.gl = gl;
    this.assets = assets;
    this.rocks = rocks;
    this.chunkProgram = new ShaderProgram(gl, CHUNK_VS, CHUNK_FS);
    this.skyProgram = new ShaderProgram(gl, SKY_VS, SKY_FS);
    this.celestialProgram = new ShaderProgram(gl, TEXTURED_VS, CELESTIAL_FS);
    this.cloudProgram = new ShaderProgram(gl, TEXTURED_VS, CLOUD_FS);
    this.lineProgram = new ShaderProgram(gl, LINE_VS, LINE_FS);
    this.shadowProgram = new ShaderProgram(gl, SHADOW_VS, SHADOW_FS);
    this.viewProgram = new ShaderProgram(gl, VIEWMODEL_VS, VIEWMODEL_FS);
    this.handProgram = new ShaderProgram(gl, HAND_VS, HAND_FS);
    this.handVao = gl.createVertexArray()!;
    this.handVbo = gl.createBuffer()!;
    this.buildHandMesh();
    this.createShadowMap();
    this.postfx = new PostFX(gl);
    this.postfx.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);

    this.skyVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.skyVao);

    const cVao = gl.createVertexArray()!;
    const cVbo = gl.createBuffer()!;
    gl.bindVertexArray(cVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    this.celestialVao = cVao;
    this.celestialVbo = cVbo;

    const clVao = gl.createVertexArray()!;
    const clVbo = gl.createBuffer()!;
    gl.bindVertexArray(clVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, clVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    this.cloudVao = clVao;
    this.cloudVbo = clVbo;

    const edges: number[] = [];
    const corners = [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
      [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
    ];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
      edges.push(...corners[a], ...corners[b]);
    }
    const lVao = gl.createVertexArray()!;
    gl.bindVertexArray(lVao);
    const lVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, lVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edges), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    this.lineVao = lVao;

    this.sunTex = this.imageTexture(assets.env.sun, gl.NEAREST);
    this.moonTex = this.imageTexture(assets.env.moon, gl.NEAREST);
    this.cloudTex = this.imageTexture(assets.env.clouds, gl.LINEAR);
    gl.bindVertexArray(null);
  }

  private createShadowMap(): void {
    const gl = this.gl;
    try {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0,
        gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('shadow framebuffer incomplete', status);
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fbo);
        return;
      }
      this.shadowTex = tex;
      this.shadowFbo = fbo;
      this.shadowReady = true;
    } catch (err) {
      console.warn('shadow mapping unavailable', err);
      this.shadowReady = false;
    }
  }

  setShadowQuality(enabled: boolean, size = 2048): void {
    this.shadowEnabled = enabled;
    const next = Math.max(512, Math.min(4096, size));
    if (next === this.shadowSize && this.shadowReady) return;
    this.shadowSize = next;
    if (this.shadowFbo) this.gl.deleteFramebuffer(this.shadowFbo);
    if (this.shadowTex) this.gl.deleteTexture(this.shadowTex);
    this.shadowFbo = null;
    this.shadowTex = null;
    this.shadowReady = false;
    if (enabled) this.createShadowMap();
  }

  private updateFrustum(): void {
    const m = this.vp;
    const f = this.frustum;
    f[0] = m[0] + m[3]; f[1] = m[4] + m[7]; f[2] = m[8] + m[11]; f[3] = m[12] + m[15];
    f[4] = m[3] - m[0]; f[5] = m[7] - m[4]; f[6] = m[11] - m[8]; f[7] = m[15] - m[12];
    f[8] = m[1] + m[3]; f[9] = m[5] + m[7]; f[10] = m[9] + m[11]; f[11] = m[13] + m[15];
    f[12] = m[3] - m[1]; f[13] = m[7] - m[5]; f[14] = m[11] - m[9]; f[15] = m[15] - m[13];
    f[16] = m[2] + m[3]; f[17] = m[6] + m[7]; f[18] = m[10] + m[11]; f[19] = m[14] + m[15];
    f[20] = m[3] - m[2]; f[21] = m[7] - m[6]; f[22] = m[11] - m[10]; f[23] = m[15] - m[14];
  }

  private chunkVisible(x: number, z: number): boolean {
    const f = this.frustum;
    const y0 = -64, y1 = 180;
    for (let p = 0; p < 24; p += 4) {
      const a = f[p], b = f[p + 1], c = f[p + 2], d = f[p + 3];
      const px = a >= 0 ? x + 16 : x;
      const py = b >= 0 ? y1 : y0;
      const pz = c >= 0 ? z + 16 : z;
      if (a * px + b * py + c * pz + d < 0) return false;
    }
    return true;
  }

  private renderShadowMap(world: World, sunDir: number[], day: number, elapsed: number): void {
    const gl = this.gl;
    const strength = this.shadowEnabled && this.shadowReady ? smoothstep(0.04, 0.22, sunDir[1]) * 0.9 : 0;
    this.shadowStrength = strength;
    if (strength <= 0.01 || !this.shadowFbo || !this.shadowTex) return;
    const centerX = this.eye[0], centerZ = this.eye[2];
    const radius = 86;
    const light = [centerX + sunDir[0] * 170, this.eye[1] + sunDir[1] * 170, centerZ + sunDir[2] * 170];
    const up = Math.abs(sunDir[1]) > 0.96 ? [0, 0, 1] : [0, 1, 0];
    const lightView = mat4();
    lookAt(lightView, light[0], light[1], light[2], centerX, this.eye[1], centerZ, up[0], up[1], up[2]);
    const lightProj = ortho(mat4(), -radius, radius, -radius, radius, 1, 380);
    multiply(this.shadowVP, lightProj, lightView);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.2, 2.5);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    this.shadowProgram.use();
    this.shadowProgram.mat4('uLightVP', this.shadowVP);
    this.updateAnimFrames(elapsed);
    this.shadowProgram.intArray('uAnimFrames', this.animFrames);
    this.shadowProgram.f('uAlphaCutoff', 0.3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.assets.texArray);
    this.shadowProgram.i('uTex', 0);
    const r2 = (radius + 24) * (radius + 24);
    for (const c of world.chunks.values()) {
      const dx = c.cx * 16 + 8 - centerX, dz = c.cz * 16 + 8 - centerZ;
      if (dx * dx + dz * dz > r2) continue;
      const mesh = this.meshes.get(`${c.cx},${c.cz}`);
      if (!mesh?.solid) continue;
      gl.bindVertexArray(mesh.solid.vao);
      gl.drawElements(gl.TRIANGLES, mesh.solid.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.cullFace(gl.BACK);
  }

  private imageTexture(img: ImageBitmap, filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  async buildAll(world: World, progress: (f: number, label: string) => void): Promise<void> {
    const chunks = [...world.chunks.values()].sort((a, b) => (a.cx * a.cx + a.cz * a.cz) - (b.cx * b.cx + b.cz * b.cz));
    const total = chunks.length;
    let done = 0;
    for (const c of chunks) {
      this.buildChunk(world, c.cx, c.cz);
      done++;
      if (done % 4 === 0 || done === total) {
        progress(0.93 + 0.07 * (done / total), `Building meshes ${done}/${total}`);
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  buildChunk(world: World, cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const old = this.meshes.get(key);
    if (old) { disposeMesh(this.gl, old); this.meshes.delete(key); }
    const mesh = buildChunkMesh(this.gl, world, this.rocks, cx, cz);
    this.meshes.set(key, mesh);
  }

  invalidate(cx: number, cz: number, world: World): void {
    this.invalidateArea(cx, cz, world, 1);
  }

  invalidateArea(cx: number, cz: number, world: World, radius: number): void {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (world.chunkAt(cx + dx, cz + dz)) this.buildChunk(world, cx + dx, cz + dz);
      }
    }
  }

  setViewport(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
    this.postfx.resize(width, height);
  }

  setPostQuality(bloom: boolean, rays: boolean): void {
    this.postfx.bloomEnabled = bloom;
    this.postfx.raysEnabled = rays;
  }

  setPostEnabled(enabled: boolean): void {
    this.usePost = enabled;
    if (!enabled) this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  render(world: World, eyeX: number, eyeY: number, eyeZ: number, yaw: number, pitch: number,
    target: RenderTarget | null, worldTicks: number, elapsed: number, renderDistance: number): void {
    const gl = this.gl;
    this.eye = [eyeX, eyeY, eyeZ];
    this.yaw = yaw;
    this.pitch = pitch;
    this.frameTime = elapsed;
    const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
    perspective(this.proj, (this.fov * Math.PI) / 180, aspect, 0.05, 512);
    viewFromYawPitch(this.view, yaw, pitch, eyeX, eyeY, eyeZ);
    multiply(this.vp, this.proj, this.view);
    invert(this.invVp, this.vp);
    this.updateFrustum();

    const time = ((worldTicks % 24000) + 24000) % 24000;
    const angle = (time / 24000) * Math.PI * 2;
    const sunDir: [number, number, number] = [Math.cos(angle), Math.sin(angle), 0.18];
    const sl = Math.hypot(...sunDir);
    sunDir[0] /= sl; sunDir[1] /= sl; sunDir[2] /= sl;
    const day = smoothstep(-0.16, 0.16, sunDir[1]);
    const skyTop = hexToRgb('#78a7ff').map(v => v * day) as [number, number, number];
    const fogDay = hexToRgb('#c0d8ff');
    const fogNight = hexToRgb('#0c0c16');
    const horizon: [number, number, number] = [
      fogNight[0] + (fogDay[0] - fogNight[0]) * day,
      fogNight[1] + (fogDay[1] - fogNight[1]) * day,
      fogNight[2] + (fogDay[2] - fogNight[2]) * day,
    ];
    const sunset = Math.exp(-Math.pow(sunDir[1] / 0.22, 2)) * (0.35 + 0.65 * (1 - day));
    const sunsetCol = hexToRgb('#da6333');
    for (let i = 0; i < 3; i++) horizon[i] = horizon[i] * (1 - sunset * 0.25) + sunsetCol[i] * sunset * 0.5;

    this.renderShadowMap(world, sunDir, day, elapsed);

    const eyeBlock = world.getBlock(Math.floor(eyeX), Math.floor(eyeY), Math.floor(eyeZ));
    const underwater = eyeBlock !== 0 && this.rocks.byName.get('water')?.id === eyeBlock;
    let fogColor: [number, number, number] = horizon;
    let fogStart = renderDistance * 16 * 0.88;
    let fogEnd = renderDistance * 16;
    if (underwater) {
      fogColor = hexToRgb('#050533');
      fogStart = 0;
      fogEnd = Math.min(96, renderDistance * 16);
    }

    let sunScreen: [number, number] = [0.5, 0.5];
    let sunVisibility = 0;
    if (!underwater && sunDir[1] > -0.02) {
      const sx = eyeX + sunDir[0] * 400, sy = eyeY + sunDir[1] * 400, sz = eyeZ + sunDir[2] * 400;
      const cx = this.vp[0] * sx + this.vp[4] * sy + this.vp[8] * sz + this.vp[12];
      const cy = this.vp[1] * sx + this.vp[5] * sy + this.vp[9] * sz + this.vp[13];
      const cw = this.vp[3] * sx + this.vp[7] * sy + this.vp[11] * sz + this.vp[15];
      if (cw > 0.0001) {
        const nx = cx / cw, ny = cy / cw;
        const edge = Math.max(Math.abs(nx), Math.abs(ny));
        if (edge < 1.35) {
          sunScreen = [nx * 0.5 + 0.5, ny * 0.5 + 0.5];
          sunVisibility = smoothstep(-0.04, 0.08, sunDir[1]) * (1 - smoothstep(1.0, 1.35, edge));
        }
      }
    }

    if (this.usePost) {
      this.postfx.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      this.postfx.begin();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    if (!underwater) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      this.skyProgram.use();
      this.skyProgram.mat4('uInvViewProj', this.invVp);
      this.skyProgram.v3('uCam', eyeX, eyeY, eyeZ);
      this.skyProgram.v3('uSkyTop', skyTop[0], skyTop[1], skyTop[2]);
      this.skyProgram.v3('uSkyHorizon', horizon[0], horizon[1], horizon[2]);
      this.skyProgram.v3('uSunDir', sunDir[0], sunDir[1], sunDir[2]);
      this.skyProgram.v3('uSunGlow', 0.14, 0.10, 0.04);
      this.skyProgram.f('uStarAlpha', smoothstep(-0.06, -0.35, sunDir[1]) * 0.8);
      gl.bindVertexArray(this.skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      this.drawCelestial(worldTicks, sunDir, day);
    }

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.chunkProgram.use();
    this.chunkProgram.mat4('uViewProj', this.vp);
    this.chunkProgram.v3('uCam', eyeX, eyeY, eyeZ);
    this.chunkProgram.v3('uFogColor', fogColor[0], fogColor[1], fogColor[2]);
    this.chunkProgram.f('uFogStart', fogStart);
    this.chunkProgram.f('uFogEnd', fogEnd);
    this.chunkProgram.f('uAlphaCutoff', 0.3);
    this.chunkProgram.v3('uAmbientColor', 12 / 255, 14 / 255, 19 / 255);
    const nightSkyLight = hexToRgb('#7a7aff');
    const daySkyLight = [1, 1, 1];
    this.chunkProgram.v3('uSkyLightColor',
      nightSkyLight[0] + (daySkyLight[0] - nightSkyLight[0]) * day,
      nightSkyLight[1] + (daySkyLight[1] - nightSkyLight[1]) * day,
      nightSkyLight[2] + (daySkyLight[2] - nightSkyLight[2]) * day);
    const blockLight = hexToRgb('#ffd88c');
    this.chunkProgram.v3('uBlockLightColor', blockLight[0], blockLight[1], blockLight[2]);
    this.chunkProgram.f('uSkyFactor', 0.24 + 0.76 * day);
    this.chunkProgram.f('uBlockFactor', 1.4);
    this.chunkProgram.f('uGamma', 0.5);
    this.chunkProgram.v3('uSunDir', sunDir[0], sunDir[1], sunDir[2]);
    this.chunkProgram.v3('uSunColor', 1.0, 0.92, 0.78);
    this.chunkProgram.v3('uSkyTopColor', skyTop[0], skyTop[1], skyTop[2]);
    this.chunkProgram.v3('uSkyHorizonColor', horizon[0], horizon[1], horizon[2]);
    this.chunkProgram.f('uTime', elapsed);
    this.chunkProgram.i('uWaterLayer', this.rocks.byName.get('water')?.fluidLayer ?? -1);
    this.chunkProgram.i('uDebugMode', this.debugMode);
    this.chunkProgram.f('uShadowStrength', this.shadowStrength);
    this.chunkProgram.mat4('uLightVP', this.shadowVP);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.assets.texArray);
    this.chunkProgram.i('uTex', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    this.chunkProgram.i('uShadowMap', 1);
    gl.activeTexture(gl.TEXTURE0);
    this.updateAnimFrames(elapsed);
    this.chunkProgram.intArray('uAnimFrames', this.animFrames);

    this.drawStats.chunks = 0;
    this.drawStats.translucent = 0;
    this.drawStats.triangles = 0;
    const maxDist = renderDistance * 16 + 20;
    const sorted: { mesh: ChunkMesh, dist: number }[] = [];
    for (const c of world.chunks.values()) {
      const cxw = c.cx * 16 + 8, czw = c.cz * 16 + 8;
      const dx = cxw - eyeX, dz = czw - eyeZ;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist) continue;
      if (!this.chunkVisible(c.cx * 16, c.cz * 16)) continue;
      const mesh = this.meshes.get(`${c.cx},${c.cz}`);
      if (!mesh) continue;
      if (mesh.solid) {
        gl.bindVertexArray(mesh.solid.vao);
        gl.drawElements(gl.TRIANGLES, mesh.solid.count, gl.UNSIGNED_INT, 0);
        this.drawStats.chunks++;
        this.drawStats.triangles += mesh.solid.count / 3;
      }
      if (mesh.translucent) sorted.push({ mesh, dist });
    }

    if (this.extraWorldRenderer) {
      this.extraWorldRenderer(gl, this.vp, [eyeX, eyeY, eyeZ], elapsed, day);
      this.chunkProgram.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.assets.texArray);
      this.chunkProgram.i('uTex', 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
    }

    if (sorted.length) {
      sorted.sort((a, b) => b.dist - a.dist);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      this.chunkProgram.f('uAlphaCutoff', 0.0);
      for (const { mesh } of sorted) {
        if (!mesh.translucent) continue;
        gl.bindVertexArray(mesh.translucent.vao);
        gl.drawElements(gl.TRIANGLES, mesh.translucent.count, gl.UNSIGNED_INT, 0);
        this.drawStats.translucent++;
        this.drawStats.triangles += mesh.translucent.count / 3;
      }
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      this.chunkProgram.f('uAlphaCutoff', 0.3);
    }

    if (!underwater) this.drawClouds(eyeX, eyeY, eyeZ, day, elapsed);

    if (target) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.lineProgram.use();
      this.lineProgram.mat4('uViewProj', this.vp);
      this.lineProgram.v3('uOrigin', target.x, target.y, target.z);
      this.lineProgram.v4('uColor', 0, 0, 0, 0.55);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
    }
    this.drawViewmodel(elapsed);
    gl.bindVertexArray(null);
    if (this.usePost) this.postfx.end({ sunScreen, sunVisibility, underwater, time: elapsed });
  }

  setDebugMode(mode: number): void {
    this.debugMode = mode;
  }

  setFov(degrees: number): void {
    this.fov = clamp(degrees, 30, 110);
  }

  setWorldExtraRenderer(fn: ((gl: WebGL2RenderingContext, vp: Float32Array, eye: [number, number, number], elapsed: number, day: number) => void) | null): void {
    this.extraWorldRenderer = fn;
  }

  setHeldBlock(id: number): void {
    if (id === this.heldId) return;
    this.heldId = id;
    this.rebuildHeldMesh();
  }

  swing(): void {
    this.swingStart = this.frameTime;
  }

  setViewmodelVisible(visible: boolean): void {
    this.viewVisible = visible;
  }

  setViewmodelTouchMode(touch: boolean): void {
    this.viewTouch = touch;
  }

  setViewmodelMotion(speed: number, onGround: boolean): void {
    this.viewSpeed = speed;
    this.viewGround = onGround;
  }

  private buildHandMesh(): void {
    const gl = this.gl;
    const data: number[] = [];
    const faceShade = VIEW_FACE_LIGHT;
    const addBox = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: number[]) => {
      const p = [
        [x1, y1, z2], [x1, y1, z1], [x2, y1, z1], [x2, y1, z2],
        [x1, y2, z1], [x1, y2, z2], [x2, y2, z2], [x2, y2, z1],
      ];
      const faces = [
        [[0, 3, 2, 1], 0], [[4, 5, 6, 7], 1], [[1, 2, 6, 5], 2],
        [[0, 4, 7, 3], 3], [[0, 1, 5, 4], 4], [[3, 7, 6, 2], 5],
      ];
      for (const [quad, dir] of faces as [number[], number][]) {
        const shade = faceShade[dir];
        for (const i of [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]) {
          data.push(p[i][0], p[i][1], p[i][2], color[0] * shade, color[1] * shade, color[2] * shade);
        }
      }
    };
    addBox(-0.085, -0.68, -0.075, 0.085, -0.5, 0.075, [0.70, 0.52, 0.40]);
    addBox(-0.085, -0.56, -0.075, 0.085, 0.08, 0.075, [0.72, 0.54, 0.42]);
    addBox(-0.105, -0.02, -0.095, 0.105, 0.30, 0.095, [0.16, 0.53, 0.58]);
    this.handCount = data.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.handVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.bindVertexArray(this.handVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.handVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  private heldTint(mode: number, fixed: [number, number, number], ti: number): [number, number, number] {
    if (ti < 0) return [1, 1, 1];
    if (mode === 1) return hexToRgb('#91bd59');
    if (mode === 2) return hexToRgb('#77ab2f');
    if (mode === 3) return hexToRgb('#3f76e4');
    if (mode === 4) return fixed;
    return [1, 1, 1];
  }

  private rebuildHeldMesh(): void {
    const gl = this.gl;
    if (this.viewVbo) gl.deleteBuffer(this.viewVbo);
    this.viewVbo = null;
    this.viewCount = 0;
    if (this.heldId <= 0) return;
    const def = this.rocks.get(this.heldId);
    const data: number[] = [];
    const addQuad = (p: number[], uv: number[], layer: number, color: number[]) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        data.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], uv[i * 2] / 16, uv[i * 2 + 1] / 16,
          layer, color[0], color[1], color[2]);
      }
    };
    if (def.quads.length) {
      for (const q of def.quads) {
        const tint = this.heldTint(def.tintMode, def.tintColor, q.ti);
        const shade = q.shade ? VIEW_FACE_LIGHT[q.d] : 1;
        addQuad(q.p, q.uv, q.layer, [tint[0] * shade, tint[1] * shade, tint[2] * shade]);
      }
    } else {
      const topTex = def.iconTop ? this.assets.manifest.textures[def.iconTop] : null;
      const sideTex = def.iconSide ? this.assets.manifest.textures[def.iconSide] : null;
      const topLayer = topTex?.arrayLayer ?? def.fluidLayer;
      const sideLayer = sideTex?.arrayLayer ?? def.fluidLayer;
      const tint = this.heldTint(def.tintMode, def.tintColor, 0);
      if (topLayer >= 0) {
        const c = (d: number) => [tint[0] * VIEW_FACE_LIGHT[d], tint[1] * VIEW_FACE_LIGHT[d], tint[2] * VIEW_FACE_LIGHT[d]];
        addQuad([0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 16, 16, 16, 16, 0], topLayer, c(0));
        addQuad([0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0], [0, 0, 0, 16, 16, 16, 16, 0], topLayer, c(1));
        addQuad([1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1], [0, 0, 0, 16, 16, 16, 16, 0], sideLayer >= 0 ? sideLayer : topLayer, c(2));
        addQuad([0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1], [0, 0, 0, 16, 16, 16, 16, 0], sideLayer >= 0 ? sideLayer : topLayer, c(3));
        addQuad([0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1], [0, 0, 0, 16, 16, 16, 16, 0], sideLayer >= 0 ? sideLayer : topLayer, c(4));
        addQuad([1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0], [0, 0, 0, 16, 16, 16, 16, 0], sideLayer >= 0 ? sideLayer : topLayer, c(5));
      }
    }
    if (!data.length) return;
    this.viewCount = data.length / 9;
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);
    this.viewVbo = vbo;
    this.viewVao = vao;
  }

  private drawViewmodel(elapsed: number): void {
    if (!this.viewVisible) return;
    const gl = this.gl;
    const dt = Math.min(0.1, Math.max(0, elapsed - this.lastViewTime));
    this.lastViewTime = elapsed;
    const moving = this.viewSpeed > 0.35 && this.viewGround;
    if (moving) this.bobPhase += dt * (2.2 + this.viewSpeed * 0.65);
    const bob = moving ? 0.012 : 0;
    const bobX = Math.sin(this.bobPhase * 2) * bob;
    const bobY = -Math.abs(Math.cos(this.bobPhase * 2)) * bob * 0.7;
    let swing = 0;
    if (this.swingStart >= 0) {
      const p = (elapsed - this.swingStart) / 0.3;
      if (p >= 1) this.swingStart = -1;
      else swing = Math.sin(clamp(p, 0, 1) * Math.PI);
    }
    const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
    const tanHalf = Math.tan((70 * Math.PI) / 360);
    const proj = perspective(mat4(), (this.fov * Math.PI) / 180, aspect, 0.01, 8);
    const tmp = mat4();
    const t = mat4();
    const model = mat4();
    const bz = this.viewTouch ? 0.9 : 1.02;
    const bx = (this.viewTouch ? 0.58 : 0.52) * bz * tanHalf * aspect;
    const by = (this.viewTouch ? -0.42 : -0.55) * bz * tanHalf;
    const blockScale = this.viewTouch ? 0.16 : 0.29;
    translation(model, bx + bobX + 0.07 * swing * aspect, by + bobY - 0.10 * swing, -bz + 0.08 * swing);
    multiply(model, model, rotationZ(tmp, -0.30 * swing));
    multiply(model, model, rotationY(tmp, 0.16 * swing));
    multiply(model, model, rotationX(tmp, -0.50 * swing));
    multiply(model, model, rotationZ(tmp, -0.11));
    multiply(model, model, rotationY(tmp, 0.62));
    multiply(model, model, rotationX(tmp, -0.22));
    multiply(model, model, scaling(tmp, blockScale, blockScale, blockScale));
    multiply(model, model, translation(t, -0.5, -0.5, -0.5));

    const hand = mat4();
    const hz = this.viewTouch ? 0.8 : 0.88;
    const hx = (this.viewTouch ? 0.68 : 0.42) * hz * tanHalf * aspect;
    const hy = (this.viewTouch ? -0.6 : -0.78) * hz * tanHalf;
    const handScale = this.viewTouch ? 0.18 : 0.30;
    translation(hand, hx + bobX + 0.05 * swing * aspect, hy + bobY - 0.08 * swing, -hz + 0.06 * swing);
    multiply(hand, hand, rotationZ(tmp, -0.20 - 0.18 * swing));
    multiply(hand, hand, rotationY(tmp, -0.17));
    multiply(hand, hand, rotationX(tmp, -0.10 - 0.25 * swing));
    multiply(hand, hand, scaling(t, handScale, handScale, handScale));

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    this.handProgram.use();
    this.handProgram.mat4('uProj', proj);
    this.handProgram.mat4('uModel', hand);
    gl.bindVertexArray(this.handVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.handCount);

    if (this.viewCount > 0 && this.viewVao) {
      const def = this.rocks.get(this.heldId);
      this.viewProgram.use();
      this.viewProgram.mat4('uProj', proj);
      this.viewProgram.mat4('uModel', model);
      this.viewProgram.f('uAlphaCutoff', 0.3);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.assets.texArray);
      this.viewProgram.i('uTex', 0);
      if (def.flags?.render === 'translucent') {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
      gl.bindVertexArray(this.viewVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.viewCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  private drawCelestial(worldTicks: number, sunDir: number[], day: number): void {
    const gl = this.gl;
    const { rx, ry, rz, ux, uy, uz } = basisFromYawPitch(this.yaw, this.pitch);
    const time = ((worldTicks % 24000) + 24000) % 24000;
    const angle = (time / 24000) * Math.PI * 2;
    const sun = [Math.cos(angle), Math.sin(angle), 0.18];
    const sl = Math.hypot(...sun);
    sun[0] /= sl; sun[1] /= sl; sun[2] /= sl;
    const moon = [-sun[0], -sun[1], -sun[2]];
    const eye = this.eye;
    const build = (dir: number[], size: number): Float32Array => {
      const c = [eye[0] + dir[0] * 100, eye[1] + dir[1] * 100, eye[2] + dir[2] * 100];
      const h = size / 2;
      const p = [
        c[0] - rx * h - ux * h, c[1] - ry * h - uy * h, c[2] - rz * h - uz * h,
        c[0] + rx * h - ux * h, c[1] + ry * h - uy * h, c[2] + rz * h - uz * h,
        c[0] + rx * h + ux * h, c[1] + ry * h + uy * h, c[2] + rz * h + uz * h,
        c[0] - rx * h + ux * h, c[1] - ry * h + uy * h, c[2] - rz * h + uz * h,
      ];
      const uv = [0, 1, 1, 1, 1, 0, 0, 0];
      const out: number[] = [];
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]);
      return new Float32Array(out);
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    this.celestialProgram.use();
    this.celestialProgram.mat4('uViewProj', this.vp);
    gl.bindVertexArray(this.celestialVao);
    if (sun[1] > -0.12) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.celestialVbo);
      gl.bufferData(gl.ARRAY_BUFFER, build(sun, 18), gl.DYNAMIC_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sunTex);
      this.celestialProgram.i('uTex', 0);
      this.celestialProgram.v4('uColor', 1, 1, 1, clamp((sun[1] + 0.12) * 4, 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (moon[1] > -0.12) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.celestialVbo);
      gl.bufferData(gl.ARRAY_BUFFER, build(moon, 6), gl.DYNAMIC_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.moonTex);
      this.celestialProgram.i('uTex', 0);
      this.celestialProgram.v4('uColor', 1, 1, 1, clamp((moon[1] + 0.12) * 4, 0, 1));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  private drawClouds(x: number, y: number, z: number, day: number, elapsed: number): void {
    const gl = this.gl;
    const cloudY = 192.33;
    const size = 2048;
    const uScale = 1 / 3072;
    const drift = (elapsed * 0.6) * uScale;
    const base = x - size / 2, baseZ = z - size / 2;
    const corners: [number, number, number][] = [
      [base, cloudY, baseZ], [base, cloudY, baseZ + size], [base + size, cloudY, baseZ + size],
      [base, cloudY, baseZ], [base + size, cloudY, baseZ + size], [base + size, cloudY, baseZ],
    ];
    const data: number[] = [];
    for (const [px, py, pz] of corners) {
      data.push(px, py, pz, px * uScale + drift, pz * uScale + 3.96 * uScale);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this.cloudProgram.use();
    this.cloudProgram.mat4('uViewProj', this.vp);
    this.cloudProgram.v3('uCam', this.eye[0], this.eye[1], this.eye[2]);
    this.cloudProgram.f('uFadeEnd', 900);
    const nightTint = hexToRgb('#191926');
    this.cloudProgram.v4('uColor',
      nightTint[0] + (1 - nightTint[0]) * day,
      nightTint[1] + (1 - nightTint[1]) * day,
      nightTint[2] + (1 - nightTint[2]) * day,
      0.8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    this.cloudProgram.i('uTex', 0);
    gl.bindVertexArray(this.cloudVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  setTextureFilter(mode: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.assets.texArray);
    let min: number = gl.NEAREST_MIPMAP_LINEAR;
    if (mode === 0) min = gl.NEAREST;
    else if (mode === 1) min = gl.NEAREST_MIPMAP_NEAREST;
    else if (mode === 2) min = gl.NEAREST_MIPMAP_LINEAR;
    else if (mode === 3) min = gl.LINEAR_MIPMAP_LINEAR;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 1);
  }

  private updateAnimFrames(elapsed: number): void {
    const tick = Math.floor(elapsed * 20);
    for (let i = 0; i < this.animFrames.length; i++) this.animFrames[i] = 0;
    for (const info of this.assets.manifest.animTextures) {
      const frames = info.frames;
      let physical = 0;
      if (info.frameList && info.frameList.length) {
        const entries = info.frameList.map(e => typeof e === 'number' ? { index: e, time: info.frametime } : e);
        let total = 0;
        for (const e of entries) total += Math.max(1, e.time);
        let t = tick % Math.max(1, total);
        for (const e of entries) {
          if (t < e.time) { physical = e.index; break; }
          t -= e.time;
        }
      } else {
        const f = Math.max(1, info.frametime);
        physical = Math.floor(tick / f) % frames;
      }
      this.animFrames[info.id] = info.layer + (physical % frames);
    }
  }
}
