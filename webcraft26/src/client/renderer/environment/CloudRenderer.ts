// Port of net.minecraft.client.renderer.CloudRenderer (26.2) - voxel extruded clouds.
//
// 26.2 replaced the old flat 12x12 cloud sheet with a per-cell extruded mesh:
//   * every non-empty texel of textures/environment/clouds.png is one 12x12x4 cell
//     (CELL_SIZE_IN_BLOCKS = 12.0F, the +4 is the extrusion height)
//   * only faces that can be seen from the camera are emitted (top/bottom depend on
//     whether the camera is below/above the cloud layer, sides only when the
//     neighbouring cell along that direction is empty)
//   * cells within one cell of the centre also get all six faces (FLAG_INSIDE_FACE)
//     so being inside a cloud shows a surface
//   * the texture colour is never sampled by the shader: the cloud colour is the
//     CLOUD_COLOR attribute (SkyState.cloudColor) and the texture only decides
//     occupancy (CloudRenderer.prepare => isCellEmpty = ARGB.alpha < 10)
//   * face shading comes from core/rendertype_clouds.vsh: top 1.0, north/south 0.8,
//     west/east 0.9, bottom 0.7
//   * distance fade: alpha *= 1 - linear_fog_value(length(pos), 0, FogCloudsEnd)
//
// Draw order relative to the rest of the frame: the cloud pass is translucent and
// never writes depth (see 05-environment-audio.md), it only reads the depth buffer
// so terrain/entities can occlude the cloud layer.

import { GlProgram, loadImage } from '../gl/Gl.js';
import {
  CLOUD_CELL_SIZE,
  CLOUD_DRIFT_PER_TICK,
  CLOUD_Z_OFFSET,
  DEFAULT_CLOUD_FOG_END,
  DEFAULT_CLOUD_HEIGHT,
  loadEnvTexture,
  restoreDefaultState,
  setTranslucentBlend,
  skyStateOf,
  ticksOf,
  type CameraLike,
  type LevelLike,
} from './EnvCommon.js';

export type CloudsQuality = 'off' | 'fast' | 'fancy';

/** Vanilla fast-cloud constants (kept for the legacy unit test). */
export const FAST_VERTS_PER_CELL = 6;   // two triangles
export const FANCY_LAYERS = 3;
/** CloudRenderer.java L36: CELL_SIZE_IN_BLOCKS (also exported from EnvCommon). */
export { CLOUD_CELL_SIZE };
/** Kept for backwards compatibility; 26.2 uses the dimension attribute (192.33). */
export const CLOUD_HEIGHT = 128;

/** CloudStatus values of the 26.2 options screen. */
export type CloudStatus = 'off' | 'fast' | 'fancy';

/** A cell is empty when ARGB.alpha < 10 (CloudRenderer.isCellEmpty). */
const EMPTY_ALPHA = 10;
/** Mth/Java floorMod */
function floorMod(a: number, b: number): number { return ((a % b) + b) % b; }
/** Direction indices matching Direction.get3DDataValue(). */
const DOWN = 0, UP = 1, NORTH = 2, SOUTH = 3, WEST = 4, EAST = 5;
/** FLAG_USE_TOP_COLOR (CloudRenderer L35). */
const FLAG_USE_TOP_COLOR = 32;

/**
 * Face vertex tables, copied verbatim from
 * vanilla/assets/minecraft/shaders/core/rendertype_clouds.vsh (vertices[]).
 * The cube spans [0,1]^3 in cell space; the cell origin is added by the vertex shader.
 */
const FACE_VERTICES: readonly number[] = [
  // Bottom face
  1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0,
  // Top face
  0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0,
  // North face
  0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0,
  // South face
  1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1,
  // West face
  0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0,
  // East face
  1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1,
];

/** core/rendertype_clouds.vsh faceColors[]: bottom, top, north, south, west, east. */
const FACE_COLORS: readonly number[] = [0.7, 1.0, 0.8, 0.8, 0.9, 0.9];

const FLOATS_PER_CLOUD_VERTEX = 6; // vec3 faceVertex + vec2 cell + float shade

