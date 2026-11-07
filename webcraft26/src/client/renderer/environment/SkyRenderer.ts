// Port of net.minecraft.client.renderer.SkyRenderer (26.2) and the legacy
// LevelRenderer.renderSky celestials, rebuilt as a standalone WebGL2 pass.
//
// Covered vanilla behaviour:
//   * sky disc / horizon fog gradient driven by the day timeline
//   * sun + moon on a celestial sphere rotating around the X axis
//     (angle = ClientLevel.getTimeOfDay() * 2PI), moon phase from getMoonPhase()
//   * 1500 fixed pseudo-random star quads on a radius-100 sphere, rotating with
//     the celestial sphere and only visible at night
//   * sunrise / sunset glow near the horizon
//   * optional end-dimension sky box (end_sky.png)
//   * rain dims the celestials and greys the sky (rainBrightness = 1 - rainLevel)
//
// render(view, proj, timeOfDay, camera, rainLevel) draws into the currently
// bound framebuffer and never binds a framebuffer / changes the viewport, so it
// composes with the main agent's post-processing pipeline.

import { GlProgram, cameraBasis, mat4Mul } from '../gl/Gl.js';
import { XoroshiroRandomSource } from '../../../vanilla/core/Random.js';
import {
  createFullscreenQuad, loadEnvTexture, moonPhaseOf, restoreDefaultState,
  skyStateFor, type CameraLike, type LevelLike,
} from './EnvCommon.js';
import { CelestialBodies } from './CelestialBodies.js';

const SKY_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.99999, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec3 uSunriseColor;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uSunDir;
uniform float uSunriseStrength;
uniform float uRain;
out vec4 fragColor;
void main() {
  vec3 dir = normalize(uCamForward
    + uCamRight * (vNdc.x * uTanHalfFov * uAspect)
    + uCamUp * (vNdc.y * uTanHalfFov));
  float up = clamp(dir.y, -1.0, 1.0);
  float horizon = 1.0 - smoothstep(-0.02, 0.35, up);
  vec3 color = mix(uSkyColor, uFogColor, horizon * 0.85);
  float below = smoothstep(0.0, 0.18, -up);
  color = mix(color, uFogColor * 0.55, below);
  float sunDot = max(dot(dir, uSunDir), 0.0);
  color += uSunriseColor * pow(sunDot, 12.0) * uSunriseStrength;
  color = mix(color, uFogColor, uRain * 0.45);
  fragColor = vec4(color, 1.0);
}`;

// Stars are camera-facing quads on a rotating celestial sphere.
const STAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aSphere;
layout(location = 1) in vec2 aCorner;
layout(location = 2) in float aSize;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uCenter;
uniform float uAngle;
void main() {
  float c = cos(uAngle), s = sin(uAngle);
  vec3 p = vec3(aSphere.x, aSphere.y * c - aSphere.z * s, aSphere.y * s + aSphere.z * c);
  vec3 world = uCenter + p + uRight * (aCorner.x * aSize) + uUp * (aCorner.y * aSize);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const STAR_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;

const CELESTIAL_VS = `#version 300 es
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

const CELESTIAL_FS = `#version 300 es
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

const END_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uViewProj;
uniform vec3 uCenter;
out vec2 vUV;
void main() {
  gl_Position = uViewProj * vec4(uCenter + aPos, 1.0);
  vUV = aUV;
}`;

