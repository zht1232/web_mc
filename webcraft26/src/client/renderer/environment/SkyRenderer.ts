// Port of net.minecraft.client.renderer.SkyRenderer (26.2), rebuilt as a standalone
// WebGL2 pass that can be composited into an offscreen (HDR) target.
//
// Vanilla draw order, copied from LevelRenderer#addSkyPass("sky"):
//   1. renderSkyDisc(skyColor)                     -> top sky disc (flat colour + sky fog)
//   2. renderSunriseAndSunset(pose, sunAngle, argb) -> 18 vertex fan glow
//   3. renderSunMoonAndStars(...)                  -> sun, moon, stars (OVERLAY blend)
//   4. renderDarkDisc()  (only when below the horizon height) -> black bottom disc
//
// Geometry / constants are taken from SkyRenderer.java (line numbers in EnvCommon.ts):
//   * top disc:  triangle fan, centre (0, 16, 0), ring radius 512 (buildSkyDisc L217)
//   * sun/moon:  a quad in the XZ plane, translate(0,100,0), scale(30|20,1,30|20),
//                rotated by R_Y(-90) * R_X(angle) (renderSun L361 / renderMoon L388)
//   * stars:     1500 quads built from RandomSource.createThreadLocalInstance(10842L)
//                (buildStars L183), rotated by R_X(starAngle)
//   * sunrise:   fan of 18 vertices, translate-free, R_X(90) * R_Z(a) with
//                a = (sin(sunAngle) < 0 ? 180 : 0) + 90 (renderSunriseAndSunset L441)
//
// Colours come from SkyState (the light package's single source of truth):
// skyColor, fogColor, sunriseColor(+alpha), cloudColor, starBrightness and the
// sun/moon/star angles + moon phase.
//
// GL state contract (see 05-environment-audio.md): draws into the currently bound
// framebuffer, never binds an FBO / changes the viewport / clears. On entry depth
// test is ON; the sky pass turns depth test off and depth writes off (the sky is
// infinite distance and is drawn before terrain), then restores the default state.

import { GlProgram, cameraBasis, mat4Mul } from '../gl/Gl.js';
import { LegacyRandomSource } from '../../../vanilla/core/Random.js';
import {
  MOON_SIZE,
  SUNRISE_CENTRE_Y,
  SUNRISE_RING_DEPTH,
  SUNRISE_RING_RADIUS,
  SUNRISE_STEPS,
  SUN_SIZE,
  celestialModelMatrix,
  createFullscreenQuad,
  loadEnvTexture,
  moonPhaseOf,
  restoreDefaultState,
  setOverlayBlend,
  setTranslucentBlend,
  skyStateFor,
  type CameraLike,
  type LevelLike,
} from './EnvCommon.js';
import { CelestialBodies } from './CelestialBodies.js';
import { argbFromRgb, computeFogColor } from './FogState.js';

const SKY_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.99999, 1.0); }`;

// core/sky.fsh: fragColor = apply_fog(ColorModulator, spherical, cylindrical, SkyEnd, SkyEnd, SkyEnd)
// with a flat ColorModulator. The vanilla geometry is a *flat disc* at y=+16 (top)
// or y=-4 (dark bottom disc), so the fragment distance is solved analytically
// against that plane instead of interpolating the triangle fan.
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uSkyEnd;
uniform float uFogAlpha;
uniform int uMode;          // 0 = top sky disc, 1 = dark bottom disc
out vec4 fragColor;

void main() {
  vec3 dir = normalize(uCamForward
    + uCamRight * (vNdc.x * uTanHalfFov * uAspect)
    + uCamUp * (vNdc.y * uTanHalfFov));

  float planeY;
  vec3 base;
  if (uMode == 0) {
    if (dir.y <= 0.0) discard;
    planeY = 16.0;               // SkyRenderer.buildSkyDisc(16.0F)
    base = uSkyColor;
  } else {
    if (dir.y >= 0.0) discard;
    planeY = -4.0;               // buildSkyDisc(-16.0F) + renderDarkDisc translate(0,12,0)
    base = vec3(0.0);
  }

  float dist = planeY / dir.y;   // distance from the camera to the disc plane
  if (dist > 512.0) discard;     // SKY_DISC_RADIUS

  // core/fog.glsl: total = max(linear(spherical), linear(cylindrical))
  float spherical = dist;
  float cylindrical = max(length(dir.xz) * dist, abs(dir.y) * dist);
  float fog = max(clamp(spherical / uSkyEnd, 0.0, 1.0), clamp(cylindrical / uSkyEnd, 0.0, 1.0));
  fragColor = vec4(mix(base, uFogColor, fog * uFogAlpha), 1.0);
}`;