export interface CloudVoxelMesh {
  /** interleaved: vec3 (0/1 face corner), vec2 (cellX, cellZ), float shade */
  vertices: Float32Array;
  vertexCount: number;
  faceCount: number;
  cellCount: number;
  /** cells considered by the ring scan (vanilla buildMesh candidate count) */
  candidateCount: number;
}

export interface CloudTextureData {
  /** 1 = non-empty cell, 0 = empty (CloudRenderer.TextureData.cells) */
  occupancy: Uint8Array;
  /** bit 3 north, bit 2 east, bit 1 south, bit 0 west: neighbour cell is empty */
  emptyNeighbour: Uint8Array;
  width: number;
  height: number;
}

/** Port of CloudRenderer.prepare (L58-92): pack occupancy + neighbour emptiness. */
export function buildCloudTextureData(alpha: Uint8Array, width: number, height: number): CloudTextureData {
  const occupancy = new Uint8Array(width * height);
  const emptyNeighbour = new Uint8Array(width * height);
  const at = (x: number, y: number) => alpha[floorMod(x, width) + floorMod(y, height) * width] ?? 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) <= EMPTY_ALPHA) continue;
      const i = x + y * width;
      occupancy[i] = 1;
      emptyNeighbour[i] =
        (at(x, y - 1) <= EMPTY_ALPHA ? 0b1000 : 0) |
        (at(x + 1, y) <= EMPTY_ALPHA ? 0b0100 : 0) |
        (at(x, y + 1) <= EMPTY_ALPHA ? 0b0010 : 0) |
        (at(x - 1, y) <= EMPTY_ALPHA ? 0b0001 : 0);
    }
  }
  return { occupancy, emptyNeighbour, width, height };
}

export type RelativeCameraPos = 'above' | 'inside' | 'below';

/**
 * Port of CloudRenderer.buildMesh/buildExtrudedCell/buildFlatCell (L231-331).
 * `centerCellX/Z` are absolute cell coordinates; `radiusCells` is Mth.ceil(rangeBlocks/12).
 */
