// Shared types and helpers for the environment renderers.
//
// These modules are deliberately independent of LevelRenderer / Game: everything
// they need from the world is expressed through the structural LevelLike interface
// so the main agent can wire the real ClientLevel (or a stub) without us importing
// integration files that other agents own.

import { loadImage, mat4Mul, mat4Perspective, mat4View } from '../gl/Gl.js';
import { computeSkyState, DAY_PERIOD, type SkyState } from '../../EnvironmentLighting.js';

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
  gameTime?: number;
  time?: number;
  isRaining?(): boolean;
  rainLevel?: number;
  thunderLevel?: number;
}

export function timeOfDayOf(level?: LevelLike | null): number {
  if (!level) return 0;
  if (typeof level.getTimeOfDay === 'function') return level.getTimeOfDay();
  if (typeof level.time === 'number') return ((level.time % 24000) + 24000) % 24000 / 24000;
  return 0;
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

/** 0..7, full moon first (matches MoonPhase index order in 26.2). */
export function moonPhaseOf(level?: LevelLike | null): number {
  if (!level) return 0;
  if (typeof level.getMoonPhase === 'function') {
    return ((Math.trunc(level.getMoonPhase()) % 8) + 8) % 8;
  }
  return 0;
}

/** Evaluates the overworld day timeline for a 0..1 time-of-day value. */
export function skyStateFor(timeOfDay: number): SkyState {
  return computeSkyState(timeOfDay * DAY_PERIOD);
}

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
}
