// Port of net.minecraft.client.renderer.LevelRenderer: manages the per section GPU
// buffers, frustum culling, the sky pass and the block selection outline.

import type { MinecraftData } from '../../vanilla/world/level/block/state/BlockState.js';
import type { ClientLevel } from '../../vanilla/world/level/ClientLevel.js';
import type { ModelSource } from './model/ModelSource.js';
import {
  boxInFrustum, cameraBasis, extractFrustum, mat4Invert, mat4Mul, mat4Perspective, mat4View,
  type Frustum, GlProgram, loadImage,
} from './gl/Gl.js';
import { meshSection, RenderLayer, type SectionMesh, type TintSource } from './chunk/SectionMesher.js';
import { CELESTIAL_FRAG, CELESTIAL_VERT, LINE_FRAG, LINE_VERT, SKY_FRAG, SKY_VERT, TERRAIN_FRAG, TERRAIN_VERT } from './Shaders.js';
import type { TextureManager } from './TextureManager.js';
import type { BiomeColors } from './BiomeColors.js';
import type { SkyState } from '../EnvironmentLighting.js';
import { chunkKey } from '../../vanilla/core/Geometry.js';
import { PostProcessor } from './post/PostProcessor.js';
import { ShadowMap } from './post/ShadowMap.js';
import { argbFromRgb, computeFog } from './environment/FogState.js';
import { complementSkyUniforms, setComplementSkyUniforms } from './environment/ComplementSky.js';

export interface Camera {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  fov: number; aspect: number;
}

interface SectionGpu {
  cx: number; cz: number; sy: number;
  /** CPU copy of the merged SOLID+CUTOUT mesh, positions already relative to the region origin. */
  verts: Uint8Array;
  idx: Uint32Array;
  /** CPU copy of the TRANSLUCENT mesh, same coordinate space. */
  tVerts: Uint8Array;
  tIdx: Uint32Array;
  empty: boolean;
}

/** 4x4 chunks of sections drawn with one draw call each (OpusMC/vanilla RenderRegion idea). */
const REGION_CHUNKS = 4;
const REGION_SHIFT = 2;
const REGION_MASK = REGION_CHUNKS - 1;

interface RegionGpu {
  rx: number; rz: number;
  opaqueVao: WebGLVertexArrayObject | null;
  opaqueVbo: WebGLBuffer | null;
  opaqueIbo: WebGLBuffer | null;
  opaqueCount: number;
  transVao: WebGLVertexArrayObject | null;
  transVbo: WebGLBuffer | null;
  transIbo: WebGLBuffer | null;
  transCount: number;
  dirty: boolean;
  minY: number;
  maxY: number;
  /**
   * Lowest surface height of the 16 chunks in this region (the shadow pass skips regions that
   * cannot see the sun). Cached: recomputing it per frame meant 16 chunks x 256 columns x 2
   * cascades of array reads, ~2.4 ms of the main thread every frame while standing still.
   */
  minSurface: number;
  surfaceDirty: boolean;
  /** Reused staging buffers (fresh arrays per rebuild caused GC hitches). */
  scratchV: Uint8Array;
  scratchI: Uint32Array;
  tScratchV: Uint8Array;
  tScratchI: Uint32Array;
  /** squared distance to the camera, filled during culling */
  dist: number;
}

const LAYERS = 3;
/** Merges SOLID+CUTOUT and rebases the positions in a single pass. */
function mergeRebase(mesh: SectionMesh, ox: number, oy: number, oz: number): { vertices: Uint8Array; indices: Uint32Array } {
  const vs = mesh.vertices[RenderLayer.SOLID];
  const vc = mesh.vertices[RenderLayer.CUTOUT];
  const is = mesh.indices[RenderLayer.SOLID];
  const ic = mesh.indices[RenderLayer.CUTOUT];
  const vertices = new Uint8Array(vs.length + vc.length);
  vertices.set(vs, 0);
  vertices.set(vc, vs.length);
  if (ox !== 0 || oy !== 0 || oz !== 0) {
    const f = new Float32Array(vertices.buffer);
    for (let i = 0; i < f.length; i += 6) {
      f[i] += ox;
      f[i + 1] += oy;
      f[i + 2] += oz;
    }
  }
  if (ic.length === 0) return { vertices, indices: is };
  const base = vs.length / 24;
  const indices = new Uint32Array(is.length + ic.length);
  indices.set(is, 0);
  for (let i = 0; i < ic.length; i++) indices[is.length + i] = ic[i] + base;
  return { vertices, indices };
}

/** Returns a copy of a 24-byte-stride vertex buffer shifted by (ox, oy, oz). */
function rebase(verts: Uint8Array, ox: number, oy: number, oz: number): Uint8Array {
  if (verts.length === 0) return verts;
  if (ox === 0 && oy === 0 && oz === 0) return verts;
  const out = new Uint8Array(verts.byteLength);
  out.set(verts);
  const f = new Float32Array(out.buffer);
  const stride = 6; // 24 bytes = 6 floats
  for (let i = 0; i < f.length; i += stride) {
    f[i] += ox;
    f[i + 1] += oy;
    f[i + 2] += oz;
  }
  return out;
}

const EMPTY_BYTES = new Uint8Array(0);
const EMPTY_U32 = new Uint32Array(0);

function regionKey(rx: number, rz: number): string { return `${rx},${rz}`; }
function regionOfChunk(c: number): number { return c >> REGION_SHIFT; }

/** Concatenates the SOLID and CUTOUT vertex/index arrays into one upload. */
function mergeOpaqueLayers(mesh: SectionMesh): { vertices: Uint8Array; indices: Uint32Array } {
  const vs = mesh.vertices[RenderLayer.SOLID];
  const vc = mesh.vertices[RenderLayer.CUTOUT];
  const is = mesh.indices[RenderLayer.SOLID];
  const ic = mesh.indices[RenderLayer.CUTOUT];
  if (vc.length === 0) return { vertices: vs, indices: is };
  if (vs.length === 0) return { vertices: vc, indices: ic };
  const vertices = new Uint8Array(vs.length + vc.length);
  vertices.set(vs, 0);
  vertices.set(vc, vs.length);
  const base = vs.length / 24;
  const indices = new Uint32Array(is.length + ic.length);
  indices.set(is, 0);
  for (let i = 0; i < ic.length; i++) indices[is.length + i] = ic[i] + base;
  return { vertices, indices };
}

export class LevelRenderer {
  private readonly terrain: GlProgram;
  private readonly sky: GlProgram;
  private readonly celestial: GlProgram;
  private readonly line: GlProgram;

  /**
   * HDR post-processing chain (bloom / tonemap / FXAA) described in TASK-render Phase A.
   * `shadersEnabled`/`shaderQuality` are the live hooks the VideoSettings screen and
   * window.__mc read (src/client/gui/OptionsBridge.ts).
   */
  readonly post: PostProcessor;
  /** Orthographic sun/moon depth map (TASK-render Phase B). */
  readonly shadow: ShadowMap;

  private readonly sunDir: [number, number, number] = [0, 1, 0];
  private readonly moonDir: [number, number, number] = [0, -1, 0];
  private readonly lightDir: [number, number, number] = [0, 1, 0];
  private readonly sunColor: [number, number, number] = [1, 1, 1];
  private shadowsActive = false;
  /** Sun elevation factor for the shadow term (0 at night, so no moon shadows). */
  private shadowDay = 0;
  /** Diagnostics for the Phase B acceptance test (sections/draws submitted to the shadow map). */
  readonly shadowStats = { sections: 0, draws: 0, size: 0 };

