// Shared types and helpers for the environment renderers.
//
// These modules are deliberately independent of LevelRenderer / Game: everything
// they need from the world is expressed through the structural LevelLike interface
// so the main agent can wire the real ClientLevel (or a stub) without us importing
// integration files that other agents own.

import { loadImage, mat4Mul, mat4Perspective, mat4View } from '../gl/Gl.js';
import {
  computeSkyState, DAY_PERIOD, type SkyState,
} from '../../EnvironmentLighting.js';

/** Same shape as renderer/LevelRenderer.ts Camera, kept structural. */
export interface CameraLike {
  x: number; y: number; z: number;
  yaw: number; pitch: number;   // degrees, Minecraft convention (yaw 0 = +Z)
  fov: number; aspect: number;
}

/**
 * The subset of ClientLevel the environment/particle/audio modules consume.
 * Every member is optional so both the current ClientLevel (getRainLevel /
 * getThunderLevel / getTimeOfDay) and the field-based shape described in the
 * task (rainLevel / thunderLevel / isRaining) are accepted.
 */
export interface LevelLike {
  getTimeOfDay?(): number;
  getRainLevel?(): number;
  getThunderLevel?(): number;
  getBiome?(x: number, y: number, z: number): number;
  getHeight?(x: number, z: number): number;
  getMoonPhase?(): number;
  getSkyLight?(x: number, y: number, z: number): number;
  getBlockLight?(x: number, y: number, z: number): number;
  gameTime?: number;
  time?: number;
  isRaining?(): boolean;
  rainLevel?: number;
  thunderLevel?: number;
  /** dimension sea level, used by SkyRenderer#shouldRenderDarkDisc */
  horizonHeight?: number;
}

// ---------------------------------------------------------------------------
// Vanilla constants. Every number carries the class/field it was copied from.
// ---------------------------------------------------------------------------

/** SkyRenderer.java L49: SKY_DISC_RADIUS */
export const SKY_DISC_RADIUS = 512;
/** SkyRenderer.java L50: SKY_VERTICES (a triangle fan, 1 centre + 9 ring vertices) */
export const SKY_VERTICES = 10;
/** SkyRenderer.java L51: STAR_COUNT */
export const STAR_COUNT = 1500;
/** SkyRenderer.java L52-55: SUN_SIZE / SUN_HEIGHT / MOON_SIZE / MOON_HEIGHT */
export const SUN_SIZE = 30;
export const SUN_HEIGHT = 100;
export const MOON_SIZE = 20;
export const MOON_HEIGHT = 100;
/** SkyRenderer.java L56: SUNRISE_STEPS (16 ring segments => 18 fan vertices) */
export const SUNRISE_STEPS = 16;
/** SkyRenderer.java L115/121: sunrise fan centre y and ring radii */
export const SUNRISE_CENTRE_Y = 100;
export const SUNRISE_RING_RADIUS = 120;
export const SUNRISE_RING_DEPTH = 40;
/** SkyRenderer.java L218: top/bottom sky disc plane height */
export const SKY_DISC_Y = 16;

/** EnvironmentAttributes: visual/sky_fog_end_distance default 512 */
export const DEFAULT_SKY_FOG_END = 512;
/** EnvironmentAttributes: visual/cloud_fog_end_distance default 2048 */
export const DEFAULT_CLOUD_FOG_END = 2048;
/** EnvironmentAttributes: visual/cloud_height default 192.33 */
export const DEFAULT_CLOUD_HEIGHT = 192.33;
/** CloudRenderer.java L36: CELL_SIZE_IN_BLOCKS */
export const CLOUD_CELL_SIZE = 12;
/** CloudRenderer.java L37-38: TICKS_PER_CELL = 400, BLOCKS_PER_SECOND = 0.6 */
export const CLOUD_TICKS_PER_CELL = 400;
export const CLOUD_BLOCKS_PER_SECOND = 0.6;
/** CloudRenderer.java L162-164: cloud drift (0.03 blocks/tick) and the +3.96 z offset */
export const CLOUD_DRIFT_PER_TICK = 0.03;
export const CLOUD_Z_OFFSET = 3.96;

// ---------------------------------------------------------------------------
// Level accessors
// ---------------------------------------------------------------------------

export function timeOfDayOf(level?: LevelLike | null): number {
  if (!level) return 0;
  if (typeof level.getTimeOfDay === 'function') return level.getTimeOfDay();
  if (typeof level.time === 'number') return ((level.time % 24000) + 24000) % 24000 / 24000;
  return 0;
}

/** World time in ticks 0..24000 (the axis the 26.2 timeline is defined on). */
export function ticksOf(level?: LevelLike | null): number {
  if (level && typeof level.time === 'number') {
    const t = level.time % DAY_PERIOD;
    return t < 0 ? t + DAY_PERIOD : t;
  }
  return (timeOfDayOf(level) * DAY_PERIOD) % DAY_PERIOD;
}

export function rainLevelOf(level?: LevelLike | null): number {
  if (!level) return 0;
  if (typeof level.getRainLevel === 'function') return level.getRainLevel();
  if (typeof level.rainLevel === 'number') return level.rainLevel;
  if (typeof level.isRaining === 'function') return level.isRaining() ? 1 : 0;
  return 0;
}

export function thunderLevelOf(level?: LevelLike | null): number {
  if (!level) return 0;
  if (typeof level.getThunderLevel === 'function') return level.getThunderLevel();
  if (typeof level.thunderLevel === 'number') return level.thunderLevel;
  return 0;
}