// Sun / moon billboard. The quad is built in the XZ plane (normal -Y) exactly like
// SkyRenderer.buildCelestialQuad; the model matrix carries the vanilla pose.
const CELESTIAL_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uCamPos;
out vec2 vUV;
void main() {
  vec3 world = uCamPos + (uModel * vec4(aPos, 1.0)).xyz;
  gl_Position = uViewProj * vec4(world, 1.0);
  vUV = aUV;
}`;

// core/position_tex.fsh: fragColor = texture(Sampler0, uv) * ColorModulator
// (ColorModulator rgb = 1, alpha = rainBrightness). The celestials use the
// OVERLAY blend (BlendFunction.OVERLAY = SRC_ALPHA, ONE), so the source is added
// scaled by its alpha - black sprite pixels contribute nothing.
const CELESTIAL_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uFlipUV;   // 1 = moon (buildMoonPhases mirrors both UV axes vs. the sun)
out vec4 fragColor;
void main() {
  vec2 uv = uFlipUV > 0.5 ? vec2(1.0 - vUV.x, 1.0 - vUV.y) : vUV;
  vec4 c = texture(uTex, uv);
  fragColor = vec4(c.rgb, uAlpha);
}`;

// Stars are static quads on a radius-100 sphere; the shader only applies
// R_Y(-90) * R_X(starAngle) (SkyRenderer.renderSunMoonAndStars L341-355).
const STAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uAngle;
void main() {
  float c = cos(uAngle), s = sin(uAngle);
  vec3 p = vec3(aPos.x, aPos.y * c - aPos.z * s, aPos.y * s + aPos.z * c); // R_X(angle)
  vec3 q = vec3(-p.z, p.y, p.x);                                          // R_Y(-90)
  gl_Position = uViewProj * vec4(uCamPos + q, 1.0);
}`;

// core/stars.fsh: fragColor = ColorModulator = (brightness, brightness, brightness, brightness)
// blended with OVERLAY, i.e. dst + brightness^2.
const STAR_FS = `#version 300 es
precision highp float;
uniform float uBrightness;
out vec4 fragColor;
void main() { fragColor = vec4(uBrightness, uBrightness, uBrightness, uBrightness); }`;

// Sunrise / sunset fan: core/position_color (vertexColor * ColorModulator) with
// TRANSLUCENT blending. Vertex colours are white with alpha 1 in the centre and
// alpha 0 on the ring (SkyRenderer.buildSunriseFan L106-130).
const SUNRISE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
out vec4 vColor;
void main() {
  gl_Position = uViewProj * vec4(uCamPos + aPos, 1.0);
  vColor = aColor;
}`;

const SUNRISE_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() { fragColor = vColor; }`;

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
void main() { fragColor = vec4(texture(uTex, vUV).rgb * vec3(0.16, 0.15, 0.22), 1.0); }`;

export interface SkyRendererOptions {
  starCount?: number;          // vanilla 1500
  celestialDistance?: number;  // vanilla 100
  sunScale?: number;           // vanilla 30
  moonScale?: number;          // vanilla 20
  endSky?: boolean;
  /** visual/sky_fog_end_distance, clipped by the render distance (FogRenderer#setupFog) */
  skyFogEnd?: number;
  /** DimensionType horizon height; below it the dark sky disc is drawn. */
  horizonHeight?: number;
}

interface StarGeometry {
  data: Float32Array;
  vertexCount: number;
}