export function buildCloudVoxelMesh(
  data: CloudTextureData,
  centerCellX: number,
  centerCellZ: number,
  relativePos: RelativeCameraPos,
  extrude: boolean,
  radiusCells: number,
  out: CloudVoxelMesh,
): CloudVoxelMesh {
  const { occupancy, emptyNeighbour, width, height } = data;
  const verts = out.vertices;
  let n = 0;
  let faceCount = 0;
  let cellCount = 0;
  let candidateCount = 0;
  const maxCells = Math.max(1, Math.ceil(Math.PI * (radiusCells + 1) ** 2));
  // Worst case: 4 faces per candidate cell (top+bottom+two sides), plus the 3x3 centre
  // cells that also get the six inside faces.
  const maxFaces = maxCells * 4 + 54;
  if (verts.length < maxFaces * 6 * FLOATS_PER_CLOUD_VERTEX) {
    throw new Error(`cloud vertex buffer too small for radius ${radiusCells}`);
  }
  const radiusSq = radiusCells * radiusCells;

  const pushFace = (cx: number, cz: number, direction: number, insideFace: boolean, topColor: boolean) => {
    const base = direction * 12;
    const color = FACE_COLORS[topColor ? UP : direction];
    // QUADS -> TRIANGLES (0,1,2, 0,2,3); inside faces are wound the other way round.
    for (let k = 0; k < 6; k++) {
      const q = k === 3 ? 0 : k === 4 ? 2 : k === 5 ? 3 : k;
      const src = insideFace ? 3 - q : q;
      verts[n++] = FACE_VERTICES[base + src * 3];
      verts[n++] = FACE_VERTICES[base + src * 3 + 1];
      verts[n++] = FACE_VERTICES[base + src * 3 + 2];
      verts[n++] = cx;
      verts[n++] = cz;
      verts[n++] = color;
    }
    faceCount++;
  };

  const buildCell = (relX: number, relZ: number) => {
    const ix = floorMod(centerCellX + relX, width);
    const iy = floorMod(centerCellZ + relZ, height);
    const i = ix + iy * width;
    if (occupancy[i] === 0) return;
    cellCount++;
    if (!extrude) {
      // FLAT_CLOUDS: one downward quad that uses the top face colour.
      pushFace(relX, relZ, DOWN, false, true);
      return;
    }
    if (relativePos !== 'below') pushFace(relX, relZ, UP, false, false);
    if (relativePos !== 'above') pushFace(relX, relZ, DOWN, false, false);
    const flags = emptyNeighbour[i];
    if ((flags & 0b1000) !== 0 && relZ > 0) pushFace(relX, relZ, NORTH, false, false);
    if ((flags & 0b0010) !== 0 && relZ < 0) pushFace(relX, relZ, SOUTH, false, false);
    if ((flags & 0b0001) !== 0 && relX > 0) pushFace(relX, relZ, WEST, false, false);
    if ((flags & 0b0100) !== 0 && relX < 0) pushFace(relX, relZ, EAST, false, false);
    // Cells touching the camera get all six faces so you can see them from inside.
    if (Math.abs(relX) <= 1 && Math.abs(relZ) <= 1) {
      for (let dir = 0; dir < 6; dir++) pushFace(relX, relZ, dir, true, false);
    }
  };

  for (let ring = 0; ring <= 2 * radiusCells; ring++) {
    for (let relX = -ring; relX <= ring; relX++) {
      const relZ = ring - Math.abs(relX);
      if (relZ < 0 || relZ > radiusCells || relX * relX + relZ * relZ > radiusSq) continue;
      candidateCount++;
      if (relZ !== 0) buildCell(relX, -relZ);
      buildCell(relX, relZ);
    }
  }

  out.vertexCount = n / FLOATS_PER_CLOUD_VERTEX;
  out.faceCount = faceCount;
  out.cellCount = cellCount;
  out.candidateCount = candidateCount;
  return out;
}

/** Shared, reused mesh storage (buffer sized for the configured radius). */
export function createCloudVoxelMesh(radiusCells: number): CloudVoxelMesh {
  const maxCells = Math.max(1, Math.ceil(Math.PI * (radiusCells + 1) ** 2));
  // worst case: 4 faces per cell + the 3x3 centre cells that also get six inside faces
  const maxFaces = maxCells * 4 + 54;
  return {
    vertices: new Float32Array(maxFaces * 6 * FLOATS_PER_CLOUD_VERTEX),
    vertexCount: 0,
    faceCount: 0,
    cellCount: 0,
    candidateCount: 0,
  };
}