const END_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(uTex, vUV).rgb * vec3(0.16, 0.15, 0.22), 1.0);
}`;

export interface SkyRendererOptions {
  starCount?: number;          // vanilla 1500
  celestialDistance?: number;  // vanilla 100
  sunScale?: number;           // vanilla 30
  moonScale?: number;          // vanilla 20
  endSky?: boolean;
}

export class SkyRenderer {
  private readonly viewProj = new Float32Array(16);
  private skyProgram: GlProgram | null = null;
  private starProgram: GlProgram | null = null;
  private celestialProgram: GlProgram | null = null;
  private endProgram: GlProgram | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private starVao: WebGLVertexArrayObject | null = null;
  private celestialVao: WebGLVertexArrayObject | null = null;
  private endVao: WebGLVertexArrayObject | null = null;
  private starVertexCount = 0;
  private endSkyTex: WebGLTexture | null = null;

  /** Draw the end-dimension sky box instead of the overworld sky. */
  endSky: boolean;
  /** Moon phase override (0..7); render(..., level) overrides it when present. */
  moonPhase = 0;
  readonly opts: Required<SkyRendererOptions>;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly bodies: CelestialBodies = new CelestialBodies(),
    opts: SkyRendererOptions = {},
  ) {
    this.opts = {
      starCount: opts.starCount ?? 1500,
      celestialDistance: opts.celestialDistance ?? 100,
      sunScale: opts.sunScale ?? 30,
      moonScale: opts.moonScale ?? 20,
      endSky: opts.endSky ?? false,
    };
    this.endSky = this.opts.endSky;
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.skyProgram = new GlProgram(gl, SKY_VS, SKY_FS, 'env.sky');
    this.starProgram = new GlProgram(gl, STAR_VS, STAR_FS, 'env.stars');
    this.celestialProgram = new GlProgram(gl, CELESTIAL_VS, CELESTIAL_FS, 'env.celestial');
    this.endProgram = new GlProgram(gl, END_VS, END_FS, 'env.endsky');
    this.quadVao = createFullscreenQuad(gl);
    this.starVao = this.buildStars(gl);
    this.celestialVao = this.buildCelestialQuad(gl);
    this.endVao = this.buildEndSky(gl);
    await this.bodies.load(gl);
    this.endSkyTex = await loadEnvTexture(gl, 'environment/end_sky', gl.REPEAT, gl.LINEAR);
  }

  /** Vanilla: 1500 stars from a fixed-seed RandomSource, quads on a 100 sphere. */
  private buildStars(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const rand = new XoroshiroRandomSource(10842n);
    const corners: [number, number][] = [
      [-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1],
    ];
    const data: number[] = [];
    const R = this.opts.celestialDistance;
    for (let i = 0; i < this.opts.starCount; i++) {
      const x = rand.nextFloat() * 2 - 1;
      const y = rand.nextFloat() * 2 - 1;
      const z = rand.nextFloat() * 2 - 1;
      const l2 = x * x + y * y + z * z;
      if (l2 <= 0.01 || l2 >= 1) continue;
      const inv = R / Math.sqrt(l2);
      const px = x * inv, py = y * inv, pz = z * inv;
      const size = 0.15 + rand.nextFloat() * 0.1;
      for (const [cx, cy] of corners) data.push(px, py, pz, cx, cy, size);
    }
    this.starVertexCount = data.length / 6;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);   // aSphere
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);  // aCorner
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);  // aSize
    gl.bindVertexArray(null);
    return vao;
  }

  private buildCelestialQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // vec3 corner + vec2 uv, two triangles
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0, 0, 1, 0.5, -0.5, 0, 1, 1, 0.5, 0.5, 0, 1, 0,
      -0.5, -0.5, 0, 0, 1, 0.5, 0.5, 0, 1, 0, -0.5, 0.5, 0, 0, 0,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Six quads forming a radius-R sky box, matching SkyRenderer.buildEndSky. */
  private buildEndSky(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const R = this.opts.celestialDistance;
    const faces: number[] = [];
    const quad = (
      p0: number[], p1: number[], p2: number[], p3: number[],
    ) => {
      const uv = [0, 0, 1, 0, 1, 1, 0, 1];
      const verts = [p0, p1, p2, p0, p2, p3];
      const idx = [0, 1, 2, 0, 2, 3];
      for (const k of idx) {
        faces.push(verts[k][0] * R, verts[k][1] * R, verts[k][2] * R, uv[k * 2], uv[k * 2 + 1]);
      }
    };
    quad([-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]);
    quad([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]);
    quad([-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]);
    quad([1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]);
    quad([-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]);
    quad([-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(faces), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  /** 0..7 moon phase; accepts a level so getMoonPhase() is used when available. */
  setMoonPhase(phaseOrLevel: number | LevelLike): void {
    if (typeof phaseOrLevel === 'number') this.moonPhase = ((Math.trunc(phaseOrLevel) % 8) + 8) % 8;
    else this.moonPhase = moonPhaseOf(phaseOrLevel);
  }

  /**
   * @param view  column-major view matrix (Float32Array(16))
   * @param proj  column-major projection matrix (Float32Array(16))
   * @param timeOfDay  ClientLevel.getTimeOfDay() (0..1, 0 = sunrise)
   * @param camera  camera for basis vectors and the celestial centre
   * @param rainLevel  current rain strength (0..1)
   * @param level  optional, used for the moon phase
   */
  render(
    view: Float32Array,
    proj: Float32Array,
    timeOfDay: number,
    camera: CameraLike,
    rainLevel: number,
    level?: LevelLike | null,
  ): void {
    const gl = this.gl;
    if (!this.skyProgram || !this.quadVao) return;
    mat4Mul(proj, view, this.viewProj);
    const { right, up, forward } = cameraBasis(
      (camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180,
    );

    const theta = timeOfDay * Math.PI * 2;
    const sunDir: [number, number, number] = [0, Math.sin(theta), Math.cos(theta)];
    const rain = Math.min(1, Math.max(0, rainLevel));
    const rainBrightness = 1 - rain;              // vanilla rainBrightness
    const sky = skyStateFor(timeOfDay);
    const starBrightness = sky.starBrightness * (1 - rain * 0.85);

    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    if (this.endSky && this.endProgram && this.endVao && this.endSkyTex) {
      this.endProgram.use();
      this.endProgram.setMat4('uViewProj', this.viewProj);
      this.endProgram.set3f('uCenter', camera.x, camera.y, camera.z);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.endSkyTex);
      this.endProgram.set1i('uTex', 0);
      gl.bindVertexArray(this.endVao);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    } else {
      // sky gradient + sunrise/sunset glow
      this.skyProgram.use();
      this.skyProgram.set3f('uSkyColor', sky.skyColor[0], sky.skyColor[1], sky.skyColor[2]);
      this.skyProgram.set3f('uFogColor', sky.fogColor[0], sky.fogColor[1], sky.fogColor[2]);
      this.skyProgram.set3f('uSunriseColor', sky.sunriseColor[0], sky.sunriseColor[1], sky.sunriseColor[2]);
      this.skyProgram.set3f('uCamRight', right[0], right[1], right[2]);
      this.skyProgram.set3f('uCamUp', up[0], up[1], up[2]);
      this.skyProgram.set3f('uCamForward', forward[0], forward[1], forward[2]);
      this.skyProgram.set1f('uTanHalfFov', Math.tan((camera.fov * Math.PI) / 360));
      this.skyProgram.set1f('uAspect', camera.aspect);
      this.skyProgram.set3f('uSunDir', sunDir[0], sunDir[1], sunDir[2]);
      const glow = Math.max(0, 1 - Math.abs(sunDir[1]) / 0.3);
      this.skyProgram.set1f('uSunriseStrength', glow);
      this.skyProgram.set1f('uRain', rain);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // stars (night only), rotating with the celestial sphere
      if (starBrightness > 0.01 && this.starProgram && this.starVao && this.starVertexCount) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this.starProgram.use();
        this.starProgram.setMat4('uViewProj', this.viewProj);
        this.starProgram.set3f('uRight', right[0], right[1], right[2]);
        this.starProgram.set3f('uUp', up[0], up[1], up[2]);
        this.starProgram.set3f('uCenter', camera.x, camera.y, camera.z);
        this.starProgram.set1f('uAngle', theta);
        this.starProgram.set4f('uColor', 1, 1, 1, starBrightness);
        gl.bindVertexArray(this.starVao);
        gl.drawArrays(gl.TRIANGLES, 0, this.starVertexCount);
      }

      // sun and moon billboards
      if (this.celestialProgram && this.celestialVao) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const R = this.opts.celestialDistance;
        const sunTint = this.bodies.sunTint(rainBrightness);
        this.drawCelestial(this.bodies.sun, [
          camera.x + sunDir[0] * R, camera.y + sunDir[1] * R, camera.z + sunDir[2] * R,
        ], this.opts.sunScale, sunTint, right, up);
        const moonTex = level ? this.bodies.moonTexture(moonPhaseOf(level)) : this.bodies.moonTexture(this.moonPhase);
        const moonTint = this.bodies.moonTint(rainBrightness);
        this.drawCelestial(moonTex, [
          camera.x - sunDir[0] * R, camera.y - sunDir[1] * R, camera.z - sunDir[2] * R,
        ], this.opts.moonScale, moonTint, right, up);
      }
    }

    gl.bindVertexArray(null);
    restoreDefaultState(gl);
  }

  private drawCelestial(
    tex: WebGLTexture | null,
    center: [number, number, number],
    scale: number,
    tint: { r: number; g: number; b: number; a: number },
    right: number[], up: number[],
  ): void {
    if (!tex || !this.celestialProgram || !this.celestialVao) return;
    const gl = this.gl;
    this.celestialProgram.use();
    this.celestialProgram.setMat4('uViewProj', this.viewProj);
    this.celestialProgram.set3f('uCenter', center[0], center[1], center[2]);
    this.celestialProgram.set3f('uRight', right[0], right[1], right[2]);
    this.celestialProgram.set3f('uUp', up[0], up[1], up[2]);
    this.celestialProgram.set1f('uScale', scale);
    this.celestialProgram.set4f('uTint', tint.r, tint.g, tint.b, tint.a);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.celestialProgram.set1i('uTex', 0);
    gl.bindVertexArray(this.celestialVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    for (const v of [this.quadVao, this.starVao, this.celestialVao, this.endVao]) {
      if (v) gl.deleteVertexArray(v);
    }
    if (this.endSkyTex) gl.deleteTexture(this.endSkyTex);
    this.bodies.dispose(gl);
  }
}