/**
 * Moon phase 0..7 (0 = full moon), Timelines.MOON: period 24000 * MoonPhase.COUNT
 * with one keyframe per phase at MoonPhase#startTick => floor(totalTicks / 24000) % 8.
 */
export function moonPhaseOf(level?: LevelLike | null): number {
  if (!level) return 0;
  if (typeof level.getMoonPhase === 'function') {
    return ((Math.trunc(level.getMoonPhase()) % 8) + 8) % 8;
  }
  if (typeof level.gameTime === 'number') {
    return ((Math.floor(level.gameTime / 24000) % 8) + 8) % 8;
  }
  return 0;
}

/** Evaluates the overworld 26.2 environment attributes for a 0..1 time-of-day value. */
export function skyStateFor(timeOfDay: number): SkyState {
  return computeSkyState(timeOfDay * DAY_PERIOD);
}

/**
 * SkyState for a level. Uses level.time (the 0..24000 timeline axis), NOT
 * ClientLevel.getTimeOfDay() - that one is phase shifted by -0.75 (0 = midnight) in
 * this codebase and would return the noon colours at midnight.
 */
export function skyStateOf(level?: LevelLike | null): SkyState {
  return computeSkyState(ticksOf(level));
}

// ---------------------------------------------------------------------------
// Column major 4x4 matrix helpers (enough for the celestial billboards).
// ---------------------------------------------------------------------------

export function mat4RotationX(rad: number, out = new Float32Array(16)): Float32Array {
  const c = Math.cos(rad), s = Math.sin(rad);
  out.fill(0);
  out[0] = 1; out[5] = c; out[6] = s; out[9] = -s; out[10] = c; out[15] = 1;
  return out;
}

export function mat4RotationY(rad: number, out = new Float32Array(16)): Float32Array {
  const c = Math.cos(rad), s = Math.sin(rad);
  out.fill(0);
  out[0] = c; out[2] = -s; out[5] = 1; out[8] = s; out[10] = c; out[15] = 1;
  return out;
}

export function mat4Translation(x: number, y: number, z: number, out = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function mat4Scaling(x: number, y: number, z: number, out = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = x; out[5] = y; out[10] = z; out[15] = 1;
  return out;
}

/**
 * Model matrix for a celestial billboard, matching SkyRenderer.renderSun/renderMoon:
 *   pose = R_Y(-90) * R_X(angle)          (renderSunMoonAndStars L342-349)
 *   then translate(0, height, 0), scale(size, 1, size)  (L365-366 / L393-394)
 */
export function celestialModelMatrix(
  angleRad: number,
  size: number,
  height: number,
  out = new Float32Array(16),
): Float32Array {
  const ry = mat4RotationY(-Math.PI / 2, TEMP_A);
  const rx = mat4RotationX(angleRad, TEMP_B);
  mat4Mul(ry, rx, TEMP_C);                                            // R_Y(-90) * R_X(angle)
  mat4Mul(TEMP_C, mat4Translation(0, height, 0, TEMP_D), TEMP_E);     // * T(0,height,0)
  return mat4Mul(TEMP_E, mat4Scaling(size, 1, size, TEMP_F), out);    // * S(size,1,size)
}

const TEMP_A = new Float32Array(16);
const TEMP_B = new Float32Array(16);
const TEMP_C = new Float32Array(16);
const TEMP_D = new Float32Array(16);
const TEMP_E = new Float32Array(16);
const TEMP_F = new Float32Array(16);

/** Builds view*proj from a camera; used when a caller only has the camera. */
export function computeViewProj(camera: CameraLike, out = new Float32Array(16)): Float32Array {
  const proj = mat4Perspective((camera.fov * Math.PI) / 180, camera.aspect, 0.05, 1024);
  const view = mat4View(
    camera.x, camera.y, camera.z,
    (camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180,
  );
  return mat4Mul(proj, view, out);
}

/** Loads a loose PNG under /mc/textures/ and uploads it as a WebGL texture. */
export async function loadEnvTexture(
  gl: WebGL2RenderingContext,
  path: string,
  wrap: number = gl.CLAMP_TO_EDGE,
  filter: number = gl.NEAREST,
): Promise<WebGLTexture> {
  const img = await loadImage(`/mc/textures/${path}.png`);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return tex;
}

/** Creates a fullscreen clip-space quad VAO (two triangles, vec2 positions). */
export function createFullscreenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, 1, 1,
    -1, -1, 1, 1, -1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);
  return vao;
}

/**
 * GL state contract shared by the environment/particle passes:
 * on entry depth test is assumed ON with depthFunc LEQUAL; on exit we restore
 * depthMask(TRUE), depth test ON, cull face BACK ON and blend OFF so the
 * post-processing pipeline sees a clean state. Each render() documents any
 * temporary changes it makes.
 */
export function restoreDefaultState(gl: WebGL2RenderingContext): void {
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.disable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

/** Blending state of com.mojang.blaze3d.pipeline.BlendFunction.OVERLAY. */
export function setOverlayBlend(gl: WebGL2RenderingContext): void {
  // OVERLAY = (SRC_ALPHA, ONE) for colour, (ONE, ZERO) for alpha.
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ZERO);
}

/** Blending state of BlendFunction.TRANSLUCENT. */
export function setTranslucentBlend(gl: WebGL2RenderingContext): void {
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}