const CLOUD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aFaceVertex;   // 0/1 corner of the cell
layout(location = 1) in vec2 aCell;         // absolute cell coordinate
layout(location = 2) in float aShade;       // face colour from rendertype_clouds.vsh
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uCloudOffset;   // (-xInCell, relativeBottomY, -zInCell)
uniform vec3 uCellSize;      // (12, 4, 12)
out float vShade;
out float vDistance;
void main() {
  vec3 rel = aFaceVertex * uCellSize + vec3(aCell.x, 0.0, aCell.y) * uCellSize + uCloudOffset;
  gl_Position = uViewProj * vec4(uCamPos + rel, 1.0);
  vShade = aShade;
  vDistance = length(rel);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
in float vShade;
in float vDistance;
uniform vec4 uCloudColor;
uniform float uCloudEnd;
out vec4 fragColor;
void main() {
  // core/rendertype_clouds.fsh: color.a *= 1 - linear_fog_value(vertexDistance, 0, FogCloudsEnd)
  float fog = clamp(vDistance / uCloudEnd, 0.0, 1.0);
  fragColor = vec4(uCloudColor.rgb * vShade, uCloudColor.a * (1.0 - fog));
}`;

export interface CloudOptions {
  quality?: CloudsQuality;
  /** visual/cloud_height attribute (192.33 in 26.2). */
  height?: number;
  /** options cloudRange, in chunks (vanilla default 128; capped for WebGL). */
  rangeChunks?: number;
  /** visual/cloud_fog_end_distance */
  fogEnd?: number;
}

export class CloudRenderer {
  quality: CloudsQuality;
  height: number;
  rangeChunks: number;
  fogEnd: number;
  private program: GlProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private cloudTex: WebGLTexture | null = null;
  private alphaCache: Uint8Array | null = null;
  private texWidth = 256;
  private texHeight = 256;
  private data: CloudTextureData | null = null;
  private mesh: CloudVoxelMesh | null = null;
  private needsRebuild = true;
  private prevCellX = Number.NaN;
  private prevCellZ = Number.NaN;
  private prevRelativePos: RelativeCameraPos | 'unset' = 'unset';
  private prevQuality: CloudsQuality | null = null;

  constructor(private readonly gl: WebGL2RenderingContext, opts: CloudOptions = {}) {
    this.quality = opts.quality ?? 'fancy';
    this.height = opts.height ?? DEFAULT_CLOUD_HEIGHT;
    this.rangeChunks = opts.rangeChunks ?? 32;
    this.fogEnd = opts.fogEnd ?? DEFAULT_CLOUD_FOG_END;
  }

  /** radiusBlocks = range * 16, radiusCells = Mth.ceil(radiusBlocks / 12) (CloudRenderer.render). */
  get radiusCells(): number {
    return Math.ceil((this.rangeChunks * 16) / CLOUD_CELL_SIZE);
  }

  private get cloudEnd(): number {
    // FogData.cloudEnd = min(cloudRange * 16, visual/cloud_fog_end_distance)
    return Math.min(this.rangeChunks * 16, this.fogEnd);
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.program = new GlProgram(gl, CLOUD_VS, CLOUD_FS, 'env.clouds');
    const img = await loadImage('/mc/textures/environment/clouds.png');
    this.texWidth = img.width;
    this.texHeight = img.height;

    // The texture only decides occupancy: CloudRenderer.isCellEmpty checks the alpha channel.
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    const alpha = new Uint8Array(img.width * img.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    this.alphaCache = alpha;
    this.data = buildCloudTextureData(alpha, img.width, img.height);

    this.cloudTex = await loadEnvTexture(gl, 'environment/clouds', gl.REPEAT, gl.NEAREST);
    this.mesh = createCloudVoxelMesh(this.radiusCells);
    this.needsRebuild = true;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.vertices.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
  }

  /** Regenerates the mesh after a quality / range change. */
  setQuality(q: CloudsQuality): void { this.quality = q; this.needsRebuild = true; }

  setRange(chunks: number): void {
    this.rangeChunks = Math.max(2, Math.min(128, Math.trunc(chunks)));
    this.mesh = createCloudVoxelMesh(this.radiusCells);
    this.needsRebuild = true;
  }

  /** Exposes mesh statistics for the verification scripts / HUD debug. */
  get meshStats(): {
    vertexCount: number; faceCount: number; cellCount: number; candidateCount: number;
    radiusCells: number; cloudEnd: number;
  } {
    const m = this.mesh;
    return {
      vertexCount: m?.vertexCount ?? 0,
      faceCount: m?.faceCount ?? 0,
      cellCount: m?.cellCount ?? 0,
      candidateCount: m?.candidateCount ?? 0,
      radiusCells: this.radiusCells,
      cloudEnd: this.cloudEnd,
    };
  }

  private rebuildMesh(
    cellX: number, cellZ: number, relativePos: RelativeCameraPos, fancy: boolean,
  ): void {
    const gl = this.gl;
    if (!this.data || !this.mesh || !this.vbo) return;
    buildCloudVoxelMesh(this.data, cellX, cellZ, relativePos, fancy, this.radiusCells, this.mesh);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.vertices.subarray(0, this.mesh.vertexCount * FLOATS_PER_CLOUD_VERTEX), gl.DYNAMIC_DRAW);
  }

  /**
   * CloudRenderer.render (L130-229). The cloud grid follows the camera: the absolute
   * cell is derived from the drifted camera position, which is why the mesh only has
   * to be rebuilt when the camera crosses a cell boundary.
   *
   * @param viewProj  proj*view (column major)
   * @param camera    camera position
   * @param tickTime  world time in ticks (drift); level.gameTime is preferred
   * @param level     read for the cloud colour (SkyState) and the wall clock
   */
  render(viewProj: Float32Array, camera: CameraLike, tickTime: number, level?: LevelLike | null): void {
    const gl = this.gl;
    const quality = this.quality;
    if (quality === 'off' || !this.program || !this.vao || !this.mesh) return;
    if (!this.data) return;

    const sky = skyStateOf(level);
    const ticks = level && typeof level.gameTime === 'number' ? level.gameTime : tickTime;
    const fancy = quality === 'fancy';

    // CloudRenderer.render L151-199
    const relativeBottomY = this.height - camera.y;
    const relativeTopY = relativeBottomY + 4;
    const relativePos: RelativeCameraPos = relativeTopY < 0 ? 'above' : relativeBottomY > 0 ? 'below' : 'inside';

    const textureWidthBlocks = this.data.width * CLOUD_CELL_SIZE;
    const textureHeightBlocks = this.data.height * CLOUD_CELL_SIZE;
    const cloudOffset = (ticks % (this.data.width * 400)) + 0;
    let cloudX = camera.x + cloudOffset * CLOUD_DRIFT_PER_TICK;
    let cloudZ = camera.z + CLOUD_Z_OFFSET;
    cloudX -= Math.floor(cloudX / textureWidthBlocks) * textureWidthBlocks;
    cloudZ -= Math.floor(cloudZ / textureHeightBlocks) * textureHeightBlocks;
    const cellX = Math.floor(cloudX / CLOUD_CELL_SIZE);
    const cellZ = Math.floor(cloudZ / CLOUD_CELL_SIZE);
    const xInCell = cloudX - cellX * CLOUD_CELL_SIZE;
    const zInCell = cloudZ - cellZ * CLOUD_CELL_SIZE;

    if (this.needsRebuild || cellX !== this.prevCellX || cellZ !== this.prevCellZ
      || relativePos !== this.prevRelativePos || quality !== this.prevQuality) {
      this.needsRebuild = false;
      this.prevCellX = cellX;
      this.prevCellZ = cellZ;
      this.prevRelativePos = relativePos;
      this.prevQuality = quality;
      this.rebuildMesh(cellX, cellZ, relativePos, fancy);
    }
    if (this.mesh.vertexCount === 0) return;

    const colorArgb = sky.cloudColorArgb >>> 0;
    const alpha = ((colorArgb >>> 24) & 255) / 255;
    const r = ((colorArgb >>> 16) & 255) / 255;
    const g = ((colorArgb >>> 8) & 255) / 255;
    const b = (colorArgb & 255) / 255;
    const cloudEnd = this.cloudEnd;

    gl.enable(gl.BLEND);
    setTranslucentBlend(gl);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    this.program.use();
    this.program.setMat4('uViewProj', viewProj);
    this.program.set3f('uCamPos', camera.x, camera.y, camera.z);
    this.program.set3f('uCloudOffset', -xInCell, relativeBottomY, -zInCell);
    this.program.set3f('uCellSize', CLOUD_CELL_SIZE, 4, CLOUD_CELL_SIZE);
    this.program.set4f('uCloudColor', r, g, b, alpha);
    this.program.set1f('uCloudEnd', cloudEnd);
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
    this.alphaCache = null;
  }
}

// ---------------------------------------------------------------------------
// Legacy flat cloud mesh (1.17 LevelRenderer.renderClouds). Not used by the game
// any more - the 26.2 renderer above replaces it - but scripts/test-audio-particles.mts
// still asserts on it, so it is kept as a pure helper until that test is updated.
// ---------------------------------------------------------------------------

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

/** @deprecated Legacy flat cloud mesh; the 26.2 path is buildCloudVoxelMesh. */
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
      if (sample(tx, ty) <= 10) continue;
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
