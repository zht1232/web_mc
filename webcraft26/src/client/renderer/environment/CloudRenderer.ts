// Port of the classic LevelRenderer.renderClouds 12x12 tiled cloud sheet
// (the task's target), with a nod to 26.2's CloudRenderer for drift constants.
//
// clouds.png is read once: its alpha decides which 12x12 cells exist. A single
// static VBO holds all cell quads; drift and camera following are done with
// uniforms so the VBO never needs rebuilding. fast = one flat layer, fancy =
// three stacked volumetric slices. Both are drawn double sided.

import { GlProgram, loadImage } from '../gl/Gl.js';
import {
  loadEnvTexture, rainLevelOf, restoreDefaultState, skyStateFor,
  timeOfDayOf, type CameraLike, type LevelLike,
} from './EnvCommon.js';

export type CloudsQuality = 'off' | 'fast' | 'fancy';

/** Vanilla fast-cloud constants. */
export const CLOUD_CELL_SIZE = 12;      // blocks per cell
export const CLOUD_HEIGHT = 128;        // classic overworld cloud height
export const FAST_VERTS_PER_CELL = 6;   // two triangles
export const FANCY_LAYERS = 3;

export interface CloudMeshData {
  /** interleaved: vec3 pos (relative to the 12-aligned camera origin), vec2 uv, float shade */
  vertices: Float32Array;
  vertexCount: number;
  cellCount: number;      // number of non-empty cells
  gridCells: number;      // (2*radiusCells+1)^2 candidate cells
  layers: number;
  uvMin: number;
  uvMax: number;
  width: number;
  height: number;
  quality: CloudsQuality;
}

/**
 * Pure mesh builder (no WebGL / DOM) so it can be unit-tested in Node.
 * `alpha` is either a width*height Uint8Array of alpha values or a sampler.
 * Each emitted UV is normalised into [0,1] and maps one clouds.png texel.
 */
export function buildCloudMesh(
  width: number,
  height: number,
  alpha: Uint8Array | ((x: number, y: number) => number),
  quality: CloudsQuality,
  radiusCells = 8,
): CloudMeshData {
  const sample: (x: number, y: number) => number = typeof alpha === 'function'
    ? alpha
    : (x, y) => alpha[x + y * width] ?? 0;
  const layers = quality === 'fancy' ? FANCY_LAYERS : 1;
  const gridCells = (2 * radiusCells + 1) * (2 * radiusCells + 1);
  const out: number[] = [];
  let cellCount = 0;
  let uvMin = 1, uvMax = 0;

  const push = (x: number, y: number, z: number, u: number, v: number, shade: number) => {
    out.push(x, y, z, u, v, shade);
    if (u < uvMin) uvMin = u; if (v < uvMin) uvMin = v;
    if (u > uvMax) uvMax = u; if (v > uvMax) uvMax = v;
  };

  for (let cz = -radiusCells; cz <= radiusCells; cz++) {
    for (let cx = -radiusCells; cx <= radiusCells; cx++) {
      const tx = ((cx % width) + width) % width;
      const ty = ((cz % height) + height) % height;
      if (sample(tx, ty) <= 10) continue;   // vanilla ARGB.alpha < 10 => empty
      cellCount++;
      const x0 = cx * CLOUD_CELL_SIZE, x1 = x0 + CLOUD_CELL_SIZE;
      const z0 = cz * CLOUD_CELL_SIZE, z1 = z0 + CLOUD_CELL_SIZE;
      const u0 = tx / width, u1 = (tx + 1) / width;
      const v0 = ty / height, v1 = (ty + 1) / height;
      for (let layer = 0; layer < layers; layer++) {
        const y = -layer * 0.6;
        const ox = layer * 0.15, oz = layer * 0.15;
        const shade = 1 - layer * 0.12;
        push(x0 + ox, y, z0 + oz, u0, v0, shade);
        push(x1 + ox, y, z0 + oz, u1, v0, shade);
        push(x1 + ox, y, z1 + oz, u1, v1, shade);
        push(x0 + ox, y, z0 + oz, u0, v0, shade);
        push(x1 + ox, y, z1 + oz, u1, v1, shade);
        push(x0 + ox, y, z1 + oz, u0, v1, shade);
      }
    }
  }
  return {
    vertices: new Float32Array(out),
    vertexCount: out.length / 6,
    cellCount,
    gridCells,
    layers,
    uvMin: out.length ? uvMin : 0,
    uvMax: out.length ? uvMax : 0,
    width, height, quality,
  };
}