  private readonly sections = new Map<number, SectionGpu>();
  private readonly regions = new Map<string, RegionGpu>();
  private readonly rebuildQueue: { chunkX: number; chunkZ: number; sectionY: number }[] = [];
  /** Dedup: a chunk dirty wave must not enqueue the same section twice (10k-entry backlogs). */
  private readonly queuedSections = new Set<number>();
  /** Shadow map reuse: the depth pass is the single biggest draw-call source, so it only
   *  re-renders when the camera/light moved or a section changed. */
  private shadowCacheValid = false;
  private readonly shadowCam = { x: 0, y: 0, z: 0 };
  private readonly shadowLight: [number, number, number] = [0, 1, 0];
  private lastShadowSize = 0;
  private readonly lastShadowMatrix = new Float32Array(16);
  /**
   * Waving foliage (Complementary WAVING_BLOCKS, see SectionMesher). On by default; the TAA
   * stability test turns it off because a static camera is otherwise never pixel-identical.
   */
  swayEnabled = true;

  private readonly view = new Float32Array(16);
  private readonly proj = new Float32Array(16);
  private readonly viewProj = new Float32Array(16);
  /** Inverse of viewProj for the depth-based post passes (TAA reprojection). */
  private readonly invViewProj = new Float32Array(16);

  /** Camera matrices, exposed for the entity renderer and the post-processing chain. */
  get viewProjection(): Float32Array { return this.viewProj; }
  get projection(): Float32Array { return this.proj; }
  get viewMatrix(): Float32Array { return this.view; }
  private frustum: Frustum = { planes: new Float32Array(24) };

  private sunTex: WebGLTexture | null = null;
  private moonTex: WebGLTexture | null = null;
  private starBuffer: WebGLBuffer | null = null;
  private starCount = 0;
  private celestialQuad: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private lineBuffer: WebGLBuffer | null = null;