export class SkyRenderer {
  private readonly viewProj = new Float32Array(16);
  private readonly model = new Float32Array(16);
  private skyProgram: GlProgram | null = null;
  private starProgram: GlProgram | null = null;
  private celestialProgram: GlProgram | null = null;
  private sunriseProgram: GlProgram | null = null;
  private endProgram: GlProgram | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private starVao: WebGLVertexArrayObject | null = null;
  private celestialVao: WebGLVertexArrayObject | null = null;
  private sunriseVao: WebGLVertexArrayObject | null = null;
  private sunriseVbo: WebGLBuffer | null = null;
  private endVao: WebGLVertexArrayObject | null = null;
  private starVertexCount = 0;
  private endSkyTex: WebGLTexture | null = null;
  private readonly sunriseData = new Float32Array((SUNRISE_STEPS + 2) * 7);

  /** Draw the end-dimension sky box instead of the overworld sky. */
  endSky: boolean;
  /** Moon phase override (0..7); render(..., level) overrides it when present. */
  moonPhase = 0;
  /** visual/sky_fog_end_distance, clipped by the render distance like FogRenderer does. */
  skyFogEnd: number;
  /** Sea level of the dimension; below it the black bottom disc is drawn. */
  horizonHeight: number;
  readonly opts: Required<SkyRendererOptions>;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly bodies: CelestialBodies = new CelestialBodies(),
    opts: SkyRendererOptions = {},
  ) {
    this.opts = {
      starCount: opts.starCount ?? 1500,
      celestialDistance: opts.celestialDistance ?? 100,
      sunScale: opts.sunScale ?? SUN_SIZE,
      moonScale: opts.moonScale ?? MOON_SIZE,
      endSky: opts.endSky ?? false,
      skyFogEnd: opts.skyFogEnd ?? 512,
      horizonHeight: opts.horizonHeight ?? 63,
    };
    this.endSky = this.opts.endSky;
    this.skyFogEnd = this.opts.skyFogEnd;
    this.horizonHeight = this.opts.horizonHeight;
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.skyProgram = new GlProgram(gl, SKY_VS, SKY_FS, 'env.sky');
    this.starProgram = new GlProgram(gl, STAR_VS, STAR_FS, 'env.stars');
    this.celestialProgram = new GlProgram(gl, CELESTIAL_VS, CELESTIAL_FS, 'env.celestial');
    this.sunriseProgram = new GlProgram(gl, SUNRISE_VS, SUNRISE_FS, 'env.sunrise');
    this.endProgram = new GlProgram(gl, END_VS, END_FS, 'env.endsky');
    this.quadVao = createFullscreenQuad(gl);
    this.starVao = this.buildStars(gl);
    this.celestialVao = this.buildCelestialQuad(gl);
    this.sunriseVao = this.buildSunriseFan(gl);
    this.endVao = this.buildEndSky(gl);
    await this.bodies.load(gl);
    this.endSkyTex = await loadEnvTexture(gl, 'environment/end_sky', gl.REPEAT, gl.LINEAR);
  }

  /**
   * SkyRenderer.buildStars (L183): RandomSource.createThreadLocalInstance(10842L) is a
   * LegacyRandomSource. Each star consumes 3 floats + 1 size float, then (if kept)
   * one nextDouble for the in-plane roll. The quad's basis comes from
   * Matrix3f.rotateTowards(-center, up).rotateZ(-zRot).
   */
  private buildStars(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const rand = new LegacyRandomSource(10842n);
    const geo = buildStarGeometry(rand, this.opts.starCount, this.opts.celestialDistance);
    this.starVertexCount = geo.vertexCount;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  /** SkyRenderer.buildCelestialQuad: vertices in the XZ plane facing -Y. */
  private buildCelestialQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    // pos(-1..1, y=0), uv for the sun (moon flips both axes at draw time through the UV buffer below)
    const verts = [
      -1, 0, -1, 0, 0,
      1, 0, -1, 1, 0,
      1, 0, 1, 1, 1,
      -1, 0, 1, 0, 1,
    ];
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  /** SkyRenderer.buildSunriseFan (L106): centre (0,100,0) + 17 ring vertices. */
  private buildSunriseFan(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.sunriseVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sunriseVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.sunriseData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    return vao;
  }

  /** SkyRenderer.buildEndSky: six 100-unit quads with a fixed vertex tint. */
  private buildEndSky(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const R = this.opts.celestialDistance;
    const faces: number[] = [];
    const quad = (p0: number[], p1: number[], p2: number[], p3: number[]) => {
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

  /** 0..7 moon phase; accepts a level so its MOON timeline phase is used when available. */
  setMoonPhase(phaseOrLevel: number | LevelLike): void {
    if (typeof phaseOrLevel === 'number') this.moonPhase = ((Math.trunc(phaseOrLevel) % 8) + 8) % 8;
    else this.moonPhase = moonPhaseOf(phaseOrLevel);
  }

  /**
   * @param view  column-major view matrix (Float32Array(16))
   * @param proj  column-major projection matrix (Float32Array(16))
   * @param timeOfDay  dayTime / 24000 (0 = sunrise, 0.25 = noon, 0.75 = midnight)
   * @param camera  camera for the basis vectors and the celestial centre
   * @param rainLevel  current rain strength (0..1); alpha of the sun/moon
   * @param level  optional, kept for interface compatibility (SkyState is derived from timeOfDay)
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

    const sky = skyStateFor(timeOfDay);
    const rain = Math.min(1, Math.max(0, rainLevel));
    const rainBrightness = 1 - rain;                       // SkyRenderState.rainBrightness
    const skyFogEnd = Math.max(1, this.skyFogEnd);
    const horizonHeight = level?.horizonHeight ?? this.horizonHeight;

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
      gl.bindVertexArray(null);
      restoreDefaultState(gl);
      return;
    }

    // The sky pass uses the *sky fog* colour: FogRenderer.computeFogColor mixes the level fog
    // colour with the sky colour and - when the camera looks toward the sun - the sunrise/sunset
    // colour (AtmosphericFogEnvironment.getBaseColor). FogState is the light package's port.
    const fogRgb = computeFogColor({
      fogColorArgb: argbFromRgb(sky.fogColor),
      skyColorArgb: argbFromRgb(sky.skyColor),
      sunriseSunsetColorArgb: sky.sunriseColorArgb,
      sunAngleDeg: sky.sunAngleDeg,
      cameraForward: { x: forward[0], y: forward[1], z: forward[2] },
      skyFogEndDistance: sky.skyFogEndDistance,
      renderDistanceBlocks: skyFogEnd,
      rainLevel: rain,
      thunderLevel: 0,
    });

    // ---- 1. top sky disc (flat colour, horizon = sky fog) -------------------
    this.skyProgram.use();
    this.skyProgram.set3f('uSkyColor', sky.skyColor[0], sky.skyColor[1], sky.skyColor[2]);
    this.skyProgram.set3f('uFogColor', fogRgb[0], fogRgb[1], fogRgb[2]);
    this.skyProgram.set3f('uCamRight', right[0], right[1], right[2]);
    this.skyProgram.set3f('uCamUp', up[0], up[1], up[2]);
    this.skyProgram.set3f('uCamForward', forward[0], forward[1], forward[2]);
    this.skyProgram.set1f('uTanHalfFov', Math.tan((camera.fov * Math.PI) / 360));
    this.skyProgram.set1f('uAspect', camera.aspect);
    this.skyProgram.set1f('uSkyEnd', skyFogEnd);
    this.skyProgram.set1f('uFogAlpha', 1);
    this.skyProgram.set1i('uMode', 0);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ---- 2. sunrise / sunset glow ------------------------------------------
    const sunriseAlpha = ((sky.sunriseColorArgb >>> 24) & 255) / 255;
    if (sunriseAlpha > 0.001 && this.sunriseProgram && this.sunriseVao) {
      this.buildSunriseVertices(sky.sunAngleDeg * (Math.PI / 180), sunriseAlpha);
      gl.enable(gl.BLEND);
      setTranslucentBlend(gl);
      this.sunriseProgram.use();
      this.sunriseProgram.setMat4('uViewProj', this.viewProj);
      this.sunriseProgram.set3f('uCamPos', camera.x, camera.y, camera.z);
      gl.bindVertexArray(this.sunriseVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sunriseVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.sunriseData, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, SUNRISE_STEPS + 2);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    // ---- 3. sun, moon, stars (OVERLAY blend) --------------------------------
    gl.enable(gl.BLEND);
    setOverlayBlend(gl);

    const sunAngle = sky.sunAngleDeg * (Math.PI / 180);
    celestialModelMatrix(sunAngle, this.opts.sunScale, this.opts.celestialDistance, this.model);
    this.drawCelestial(this.bodies.sun, false, rainBrightness, camera);

    // MOON_PHASE comes from the MOON timeline (24 000 * 8 tick period), so it needs the
    // wall clock: level.gameTime, not the wrapped level.time the SkyState is sampled from.
    const phase = level ? moonPhaseOf(level) : this.moonPhase;
    const moonAngle = sky.moonAngleDeg * (Math.PI / 180);
    celestialModelMatrix(moonAngle, this.opts.moonScale, this.opts.celestialDistance, this.model);
    this.drawCelestial(this.bodies.moonTexture(phase), true, rainBrightness, camera);

    if (sky.starBrightness > 0 && this.starProgram && this.starVao && this.starVertexCount > 0) {
      this.starProgram.use();
      this.starProgram.setMat4('uViewProj', this.viewProj);
      this.starProgram.set3f('uCamPos', camera.x, camera.y, camera.z);
      this.starProgram.set1f('uAngle', sky.starAngleDeg * (Math.PI / 180));
      this.starProgram.set1f('uBrightness', sky.starBrightness);
      gl.bindVertexArray(this.starVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.starVertexCount);
      gl.bindVertexArray(null);
    }

    gl.disable(gl.BLEND);

    // ---- 4. dark bottom disc (only below the horizon height) ---------------
    if (camera.y < horizonHeight) {
      this.skyProgram.use();
      this.skyProgram.set3f('uSkyColor', 0, 0, 0);
      this.skyProgram.set3f('uFogColor', fogRgb[0], fogRgb[1], fogRgb[2]);
      this.skyProgram.set3f('uCamRight', right[0], right[1], right[2]);
      this.skyProgram.set3f('uCamUp', up[0], up[1], up[2]);
      this.skyProgram.set3f('uCamForward', forward[0], forward[1], forward[2]);
      this.skyProgram.set1f('uTanHalfFov', Math.tan((camera.fov * Math.PI) / 360));
      this.skyProgram.set1f('uAspect', camera.aspect);
      this.skyProgram.set1f('uSkyEnd', skyFogEnd);
      this.skyProgram.set1f('uFogAlpha', 1);
      this.skyProgram.set1i('uMode', 1);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(null);
    restoreDefaultState(gl);
  }

  /**
   * SkyRenderer.renderSunriseAndSunset (L441-470):
   *   pose = R_X(90) * R_Z((sin(sunAngle) < 0 ? 180 : 0) + 90), scale(1, 1, alpha)
   * applied to centre (0,100,0) and the ring (120 sin, 120 cos, -40 cos).
   */
  private buildSunriseVertices(sunAngleRad: number, alpha: number): void {
    const a = (Math.sin(sunAngleRad) < 0 ? Math.PI : 0) + Math.PI / 2;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const data = this.sunriseData;
    // centre (0,100,0) -> (-100 sin a, 0, 100 cos a)
    data[0] = -SUNRISE_CENTRE_Y * sinA;
    data[1] = 0;
    data[2] = SUNRISE_CENTRE_Y * cosA;
    data[3] = 1; data[4] = 1; data[5] = 1; data[6] = 1;
    for (let i = 0; i <= SUNRISE_STEPS; i++) {
      const theta = (i * Math.PI * 2) / SUNRISE_STEPS;
      const localX = SUNRISE_RING_RADIUS * Math.sin(theta);
      const localY = SUNRISE_RING_RADIUS * Math.cos(theta);
      const localZ = -SUNRISE_RING_DEPTH * Math.cos(theta) * alpha;
      // R_Z(a) then R_X(90)
      const rx = localX * cosA - localY * sinA;
      const ry = localX * sinA + localY * cosA;
      const o = 7 + i * 7;
      data[o] = rx;
      data[o + 1] = -localZ;
      data[o + 2] = ry;
      data[o + 3] = 1; data[o + 4] = 1; data[o + 5] = 1; data[o + 6] = 0;
    }
  }

  private drawCelestial(
    tex: WebGLTexture | null,
    flipUV: boolean,
    alpha: number,
    camera: CameraLike,
  ): void {
    if (!tex || !this.celestialProgram || !this.celestialVao) return;
    const gl = this.gl;
    this.celestialProgram.use();
    this.celestialProgram.setMat4('uViewProj', this.viewProj);
    this.celestialProgram.setMat4('uModel', this.model);
    this.celestialProgram.set3f('uCamPos', camera.x, camera.y, camera.z);
    this.celestialProgram.set1f('uAlpha', Math.max(0, Math.min(1, alpha)));
    this.celestialProgram.set1f('uFlipUV', flipUV ? 1 : 0);
    this.celestialProgram.set1i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(this.celestialVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const v of [this.quadVao, this.starVao, this.celestialVao, this.sunriseVao, this.endVao]) {
      if (v) gl.deleteVertexArray(v);
    }
    if (this.sunriseVbo) gl.deleteBuffer(this.sunriseVbo);
    if (this.endSkyTex) gl.deleteTexture(this.endSkyTex);
    this.bodies.dispose(gl);
  }
}

/**
 * Pure star geometry builder (no WebGL) so the layout can be unit tested.
 * Port of SkyRenderer.buildStars (L183-215).
 */
export function buildStarGeometry(
  rand: LegacyRandomSource,
  count: number,
  distance: number,
): StarGeometry {
  const out: number[] = [];
  // SkyRenderer.buildStars L201-204: (size,-size), (size,size), (-size,size), (-size,-size)
  const quad: [number, number][] = [
    [1, -1], [1, 1], [-1, 1], [-1, -1],
  ];
  for (let i = 0; i < count; i++) {
    const x = rand.nextFloat() * 2 - 1;
    const y = rand.nextFloat() * 2 - 1;
    const z = rand.nextFloat() * 2 - 1;
    const starSize = 0.15 + rand.nextFloat() * 0.1;
    const lengthSq = x * x + y * y + z * z;
    if (!(lengthSq <= 0.010000001) && !(lengthSq >= 1)) {
      const inv = distance / Math.sqrt(lengthSq);
      const cx = x * inv, cy = y * inv, cz = z * inv;
      const zRot = rand.nextDouble() * Math.PI * 2;
      // Matrix3f basis = rotateTowards(-center, +Y) then rotateZ(-zRot)
      const dirX = -cx / distance, dirY = -cy / distance, dirZ = -cz / distance;
      let leftX = 1 * dirZ - 0 * dirY;
      let leftY = 0 * dirX - 0 * dirZ;
      let leftZ = 0 * dirY - 1 * dirX;
      let leftLen = Math.hypot(leftX, leftY, leftZ);
      if (leftLen < 1e-6) {
        leftX = 1; leftY = 0; leftZ = 0;
        leftLen = 1;
      }
      leftX /= leftLen; leftY /= leftLen; leftZ /= leftLen;
      const upX = dirY * leftZ - dirZ * leftY;
      const upY = dirZ * leftX - dirX * leftZ;
      const upZ = dirX * leftY - dirY * leftX;
      const cosZ = Math.cos(-zRot), sinZ = Math.sin(-zRot);
      for (const [qx, qy] of quad) {
        const lx = qx * starSize, ly = qy * starSize;
        const rx = lx * cosZ - ly * sinZ;
        const ry = lx * sinZ + ly * cosZ;
        out.push(
          cx + leftX * rx + upX * ry,
          cy + leftY * rx + upY * ry,
          cz + leftZ * rx + upZ * ry,
        );
      }
    }
  }
  // QUADS -> TRIANGLES (0,1,2, 0,2,3)
  const tri: number[] = [];
  for (let i = 0; i < out.length; i += 12) {
    const v = (k: number) => [out[i + k * 3], out[i + k * 3 + 1], out[i + k * 3 + 2]];
    const [a, b, c, d] = [v(0), v(1), v(2), v(3)];
    tri.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return { data: new Float32Array(tri), vertexCount: tri.length / 3 };
}