const CLOUD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aShade;
uniform mat4 uViewProj;
uniform vec3 uBase;        // 12-aligned camera origin (x,z) and cloud height y
uniform vec2 uUvOffset;
out vec2 vUV;
out float vShade;
void main() {
  vec3 world = vec3(aPos.x + uBase.x, uBase.y + aPos.y, aPos.z + uBase.z);
  gl_Position = uViewProj * vec4(world, 1.0);
  vUV = aUV + uUvOffset;
  vShade = aShade;
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vShade;
uniform sampler2D uTex;
uniform vec4 uTint;
out vec4 fragColor;
void main() {
  vec4 c = texture(uTex, vUV) * uTint;
  if (c.a < 0.02) discard;
  float side = gl_FrontFacing ? 1.0 : 0.72;   // darker cloud underside
  fragColor = vec4(c.rgb * vShade * side, c.a);
}`;

export interface CloudOptions {
  quality?: CloudsQuality;
  height?: number;
  radiusCells?: number;
}

export class CloudRenderer {
  quality: CloudsQuality;
  height: number;
  private readonly radiusCells: number;
  private program: GlProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private cloudTex: WebGLTexture | null = null;
  private texWidth = 256;
  private texHeight = 256;
  private mesh: CloudMeshData | null = null;

  constructor(private readonly gl: WebGL2RenderingContext, opts: CloudOptions = {}) {
    this.quality = opts.quality ?? 'fancy';
    this.height = opts.height ?? CLOUD_HEIGHT;
    this.radiusCells = opts.radiusCells ?? 8;
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.program = new GlProgram(gl, CLOUD_VS, CLOUD_FS, 'env.clouds');
    const img = await loadImage('/mc/textures/environment/clouds.png');
    this.texWidth = img.width;
    this.texHeight = img.height;

    // read alpha from the PNG (browser canvas)
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    const alpha = new Uint8Array(img.width * img.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    this.alphaCache = alpha;

    this.cloudTex = await loadEnvTexture(gl, 'environment/clouds', gl.REPEAT, gl.NEAREST);
    this.rebuildMesh();
  }

  /** Regenerates the VBO after a quality change. */
  setQuality(q: CloudsQuality): void { this.quality = q; this.rebuildMesh(); }

  private rebuildMesh(): void {
    if (!this.program) return;
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    const alpha = this.alphaCache ?? new Uint8Array(this.texWidth * this.texHeight).fill(255);
    this.mesh = buildCloudMesh(this.texWidth, this.texHeight, alpha, this.quality, this.radiusCells);

    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
  }

  private alphaCache: Uint8Array | null = null;

  /** Exposes mesh stats for the verification script. */
  get meshStats(): { vertexCount: number; cellCount: number; gridCells: number; layers: number; uvMin: number; uvMax: number } {
    const m = this.mesh;
    return {
      vertexCount: m?.vertexCount ?? 0,
      cellCount: m?.cellCount ?? 0,
      gridCells: m?.gridCells ?? 0,
      layers: m?.layers ?? 0,
      uvMin: m?.uvMin ?? 0,
      uvMax: m?.uvMax ?? 0,
    };
  }

  /**
   * @param viewProj  proj*view (column major)
   * @param camera    camera position (cloud grid is aligned to it)
   * @param tickTime  world time in ticks (20/s) used for drift
   * @param level     read for time-of-day and rain strength
   */
  render(viewProj: Float32Array, camera: CameraLike, tickTime: number, level?: LevelLike | null): void {
    const gl = this.gl;
    if (this.quality === 'off' || !this.program || !this.vao || !this.cloudTex || !this.mesh?.vertexCount) return;
    const sky = skyStateFor(timeOfDayOf(level));
    const rain = rainLevelOf(level);
    const driftBlocks = tickTime * 0.03;   // vanilla cloud offset per tick
    const uvOffX = driftBlocks / (this.texWidth * CLOUD_CELL_SIZE);
    const uvOffZ = 3.96 / (this.texHeight * CLOUD_CELL_SIZE);

    const baseX = Math.floor(camera.x / CLOUD_CELL_SIZE) * CLOUD_CELL_SIZE;
    const baseZ = Math.floor(camera.z / CLOUD_CELL_SIZE) * CLOUD_CELL_SIZE;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);            // double sided clouds

    this.program.use();
    this.program.setMat4('uViewProj', viewProj);
    this.program.set3f('uBase', baseX, this.height, baseZ);
    this.program.set2f('uUvOffset', uvOffX, uvOffZ);
    // cloud colour: day timeline, dimmed toward fog when raining
    const r = sky.cloudColor[0] * (1 - rain * 0.45);
    const g = sky.cloudColor[1] * (1 - rain * 0.45);
    const b = sky.cloudColor[2] * (1 - rain * 0.45);
    this.program.set4f('uTint', r, g, b, 0.8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    this.program.set1i('uTex', 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.mesh.vertexCount);
    gl.bindVertexArray(null);

    restoreDefaultState(gl);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.cloudTex) gl.deleteTexture(this.cloudTex);
  }
}