  renderDistance = 8;
  debugMode = 0;
  private readonly regionStates = new Uint16Array(5832);
  private readonly regionSky = new Uint8Array(5832);
  private readonly regionBlock = new Uint8Array(5832);
  private lastMeshMs = 0;
  private meshCount = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mc: MinecraftData,
    private readonly models: ModelSource,
    private readonly textures: TextureManager,
    private readonly biomeColors: BiomeColors,
  ) {
    this.terrain = new GlProgram(gl, TERRAIN_VERT, TERRAIN_FRAG, 'terrain');
    this.sky = new GlProgram(gl, SKY_VERT, SKY_FRAG, 'sky');
    this.celestial = new GlProgram(gl, CELESTIAL_VERT, CELESTIAL_FRAG, 'celestial');
    this.line = new GlProgram(gl, LINE_VERT, LINE_FRAG, 'line');
    this.post = new PostProcessor(gl);
    // 2048 is the task default; the quality tier re-sizes it in render().
    this.shadow = new ShadowMap(gl, 2048);
  }

  // ------------------------------------------------------- post-processing hooks

  /** Shader quality tier: off / low / medium / high / ultra (OptionsBridge reads this). */
  get shaderQuality(): string { return this.post.quality; }
  set shaderQuality(value: string) { this.post.setQuality(value); }

  /** Master shaders toggle (F6 / window.__mc.setShaders / VideoSettings). */
  get shadersEnabled(): boolean { return this.post.enabled; }
  set shadersEnabled(value: boolean) { this.post.setEnabled(value); }

  /** Called by Game.render right after the default framebuffer has been cleared. */
  beginScene(): void {
    this.post.beginScene();
  }

  /** Resolves HDR -> tone mapped/FXAA image into the default framebuffer. */
  endScene(): void {
    this.post.endScene();
  }

  /**
   * Snapshots the world depth right before the hand pass clears the depth buffer. Called from
   * Game.render between the world/entity/weather passes and the first-person hand.
   */
  captureDepthForPost(): void {
    this.post.captureDepth();
  }

  /** Allocates/resizes the HDR + bloom targets; safe to call on every window resize. */
  resize(width: number, height: number): void {
    this.post.resize(width, height);
  }

  /** Direct-light diagnostics for the Phase B acceptance test. */
  get directLightState(): { sunColor: number[]; lightDir: number[]; shadowsActive: boolean } {
    return {
      sunColor: [...this.sunColor],
      lightDir: [...this.lightDir],
      shadowsActive: this.shadowsActive,
    };
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.sunTex = await this.loadTexture('environment/celestial/sun');
    this.moonTex = await this.loadTexture('environment/celestial/moon/full_moon');

    // fullscreen triangle pair for the sky
    this.celestialQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.celestialQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 1, 1, -1, 1, 1, 1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 0, 0, -1, 1, 0, 0,
    ]), gl.STATIC_DRAW);

    // stars: 1500 random points on a sphere, matching vanilla's count
    const stars: number[] = [];
    let seed = 10842;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 1500; i++) {
      let x = rand() * 2 - 1;
      let y = rand() * 2 - 1;
      let z = rand() * 2 - 1;
      const len = Math.hypot(x, y, z) || 1;
      x /= len; y /= len; z /= len;
      stars.push(x * 100, y * 100, z * 100);
    }
    this.starCount = stars.length / 3;
    this.starBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(stars), gl.STATIC_DRAW);
  }

  private async loadTexture(path: string): Promise<WebGLTexture> {
    const gl = this.gl;
    const img = await loadImage(`/mc/textures/${path}.png`);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  // ---------------------------------------------------------------- meshing

  private tintSource(level: ClientLevel): TintSource {
    return {
      tint: (stateId, tintIndex, x, y, z) => {
        if (tintIndex < 0) return [1, 1, 1];
        const block = this.mc.blockOf(stateId).name;
        // RedStoneWireBlock.getColorForPower / COLORS: the dust texture is greyscale.
        if (block === 'redstone_wire') return redstoneWireTint(this.mc.getProp(stateId, 'power'));
        const biome = level.getBiome(x, y, z);
        // BlockColors.createDefault(): leaves/grass/water/redstone/stems all have explicit
        // tint sources; blocks without one must stay white (cherry/pale_oak leaves, lava, ...).
        return this.biomeColors.blockTint(block, biome, tintIndex, x, z, y);
      },
    };
  }

  /** Rebuilds dirty sections near the camera, honouring a time budget. */
  update(level: ClientLevel, camX: number, camZ: number, budgetMs = 8, camY = 0): void {
    const started = performance.now();
    const cx = Math.floor(camX) >> 4;
    const cz = Math.floor(camZ) >> 4;
    const r = this.renderDistance;

    // Coming down from the surface (or out of creative flight) exposes sections that were skipped
    // while the camera was high above them: re-queue everything nearby once.
    if (camY < this.lastCamY - 8) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const c = level.getChunk(cx + dx, cz + dz);
          if (c) c.dirty = true;
        }
      }
    }
    this.lastCamY = camY;

    // enqueue dirty chunks. Sections far below the camera *and* below the chunk surface cannot be
    // seen (surface play), and they were the bulk of the 10k-entry mesh backlog: at ~1.5 ms per
    // 16^3 section that backlog alone cost 15 s of main-thread time after every world load.
    let pushed = false;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const chunk = level.getChunk(cx + dx, cz + dz);
        if (!chunk || !chunk.dirty) continue;
        if (!this.neighboursReady(level, chunk, cx, cz, r, started)) continue;
        chunk.dirty = false;
        this.waitingSince.delete(chunk);
        let surface = 32767;
        if (chunk.surfaceHeight) {
          for (let i = 0; i < 256; i++) surface = Math.min(surface, chunk.surfaceHeight[i]);
        }
        // 站在地表时，相机下方 32 格以外的 section 看不到，可以跳过（这是当初 1 万条网格
        // 积压的主要来源）。但地下/洞穴里往下能看很远，按这个规则会直接挖空地形、看起来
        // 像"透视"。所以只有明确在地表以上时才裁。
        const underground = camY < surface - 8;
        const cutoff = underground ? Number.NEGATIVE_INFINITY : Math.min(surface, camY) - 32;
        for (let sy = chunk.minSectionY; sy <= chunk.maxSectionY; sy++) {
          if (sy * 16 + 16 <= cutoff) continue;
          const key = sectionKey(chunk.x, chunk.z, sy);
          const prev = this.sections.get(key);
          // `empty` 只是"上次建网格时是空的"这一缓存，用于跳过开局那批空 section。玩家在
          // 空中放方块后该 section 不再是空的；只靠 dirtySections 不可靠（存盘会清掉它），
          // 所以直接看区块数据里现在有没有方块，没有才跳过。
          if (prev?.empty && !this.sectionHasBlocks(chunk, sy)) continue;
          if (this.queuedSections.has(key)) continue;
          this.queuedSections.add(key);
          this.rebuildQueue.push({ chunkX: chunk.x, chunkZ: chunk.z, sectionY: sy });
        }
        pushed = true;
      }
    }

    if (!this.rebuildQueue.length) { this.lastMeshMs = 0; return; }

    // nearest first (only needed when something was added; sorting thousands of entries every frame is not free)
    if (pushed) {
      this.biomeColors.clearBlendCache();
      this.rebuildQueue.sort((a, b) => {
        const da = (a.chunkX - cx) ** 2 + (a.chunkZ - cz) ** 2;
        const db = (b.chunkX - cx) ** 2 + (b.chunkZ - cz) ** 2;
        return da - db;
      });
    }

    const tints = this.tintSource(level);
    let built = 0;
    // The budget is a time check BETWEEN sections, so one dense section can blow through it.
    // Cap the count as well: a frame with 4 x 2 ms sections is already 8 ms of main thread.
    const maxSections = 3;
    while (this.rebuildQueue.length && built < maxSections && performance.now() - started < budgetMs) {
      const item = this.rebuildQueue.shift()!;
      this.queuedSections.delete(sectionKey(item.chunkX, item.chunkZ, item.sectionY));
      this.buildSection(level, item.chunkX, item.chunkZ, item.sectionY, tints);
      built++;
    }
    this.lastMeshMs = performance.now() - started;
    this.meshCount = built;
  }

  /** Chunk -> first time it was found waiting for a neighbour (see neighboursReady). */
  private readonly waitingSince = new WeakMap<object, number>();
  private lastCamY = 0;

  /** 该 section 现在还有没有方块（用来判断 `empty` 缓存是否失效）。 */
  private sectionHasBlocks(
    chunk: { getSection(sy: number): { states: { get(i: number): number } } | undefined },
    sy: number,
  ): boolean {
    const section = chunk.getSection(sy);
    if (!section) return false;
    const states = section.states;
    for (let i = 0; i < 4096; i++) if (states.get(i) !== 0) return true;
    return false;
  }

  /**
   * A section is meshed from an 18x18x18 copy of its surroundings, and a missing neighbour chunk reads as
   * open air, so faces on the chunk border would be emitted. Opaque terrain hides them, but they show up
   * as walls inside water and leaves. Vanilla remeshes when the neighbour arrives; we additionally hold
   * the first mesh back until the 4 orthogonal neighbours that are going to be loaded (inside the view
   * radius) exist, so each chunk is normally meshed once instead of up to five times while streaming in.
   * Gives up after 6 s so a chunk whose neighbour failed to generate still gets drawn.
   */
  private neighboursReady(level: ClientLevel, chunk: { x: number; z: number }, cx: number, cz: number, r: number, now: number): boolean {
    for (let i = 0; i < 4; i++) {
      const nx = chunk.x + (i === 0 ? 1 : i === 1 ? -1 : 0);
      const nz = chunk.z + (i === 2 ? 1 : i === 3 ? -1 : 0);
      if (level.hasChunk(nx, nz)) continue;
      if (Math.max(Math.abs(nx - cx), Math.abs(nz - cz)) > r) continue; // never requested: edge of the view
      let since = this.waitingSince.get(chunk);
      if (since === undefined) { since = now; this.waitingSince.set(chunk, now); }
      if (now - since < 6000) return false;
    }
    return true;
  }

  private buildSection(level: ClientLevel, chunkX: number, chunkZ: number, sy: number, tints: TintSource): void {
    const key = sectionKey(chunkX, chunkZ, sy);
    const originX = chunkX << 4;
    const originY = sy << 4;
    const originZ = chunkZ << 4;

    // Vanilla meshes from a RenderChunkRegion: an 18^3 copy of blocks and light so the
    // mesher never touches the chunk map. Without this the inner loop does ~50 map
    // lookups per block and a section costs 10 ms instead of 1 ms.
    const region = this.buildRegion(level, originX, originY, originZ);

    const mesh: SectionMesh = meshSection({
      mc: this.mc,
      models: this.models,
      getState: (x, y, z) => region.state(
        (x - originX + 1) + (y - originY + 1) * 18 + (z - originZ + 1) * 324,
      ),
      getSkyLight: (x, y, z) => region.sky(
        (x - originX + 1) + (y - originY + 1) * 18 + (z - originZ + 1) * 324,
      ),
      getBlockLight: (x, y, z) => region.block(
        (x - originX + 1) + (y - originY + 1) * 18 + (z - originZ + 1) * 324,
      ),
      tints,
      originX, originY, originZ,
      variantSeed: 0x5eed,
    });

    let existing = this.sections.get(key);
    if (!existing) {
      existing = {
        cx: chunkX, cz: chunkZ, sy,
        verts: EMPTY_BYTES, idx: EMPTY_U32, tVerts: EMPTY_BYTES, tIdx: EMPTY_U32,
        empty: false,
      };
      this.sections.set(key, existing);
    }

    // Solid and cutout share primitives and only differ by the alpha-test threshold, so they are
    // concatenated (opaque textures never have alpha in (0.1, 0.5)) and drawn with the cutout
    // threshold. Positions are rebased onto the region origin here, once, so a region rebuild is
    // a plain memcpy of the per-section arrays.
    const rx = regionOfChunk(chunkX);
    const rz = regionOfChunk(chunkZ);
    const ox = originX - ((rx * REGION_CHUNKS) << 4);
    const oy = originY;
    const oz = originZ - ((rz * REGION_CHUNKS) << 4);

    // Merge SOLID+CUTOUT and rebase onto the region origin in one allocation/pass (dense leaf
    // sections are several MB of vertices, so the extra copies showed up as 15-20 ms frames).
    const merged = mergeRebase(mesh, ox, oy, oz);
    existing.verts = merged.vertices;
    existing.idx = merged.indices;
    existing.tVerts = rebase(mesh.vertices[RenderLayer.TRANSLUCENT], ox, oy, oz);
    existing.tIdx = mesh.indices[RenderLayer.TRANSLUCENT];
    existing.empty = existing.idx.length === 0 && existing.tIdx.length === 0;

    this.markRegionDirty(rx, rz);
    this.shadowCacheValid = false;
  }

  private markRegionDirty(rx: number, rz: number): void {
    const key = regionKey(rx, rz);
    let region = this.regions.get(key);
    if (!region) {
      region = {
        rx, rz,
        opaqueVao: null, opaqueVbo: null, opaqueIbo: null, opaqueCount: 0,
        transVao: null, transVbo: null, transIbo: null, transCount: 0,
        dirty: true, minY: 0, maxY: 0, minSurface: Number.NaN, surfaceDirty: true, dist: 0,
        scratchV: EMPTY_BYTES, scratchI: EMPTY_U32,
        tScratchV: EMPTY_BYTES, tScratchI: EMPTY_U32,
      };
      this.regions.set(key, region);
    }
    region.dirty = true;
    region.surfaceDirty = true;
  }

  /**
   * Rebuilds one region's combined buffers from the cached per-section meshes. Cost is a few
   * hundred KB of memcpy for a full 4x4 chunk region; called with a per-frame budget.
   */
  private rebuildRegion(region: RegionGpu): void {
    const gl = this.gl;
    const parts: SectionGpu[] = [];
    const baseX = region.rx * REGION_CHUNKS;
    const baseZ = region.rz * REGION_CHUNKS;
    for (const section of this.sections.values()) {
      if (section.cx < baseX || section.cx >= baseX + REGION_CHUNKS) continue;
      if (section.cz < baseZ || section.cz >= baseZ + REGION_CHUNKS) continue;
      if (section.idx.length === 0 && section.tIdx.length === 0) continue;
      parts.push(section);
    }
    parts.sort((a, b) => (a.sy - b.sy) || (a.cx - b.cx) || (a.cz - b.cz));

    const build = (
      pickVerts: (s: SectionGpu) => Uint8Array,
      pickIdx: (s: SectionGpu) => Uint32Array,
      scratchV: Uint8Array, scratchI: Uint32Array,
    ): { verts: Uint8Array; idx: Uint32Array; scratchV: Uint8Array; scratchI: Uint32Array } => {
      let vTotal = 0;
      let iTotal = 0;
      for (const part of parts) { vTotal += pickVerts(part).length; iTotal += pickIdx(part).length; }
      if (scratchV.length < vTotal) scratchV = new Uint8Array(Math.ceil(vTotal * 1.3) + 1024);
      if (scratchI.length < iTotal) scratchI = new Uint32Array(Math.ceil(iTotal * 1.3) + 1024);
      const verts = scratchV;
      const idx = scratchI;
      let vo = 0;
      let io = 0;
      for (const part of parts) {
        const v = pickVerts(part);
        const i = pickIdx(part);
        if (v.length === 0) continue;
        verts.set(v, vo);
        const base = vo / 24;
        for (let k = 0; k < i.length; k++) idx[io + k] = i[k] + base;
        vo += v.length;
        io += i.length;
      }
      return { verts: verts.subarray(0, vo), idx: idx.subarray(0, io), scratchV, scratchI };
    };

    // The two staging buffers are kept per region and reused; `upload()` copies into the GPU
    // buffer synchronously, so the scratch content can be overwritten right after.
    const opaque = build((s) => s.verts, (s) => s.idx, region.scratchV, region.scratchI);
    region.scratchV = opaque.scratchV;
    region.scratchI = opaque.scratchI;
    const trans = build((s) => s.tVerts, (s) => s.tIdx, region.tScratchV, region.tScratchI);
    region.tScratchV = trans.scratchV;
    region.tScratchI = trans.scratchI;

    const upload = (
      vao: WebGLVertexArrayObject | null, vbo: WebGLBuffer | null, ibo: WebGLBuffer | null,
      verts: Uint8Array, idx: Uint32Array,
    ): [WebGLVertexArrayObject | null, WebGLBuffer | null, WebGLBuffer | null, number] => {
      if (idx.length === 0) return [vao, vbo, ibo, 0];
      const v = vao ?? gl.createVertexArray()!;
      const b = vbo ?? gl.createBuffer()!;
      const i = ibo ?? gl.createBuffer()!;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, i);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, false, 24, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_SHORT, 24, 16);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, false, 24, 18);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 24, 20);
      return [v, b, i, idx.length];
    };

    [region.opaqueVao, region.opaqueVbo, region.opaqueIbo, region.opaqueCount] =
      upload(region.opaqueVao, region.opaqueVbo, region.opaqueIbo, opaque.verts, opaque.idx);
    [region.transVao, region.transVbo, region.transIbo, region.transCount] =
      upload(region.transVao, region.transVbo, region.transIbo, trans.verts, trans.idx);

    let minY = 1e9;
    let maxY = -1e9;
    for (const p of parts) {
      minY = Math.min(minY, p.sy << 4);
      maxY = Math.max(maxY, (p.sy << 4) + 16);
    }
    region.minY = minY === 1e9 ? 0 : minY;
    region.maxY = maxY === -1e9 ? 16 : maxY;
    region.dirty = false;
  }

  /**
   * Copies an 18x18x18 neighbourhood
/**
   * Copies an 18x18x18 neighbourhood (the section plus a one block skirt) into flat
   * arrays. Sections are fetched once and read through their paletted containers, so
   * the copy does not pay for a chunk map lookup per cell.
   */
  private buildRegion(level: ClientLevel, originX: number, originY: number, originZ: number) {
    const states = this.regionStates;
    const sky = this.regionSky;
    const block = this.regionBlock;
    const minY = level.minY;
    const maxY = level.minY + level.height - 1;
    const minSection = minY >> 4;
    const maxSection = maxY >> 4;

    // cache the 3x3x3 sections that the skirt touches
    const cx0 = originX >> 4;
    const cz0 = originZ >> 4;
    const sy0 = originY >> 4;
    const cache: ({ states: { get(i: number): number }; skyLight: { getIndex(i: number): number } | null; blockLight: { getIndex(i: number): number } | null } | undefined)[] = new Array(27);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = level.getChunk(cx0 + dx, cz0 + dz);
        for (let dy = -1; dy <= 1; dy++) {
          const sy = sy0 + dy;
          const idx = (dx + 1) + (dy + 1) * 3 + (dz + 1) * 9;
          if (!chunk || sy < minSection || sy > maxSection) { cache[idx] = undefined; continue; }
          const section = chunk.getSection(sy);
          cache[idx] = section
            ? { states: section.states, skyLight: section.skyLight, blockLight: section.blockLight }
            : undefined;
        }
      }
    }

    for (let z = -1; z <= 16; z++) {
      const wz = originZ + z;
      const dz = z < 0 ? -1 : z > 15 ? 1 : 0;
      const lz = z & 15;
      for (let y = -1; y <= 16; y++) {
        const wy = originY + y;
        const dy = y < 0 ? -1 : y > 15 ? 1 : 0;
        const ly = y & 15;
        const inY = wy >= minY && wy <= maxY;
        for (let x = -1; x <= 16; x++) {
          const idx = (x + 1) + (y + 1) * 18 + (z + 1) * 324;
          if (!inY) { states[idx] = 0; sky[idx] = 15; block[idx] = 0; continue; }
          const dx = x < 0 ? -1 : x > 15 ? 1 : 0;
          const section = cache[(dx + 1) + (dy + 1) * 3 + (dz + 1) * 9];
          if (!section) {
            // unloaded neighbour: treat as open air so the face is drawn
            states[idx] = 0; sky[idx] = 15; block[idx] = 0;
            continue;
          }
          // LevelChunk.index(x,y,z) = (y<<8) | (z<<4) | x; swapping x/z here transposes every
          // section, so neighbouring chunks no longer line up (SectionCopy.java:66).
          const li = ((ly) << 8) | ((z & 15) << 4) | (x & 15);
          states[idx] = section.states.get(li);
          sky[idx] = section.skyLight ? section.skyLight.getIndex(li) : 15;
          block[idx] = section.blockLight ? section.blockLight.getIndex(li) : 0;
        }
      }
    }
    return {
      state: (idx: number) => (idx >= 0 && idx < 5832 ? states[idx] : 0),
      sky: (idx: number) => (idx >= 0 && idx < 5832 ? sky[idx] : 15),
      block: (idx: number) => (idx >= 0 && idx < 5832 ? block[idx] : 0),
    };
  }

  /** Drops GPU buffers for sections outside the view. */
  prune(camX: number, camZ: number, level?: ClientLevel): void {
    const cx = Math.floor(camX) >> 4;
    const cz = Math.floor(camZ) >> 4;
    const limit = this.renderDistance + 3;
    const marked = new Set<number>();
    for (const [key, section] of this.sections) {
      if (Math.abs(section.cx - cx) > limit || Math.abs(section.cz - cz) > limit) {
        // Pinned/modified chunks keep their LevelChunk but lose the GPU mesh here; without a
        // dirty flag update() never rebuilds them when the player comes back.
        if (level && !marked.has(key)) {
          marked.add(key);
          const chunk = level.getChunk(section.cx, section.cz);
          if (chunk) chunk.dirty = true;
        }
        this.sections.delete(key);
        this.markRegionDirty(regionOfChunk(section.cx), regionOfChunk(section.cz));
        this.shadowCacheValid = false;
      }
    }
  }

  // ---------------------------------------------------------------- drawing

  /** Previous camera used only to detect a still view (TAA jitter freeze). */
  private prevCameraForJitter: Camera | null = null;

  private updateMatrices(camera: Camera): void {
    mat4Perspective((camera.fov * Math.PI) / 180, camera.aspect, 0.05, 1024, this.proj);
    // TAA: sub-pixel projection jitter ([0,0] when disabled, keeping the Off path pixel identical).
    // Freeze the jitter while the view is still so thin edges and shadow boundaries do not crawl.
    const prev = this.prevCameraForJitter;
    const cameraMoved = !prev
      || Math.abs(prev.x - camera.x) > 1e-4 || Math.abs(prev.y - camera.y) > 1e-4
      || Math.abs(prev.z - camera.z) > 1e-4 || Math.abs(prev.yaw - camera.yaw) > 1e-3
      || Math.abs(prev.pitch - camera.pitch) > 1e-3 || Math.abs(prev.fov - camera.fov) > 1e-3;
    this.prevCameraForJitter = { ...camera };
    const [jx, jy] = this.post.advanceJitter(cameraMoved);
    if (jx !== 0 || jy !== 0) {
      const w = this.gl.drawingBufferWidth || 1;
      const h = this.gl.drawingBufferHeight || 1;
      this.proj[8] += (2 * jx) / w; // m02: shifts NDC x
      this.proj[9] += (2 * jy) / h; // m12: shifts NDC y
    }
    mat4View(camera.x, camera.y, camera.z, (camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180, this.view);
    mat4Mul(this.proj, this.view, this.viewProj);
    this.frustum = extractFrustum(this.viewProj);
    // Post passes (TAA reprojection) need the exact matrices that produced this frame's depth.
    mat4Invert(this.viewProj, this.invViewProj);
    this.post.setCamera(this.viewProj, this.invViewProj);
  }

  renderSky(sky: SkyState, camera: Camera, worldTime: number, inWater: boolean): void {
    const gl = this.gl;
    // camera basis (matches mat4View)
    const { right, up, forward } = cameraBasis((camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180);

    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // sky gradient
    this.sky.use();
    this.sky.set3f('uSkyColor', sky.skyColor[0], sky.skyColor[1], sky.skyColor[2]);
    this.sky.set3f('uFogColor', sky.fogColor[0], sky.fogColor[1], sky.fogColor[2]);
    this.sky.set3f('uSunriseColor', sky.sunriseColor[0] * 1.2, sky.sunriseColor[1] * 1.2, sky.sunriseColor[2] * 1.2);
    this.sky.set3f('uCameraRight', right[0], right[1], right[2]);
    this.sky.set3f('uCameraUp', up[0], up[1], up[2]);
    this.sky.set3f('uCameraForward', forward[0], forward[1], forward[2]);
    this.sky.set1f('uTanHalfFov', Math.tan((camera.fov * Math.PI) / 360));
    this.sky.set1f('uAspect', camera.aspect);

    const sunAngle = (sky.sunAngleDeg * Math.PI) / 180;
    const sunDir = [Math.cos(sunAngle) * 0.6, Math.sin(sunAngle), Math.sin(sunAngle) * 0.2];
    const sunLen = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1;
    this.sky.set3f('uSunDir', sunDir[0] / sunLen, sunDir[1] / sunLen, sunDir[2] / sunLen);
    this.sky.set1i('uDebug', this.debugMode);
    this.sky.set1f('uSunriseStrength', Math.max(0, 1 - Math.abs(sky.skyColor[0] - sky.skyColor[1]) * 0) *
      (sky.sunriseColor[0] > 0.6 ? 0.9 : 0.0));

    gl.bindVertexArray(this.quadVaoFor());
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // stars
    if (sky.starBrightness > 0.01) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.line.use();
      this.line.setMat4('uViewProj', this.viewProj);
      this.line.set3f('uOffset', camera.x, camera.y, camera.z);
      this.line.set4f('uColor', 1, 1, 1, sky.starBrightness);
      gl.bindVertexArray(this.starVao());
      gl.drawArrays(gl.POINTS, 0, this.starCount);
      gl.disable(gl.BLEND);
    }

    // sun and moon billboards
    const celestialScale = 30;
    this.drawCelestial(this.sunTex, sunAngle, 0, celestialScale, [1, 1, 1, 1], camera);
    this.drawCelestial(this.moonTex, sunAngle + Math.PI, 1, 20, [1, 1, 1, 1], camera, 4, 2);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  private quadVaoFor(): WebGLVertexArrayObject {
    if (this.quadVao) return this.quadVao;
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    this.quadVao = vao;
    return vao;
  }

  private starVao(): WebGLVertexArrayObject {
    if (this.lineVao) return this.lineVao;
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    this.lineVao = vao;
    return vao;
  }

  private celestialVao(): WebGLVertexArrayObject {
    if (this.celestialVaoCache) return this.celestialVaoCache;
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.celestialQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    this.celestialVaoCache = vao;
    return vao;
  }
  private celestialVaoCache: WebGLVertexArrayObject | null = null;

  private drawCelestial(
    tex: WebGLTexture | null, angle: number, phase: number, scale: number,
    tint: [number, number, number, number], camera: Camera, cols = 1, rows = 1,
  ): void {
    if (!tex) return;
    const gl = this.gl;
    const { right, up } = cameraBasis((camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180);

    const dist = 100;
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist;

    this.celestial.use();
    this.celestial.setMat4('uViewProj', this.viewProj);
    this.celestial.set3f('uCenter', camera.x + x, camera.y + y, camera.z);
    this.celestial.set3f('uRight', right[0], right[1], right[2]);
    this.celestial.set3f('uUp', up[0], up[1], up[2]);
    this.celestial.set1f('uScale', scale);
    this.celestial.set4f('uTint', tint[0], tint[1], tint[2], tint[3]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.celestial.set1i('uTex', 0);
    gl.bindVertexArray(this.celestialVao());
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Sun/moon direction and direct-light colour for this frame.
   *
   * Direction comes straight from the authoritative SkyState angles (the light package validated
   * them against Timelines.java): visual/sun_angle is 0 at noon and 180 at midnight, and vanilla
   * SkyRenderer.java:344 rotates the sun billboard by Axis.XP * sunAngle after an Axis.YP(-90)
   * pre-rotation, which puts the sun at
   *   sunDir  = (-sin(sunAngle),  cos(sunAngle),  0)
   *   moonDir = (-sin(moonAngle), cos(moonAngle), 0)
   * (SkyRenderer.java:334-360, moon rendered at its own MOON_ANGLE). We do not re-derive the
   * angle from level.time here; that would be a second source of truth.
   */
  private updateSunLight(sky: SkyState, rainLevel: number): void {
    const sunAngle = (sky.sunAngleDeg * Math.PI) / 180;
    const moonAngle = (sky.moonAngleDeg * Math.PI) / 180;
    this.sunDir[0] = -Math.sin(sunAngle);
    this.sunDir[1] = Math.cos(sunAngle);
    this.sunDir[2] = 0;
    this.moonDir[0] = -Math.sin(moonAngle);
    this.moonDir[1] = Math.cos(moonAngle);
    this.moonDir[2] = 0;

    const rain = Math.min(1, Math.max(0, rainLevel));
    const smoothstep = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    this.shadowDay = this.sunDir[1] > 0 ? smoothstep(0.0, 0.30, this.sunDir[1]) : 0;

    if (this.sunDir[1] > 0) {
      // Day: warm-white direct sun, dying out in the last few degrees above the horizon.
      const up = this.sunDir[1];
      const warmth = Math.min(1, up * 2.5);
      const strength = smoothstep(0.0, 0.30, up) * 0.55 * (1 - rain * 0.7);
      this.lightDir[0] = this.sunDir[0];
      this.lightDir[1] = this.sunDir[1];
      this.lightDir[2] = this.sunDir[2];
      this.sunColor[0] = 1.0 * strength;
      this.sunColor[1] = (0.58 + (0.97 - 0.58) * warmth) * strength;
      this.sunColor[2] = (0.32 + (0.90 - 0.32) * warmth) * strength;
    } else if (this.moonDir[1] > 0) {
      // Night: deliberately weak bluish moonlight (the night darkening itself comes from
      // SKY_LIGHT_FACTOR 0.24 through the lightmap, not from this term).
      const up = this.moonDir[1];
      const strength = smoothstep(0.0, 0.30, up) * 0.08 * (1 - rain * 0.85);
      this.lightDir[0] = this.moonDir[0];
      this.lightDir[1] = this.moonDir[1];
      this.lightDir[2] = this.moonDir[2];
      this.sunColor[0] = 0.55 * strength;
      this.sunColor[1] = 0.65 * strength;
      this.sunColor[2] = 1.00 * strength;
    } else {
      this.sunColor[0] = 0;
      this.sunColor[1] = 0;
      this.sunColor[2] = 0;
    }
  }

  /**
   * Depth-only shadow pass: one draw per region per cascade (near extent 40, far 132). Water never
   * casts, and regions whose top is below their local surface cannot receive visible sunlight.
   */
  private renderShadowPass(camera: Camera, level: ClientLevel): void {
    const gl = this.gl;
    const camCX = Math.floor(camera.x) >> 4;
    const camCZ = Math.floor(camera.z) >> 4;

    this.shadow.setSize(this.post.shadowSize);
    this.shadow.update(camera, this.lightDir);
    // Waving plants/leaves must displace in the shadow pass too, otherwise the shadows lag behind
    // the geometry whenever the map is re-rendered. The voxel-result cache stays as-is: while the
    // camera is still the map is reused and the sub-texel sway difference is invisible.
    const swayTime = this.swayEnabled ? performance.now() / 1000 : 0;
    this.shadow.swayTime = swayTime;

    const program = this.shadow.programHandle;
    const minSurface = new Map<number, number>();
    let shadowSections = 0;
    let shadowDraws = 0;

    for (let ci = 0; ci < this.shadow.count; ci++) {
      const extentBlocks = this.shadow.extentOf(ci);
      const r = Math.min(this.renderDistance, Math.ceil(extentBlocks / 16) + 1);
      this.shadow.begin(ci);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
      program.set1i('uAtlas', 3);
      program.set1f('uAlphaTest', 0.1);

      for (const region of this.regions.values()) {
        if (region.opaqueCount === 0) continue; // stale buffers still cast until rebuilt
        const cx1 = region.rx * REGION_CHUNKS;
        const cz1 = region.rz * REGION_CHUNKS;
        if (Math.abs(cx1 - camCX) > r + REGION_CHUNKS || Math.abs(cz1 - camCZ) > r + REGION_CHUNKS) continue;
        const minX = cx1 << 4, minZ = cz1 << 4;
        if (!boxInFrustum(this.shadow.frustumOf(ci), minX, region.minY, minZ,
          minX + REGION_CHUNKS * 16, region.maxY, minZ + REGION_CHUNKS * 16)) continue;
        let surface = region.minSurface;
        if (region.surfaceDirty || Number.isNaN(surface)) {
          surface = 32767;
          for (let dz = 0; dz < REGION_CHUNKS; dz++) {
            for (let dx = 0; dx < REGION_CHUNKS; dx++) {
              const ck = chunkKey(cx1 + dx, cz1 + dz);
              let s2 = minSurface.get(ck);
              if (s2 === undefined) {
                const chunk = level.getChunk(cx1 + dx, cz1 + dz);
                s2 = chunk ? chunk.surfaceHeight.reduce((a, b) => Math.min(a, b), 32767) : level.minY;
                minSurface.set(ck, s2);
              }
              surface = Math.min(surface, s2);
            }
          }
          region.minSurface = surface;
          region.surfaceDirty = false;
        }
        if (region.maxY <= surface) continue;
        shadowSections++;
        program.set3f('uChunkOrigin', minX, 0, minZ);
        gl.bindVertexArray(region.opaqueVao);
        gl.drawElements(gl.TRIANGLES, region.opaqueCount, gl.UNSIGNED_INT, 0);
        shadowDraws++;
      }
    }

    this.shadowStats.sections = shadowSections;
    this.shadowStats.draws = shadowDraws;
    this.shadowStats.size = this.shadow.size;

    this.shadow.end();
    // The pass above bound its own framebuffer: put the HDR scene target back.
    this.post.bindSceneTarget();
  }

  /**
   * Draws the level. `beforeTranslucent` runs after solid/cutout terrain but before the water
   * layer, which is where vanilla renders entities: water must tint and hide submerged entities
   * instead of being painted underneath them (that made mobs look like they floated on the
   * surface).
   */
  render(level: ClientLevel, camera: Camera, sky: SkyState, partialTicks: number, beforeTranslucent?: () => void): void {
    const gl = this.gl;
    this.updateMatrices(camera);
    // Depth-difference post effects need the same clip planes the projection was built with.
    this.post.setDepthRange(0.05, 1024);

    // Rebuild dirty regions under a *time* budget (a full 4x4 region with dense sections is
    // several MB of memcpy + upload; six of those in one frame was a 30 ms hitch while walking).
    // Nearest first, and only regions inside the view: far ones wait until they are needed.
    const rebuildStart = performance.now();
    const dirty: RegionGpu[] = [];
    for (const region of this.regions.values()) {
      if (!region.dirty) continue;
      const dx = (region.rx * REGION_CHUNKS + REGION_CHUNKS / 2) * 16 - camera.x;
      const dz = (region.rz * REGION_CHUNKS + REGION_CHUNKS / 2) * 16 - camera.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > (this.renderDistance * 16 + 64) ** 2) continue;
      (region as RegionGpu & { _d?: number })._d = dist2;
      dirty.push(region);
    }
    dirty.sort((a, b) => (a as RegionGpu & { _d?: number })._d! - (b as RegionGpu & { _d?: number })._d!);
    const rebuildBudgetMs = 2.2;
    for (const region of dirty) {
      this.rebuildRegion(region);
      if (performance.now() - rebuildStart > rebuildBudgetMs) break;
    }

    const opaque: RegionGpu[] = [];
    const translucent: RegionGpu[] = [];
    const r = this.renderDistance;
    const camCX = Math.floor(camera.x) >> 4;
    const camCZ = Math.floor(camera.z) >> 4;
    const half = (REGION_CHUNKS * 16) / 2;

    for (const region of this.regions.values()) {
      // A dirty region with buffers keeps drawing the previous mesh until its rebuild runs;
      // skipping it would punch holes in the terrain while streaming.
      if (region.dirty && region.opaqueCount === 0 && region.transCount === 0) continue;
      if (region.opaqueCount === 0 && region.transCount === 0) continue;
      const centreCX = region.rx * REGION_CHUNKS + REGION_CHUNKS / 2;
      const centreCZ = region.rz * REGION_CHUNKS + REGION_CHUNKS / 2;
      if (Math.abs(centreCX - camCX) > r + REGION_CHUNKS + 1 || Math.abs(centreCZ - camCZ) > r + REGION_CHUNKS + 1) continue;
      const minX = region.rx * REGION_CHUNKS * 16;
      const minZ = region.rz * REGION_CHUNKS * 16;
      if (!boxInFrustum(this.frustum, minX, region.minY, minZ,
        minX + REGION_CHUNKS * 16, region.maxY, minZ + REGION_CHUNKS * 16)) continue;
      const dx = minX + half - camera.x;
      const dy = (region.minY + region.maxY) / 2 - camera.y;
      const dz = minZ + half - camera.z;
      region.dist = dx * dx + dy * dy + dz * dz;
      if (region.opaqueCount > 0) opaque.push(region);
      if (region.transCount > 0) translucent.push(region);
    }

    opaque.sort((a, b) => a.dist - b.dist);
    translucent.sort((a, b) => b.dist - a.dist);

    // Sun/moon shadow map. Off when shaders are off (the shader path must equal vanilla then).
    const rainLevel = typeof level.getRainLevel === 'function' ? level.getRainLevel() : 0;
    const skyUniforms = complementSkyUniforms(sky, rainLevel);
    this.updateSunLight(sky, rainLevel);
    this.shadowsActive = this.post.enabled && this.post.shadowsEnabled && this.post.shadowSize > 0;
    if (this.shadowsActive) {
      // The shadow matrix is texel-snapped, so compare the *matrix* instead of the camera
      // position: the old 2-block threshold reused a stale depth map with a fresh matrix, which
      // made shadow edges crawl/flicker while walking.
      this.shadow.update(camera, this.lightDir);
      let matrixChanged = this.shadow.size !== this.lastShadowSize;
      for (let i = 0; i < 16 && !matrixChanged; i++) {
        if (Math.abs(this.shadow.lightViewProjection[i] - this.lastShadowMatrix[i]) > 1e-6) matrixChanged = true;
      }
      if (!this.shadowCacheValid || matrixChanged) {
        this.lastShadowMatrix.set(this.shadow.lightViewProjection);
        this.renderShadowPass(camera, level);
        this.shadowCacheValid = true;
        this.lastShadowSize = this.shadow.size;
        this.shadowCam.x = camera.x; this.shadowCam.y = camera.y; this.shadowCam.z = camera.z;
        this.shadowLight[0] = this.lightDir[0]; this.shadowLight[1] = this.lightDir[1]; this.shadowLight[2] = this.lightDir[2];
      }
    }

    // Fog: single source of truth is renderer/environment/FogState.ts (FogRenderer.setupFog).
    // The old hand-rolled fogStart/fogEnd formula is gone; terrain, entities, weather and sky
    // all consume the same vanilla fog data now.
    const forward = cameraBasis((camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180).forward;
    const fog = computeFog({
      fogType: 'atmospheric',
      renderDistanceBlocks: this.renderDistance * 16,
      cameraPosition: { x: camera.x, y: camera.y, z: camera.z },
      cameraForward: { x: forward[0], y: forward[1], z: forward[2] },
      partialTicks,
      minY: level.minY,
      fogColorArgb: argbFromRgb(sky.fogColor),
      skyColorArgb: argbFromRgb(sky.skyColor),
      sunriseSunsetColorArgb: sky.sunriseColorArgb,
      sunAngleDeg: sky.sunAngleDeg,
      fogStartDistance: sky.fogStartDistance,
      fogEndDistance: sky.fogEndDistance,
      skyFogEndDistance: sky.skyFogEndDistance,
      cloudFogEndDistance: sky.cloudFogEndDistance,
      rainLevel,
      skyLightLevel: level.getSkyLight(Math.floor(camera.x), Math.floor(camera.y), Math.floor(camera.z)),
    });

    this.terrain.use();
    this.terrain.setMat4('uViewProj', this.viewProj);
    this.terrain.set3f('uFogColor', fog.color[0], fog.color[1], fog.color[2]);
    this.terrain.set1f('uFogEnvStart', fog.environmentalStart);
    this.terrain.set1f('uFogEnvEnd', fog.environmentalEnd);
    this.terrain.set1f('uFogRdStart', fog.renderDistanceStart);
    this.terrain.set1f('uFogRdEnd', fog.renderDistanceEnd);
    this.terrain.set1f('uFogEnabled', 1);
    this.terrain.set3f('uCameraPos', camera.x, camera.y, camera.z);
    this.terrain.set1f('uAlphaTest', 0.1);
    this.terrain.set1f('uTranslucent', 0);
    this.terrain.set1i('uDebug', this.debugMode);
    // Water waves belong to the Complementary-style look: only with the shader pipeline on (Off stays vanilla-flat)
    const waterStill = this.textures.blockTextureLayer('block/water_still');
    const waterFlow = this.textures.blockTextureLayer('block/water_flow');
    const waves = this.post.enabled && waterStill >= 0;
    this.terrain.set2i('uWaterLayers', waves ? waterStill : -1, waves ? waterFlow : -1);
    this.terrain.set1f('uWaveTime', performance.now() / 1000);
    this.terrain.set1f('uSwayTime', this.swayEnabled ? performance.now() / 1000 : 0);
    // Direct sun / moon term is only enabled when a shadow map was rendered this frame; with
    // uUseShadows = 0 the fragment shader keeps the exact vanilla lightmap result.
    this.terrain.set1i('uUseShadows', this.shadowsActive ? 1 : 0);
    this.terrain.setMat4('uLightViewProj', this.shadow.cascadeMatrix(0));
    this.terrain.setMat4('uLightViewProj1', this.shadow.cascadeMatrix(1));
    this.terrain.set1f('uCascadeCount', this.shadow.count);
    this.terrain.set1f('uCascadeSplit', this.shadow.extentOf(0));
    this.terrain.set3f('uSunDir', this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    this.terrain.set3f('uSunColor', this.sunColor[0], this.sunColor[1], this.sunColor[2]);
    this.terrain.set1f('uShadowTexel', this.shadow.cascadeTexel(0));
    this.terrain.set1f('uShadowDay', this.shadowDay);
    // Water-reflection samplers must be backed by a complete 2D texture on every draw of this
    // program (WebGL validates active samplers even when uWaterReflect turns the branch off).
    this.terrain.set1i('uWaterReflect', 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.post.waterColor ?? this.post.blackTexture);
    this.terrain.set1i('uSceneColor', 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.post.waterDepth ?? this.post.blackTexture);
    this.terrain.set1i('uSceneDepth', 6);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
    this.terrain.set1i('uAtlas', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
    this.terrain.set1i('uLightmap', 1);
    // Shadow map on unit 3 (needs COMPARE_REF_TO_TEXTURE sampling).
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.cascadeTexture(0));
    this.terrain.set1i('uShadowMap', 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.cascadeTexture(1));
    this.terrain.set1i('uShadowMap1', 4);
    gl.activeTexture(gl.TEXTURE3);
    gl.activeTexture(gl.TEXTURE0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    // solid + cutout (vanilla CUTOUT_TERRAIN alpha threshold is 0.5; solid keeps the default 0.1)
    for (const region of opaque) {
      this.drawRegion(region, RenderLayer.SOLID, 0.5);
    }

    // Entities / particles / block-breaking go here (vanilla order).
    beforeTranslucent?.();

    // translucent, back to front, no depth write. The callback above may have changed the
    // program, VAO and blend state, so everything this pass needs is re-bound.
    // Snapshot the opaque scene first: the water reflects it and cannot sample its own target.
    // Only pay for the full-screen copy when translucent geometry is actually visible.
    if (translucent.length > 0) this.post.captureWaterSource();
    this.terrain.use();
    this.terrain.setMat4('uViewProj', this.viewProj);
    this.terrain.set3f('uFogColor', fog.color[0], fog.color[1], fog.color[2]);
    this.terrain.set1f('uFogEnvStart', fog.environmentalStart);
    this.terrain.set1f('uFogEnvEnd', fog.environmentalEnd);
    this.terrain.set1f('uFogRdStart', fog.renderDistanceStart);
    this.terrain.set1f('uFogRdEnd', fog.renderDistanceEnd);
    this.terrain.set1f('uFogEnabled', 1);
    this.terrain.set3f('uCameraPos', camera.x, camera.y, camera.z);
    // uDebug / uUseShadows are int uniforms: uniform1f on them raises GL_INVALID_OPERATION.
    this.terrain.set1i('uDebug', this.debugMode);
    this.terrain.set1i('uUseShadows', this.shadowsActive ? 1 : 0);
    this.terrain.setMat4('uLightViewProj', this.shadow.cascadeMatrix(0));
    this.terrain.setMat4('uLightViewProj1', this.shadow.cascadeMatrix(1));
    this.terrain.set1f('uCascadeCount', this.shadow.count);
    this.terrain.set1f('uCascadeSplit', this.shadow.extentOf(0));
    this.terrain.set3f('uSunDir', this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    this.terrain.set3f('uSunColor', this.sunColor[0], this.sunColor[1], this.sunColor[2]);
    this.terrain.set1f('uShadowTexel', this.shadow.cascadeTexel(0));
    this.terrain.set1f('uShadowDay', this.shadowDay);
    this.terrain.set2i('uWaterLayers', waves ? waterStill : -1, waves ? waterFlow : -1);
    this.terrain.set1f('uWaveTime', performance.now() / 1000);
    this.terrain.set1f('uSwayTime', this.swayEnabled ? performance.now() / 1000 : 0);
    // Complementary Reimagined sky constants (ComplementSky.ts): the water reflection evaluates
    // the pack's GetSky() for rays the depth buffer cannot resolve.
    setComplementSkyUniforms(this.terrain, skyUniforms);
    this.terrain.setMat4('uInvViewProj', this.invViewProj);
    this.terrain.set2f('uResolution', gl.drawingBufferWidth || 1, gl.drawingBufferHeight || 1);
    const waterReflect = this.post.enabled && this.post.quality !== 'low'
      && this.post.waterColor !== null;
    this.terrain.set1i('uWaterReflect', waterReflect ? 1 : 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.post.waterColor ?? this.post.blackTexture);
    this.terrain.set1i('uSceneColor', 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.post.waterDepth ?? this.post.blackTexture);
    this.terrain.set1i('uSceneDepth', 6);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
    this.terrain.set1i('uAtlas', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
    this.terrain.set1i('uLightmap', 1);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.cascadeTexture(0));
    this.terrain.set1i('uShadowMap', 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.cascadeTexture(1));
    this.terrain.set1i('uShadowMap1', 4);
    gl.activeTexture(gl.TEXTURE3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.terrain.set1f('uTranslucent', 1);
    for (const region of translucent) {
      this.drawRegion(region, RenderLayer.TRANSLUCENT, 0.1);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  /** One draw call for a whole 4x4 chunk region (positions are region-local). */
  private drawRegion(region: RegionGpu, layer: RenderLayer, alphaTest: number): void {
    const gl = this.gl;
    const translucent = layer === RenderLayer.TRANSLUCENT;
    const count = translucent ? region.transCount : region.opaqueCount;
    const vao = translucent ? region.transVao : region.opaqueVao;
    if (!count || !vao) return;
    this.terrain.set3f('uChunkOrigin', region.rx * REGION_CHUNKS * 16, 0, region.rz * REGION_CHUNKS * 16);
    this.terrain.set1f('uAlphaTest', alphaTest);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
  }

  /** Vanilla block selection outline. */
  drawSelection(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const gl = this.gl;
    const e = 0.002;
    const p = [
      x0 - e, y0 - e, z0 - e, x1 + e, y0 - e, z0 - e,
      x1 + e, y0 - e, z0 - e, x1 + e, y0 - e, z1 + e,
      x1 + e, y0 - e, z1 + e, x0 - e, y0 - e, z1 + e,
      x0 - e, y0 - e, z1 + e, x0 - e, y0 - e, z0 - e,
      x0 - e, y1 + e, z0 - e, x1 + e, y1 + e, z0 - e,
      x1 + e, y1 + e, z0 - e, x1 + e, y1 + e, z1 + e,
      x1 + e, y1 + e, z1 + e, x0 - e, y1 + e, z1 + e,
      x0 - e, y1 + e, z1 + e, x0 - e, y1 + e, z0 - e,
      x0 - e, y0 - e, z0 - e, x0 - e, y1 + e, z0 - e,
      x1 + e, y0 - e, z0 - e, x1 + e, y1 + e, z0 - e,
      x1 + e, y0 - e, z1 + e, x1 + e, y1 + e, z1 + e,
      x0 - e, y0 - e, z1 + e, x0 - e, y1 + e, z1 + e,
    ];
    if (!this.lineBuffer) this.lineBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p), gl.DYNAMIC_DRAW);

    let vao = this.selectionVao;
    if (!vao) {
      vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      this.selectionVao = vao;
    }
    this.line.use();
    this.line.setMat4('uViewProj', this.viewProj);
    this.line.set3f('uOffset', 0, 0, 0);
    this.line.set4f('uColor', 0, 0, 0, 0.4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    // Vanilla draws the hit outline ~2.5px wide (LevelRenderer#submitHitOutline); GL lines are 1px and FXAA
    // nearly erases a 1px line, so draw it four times shifted by half a pixel to get a crisp 2px line.
    const px = 1 / Math.max(1, gl.drawingBufferWidth), py = 1 / Math.max(1, gl.drawingBufferHeight);
    for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      this.line.set2f('uClipOffset', sx * px * 2, sy * py * 2);
      gl.drawArrays(gl.LINES, 0, p.length / 3);
    }
    this.line.set2f('uClipOffset', 0, 0);
    gl.disable(gl.BLEND);
  }
  private selectionVao: WebGLVertexArrayObject | null = null;

  get meshStats(): { ms: number; count: number; sections: number } {
    return { ms: this.lastMeshMs, count: this.meshCount, sections: this.sections.size };
  }

  /**
   * Diagnostics for the perf report: sections within `radius` chunks of the camera that have
   * blocks but no mesh (and are not cached as empty). Each one is a hole you can see the sky or
   * the void through - the "terrain renders slowly / can see through it" report.
   */
  nearMissingStats(
    level: ClientLevel, camX: number, camY: number, camZ: number, radius = 2,
  ): { missing: number; below: number; queued: number } {
    const cx = Math.floor(camX) >> 4;
    const cz = Math.floor(camZ) >> 4;
    // Same 32-block window the renderer uses to skip unreachable sections while on the surface,
    // so the count is "holes you can actually see", not "sections intentionally skipped".
    const sy0 = Math.floor((camY - 32) / 16);
    const sy1 = Math.floor((camY + 32) / 16);
    let missing = 0;
    let below = 0;
    let queued = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const chunk = level.getChunk(cx + dx, cz + dz);
        if (!chunk) continue;
        const lo = Math.max(chunk.minSectionY, sy0);
        const hi = Math.min(chunk.maxSectionY, sy1);
        for (let sy = lo; sy <= hi; sy++) {
          const key = sectionKey(chunk.x, chunk.z, sy);
          if (this.queuedSections.has(key)) queued++;
          if (!this.sectionHasBlocks(chunk, sy)) continue;
          const gpu = this.sections.get(key);
          if (!gpu || gpu.empty) {
            missing++;
            if (sy * 16 + 16 <= camY) below++;
          }
        }
      }
    }
    return { missing, below, queued };
  }

  /** Sections still waiting for a remesh (tests wait for this to reach 0 after editing blocks). */
  get pendingRebuilds(): number { return this.rebuildQueue.length; }
}

const vaoBuffers = new WeakMap<WebGLVertexArrayObject, { vbo: WebGLBuffer | null; ibo: WebGLBuffer | null }>();

function sectionKey(cx: number, cz: number, sy: number): number {
  return ((cx + 32768) * 65536 + (cz + 32768)) * 128 + (sy + 32);
}

/** RedStoneWireBlock.getColorForPower (vanilla COLORS table). */
function redstoneWireTint(powerValue: string | undefined): [number, number, number] {
  const power = Math.max(0, Math.min(15, Number(powerValue ?? 0)));
  const f = power / 15;
  const r = f * 0.6 + (power > 0 ? 0.4 : 0.3);
  const g = Math.max(0, Math.min(1, f * f * 0.7 - 0.5));
  const b = Math.max(0, Math.min(1, f * f * 0.6 - 0.7));
  return [r, g, b];
}
