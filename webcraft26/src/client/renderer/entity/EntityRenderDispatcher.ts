// Source: net.minecraft.client.renderer.entity.EntityRenderDispatcher
//
// Owns the single entity shader, one dynamic VBO and the texture set. Every
// frame it:
//   1. culls by camera distance,
//   2. appends all entity vertices into per-texture buckets (zero allocation,
//      models baked once),
//   3. concatenates the buckets into ONE Float32Array and uploads it with a
//      single bufferData/bufferSubData pair,
//   4. issues one drawArrays per non-empty texture (<= 15 draw calls).
//
// Integration (called from LevelRenderer by the main agent):
//   const dispatcher = new EntityRenderDispatcher(gl);  // auto-loads textures
//   await dispatcher.init();                            // optional, waits for PNGs
//   dispatcher.render(manager.getEntities(), viewProj, camera, partialTick);

import { GlProgram, createTexture2D, loadImage } from '../gl/Gl.js';
import { ENTITY_VERT, ENTITY_FRAG } from './EntityShaders.js';
import { EntityBatch, EntityRenderer } from './EntityRenderer.js';
import { MobRenderer } from './MobRenderer.js';
import { ItemEntityRenderer } from './ItemEntityRenderer.js';
import { ArrowRenderer } from './ArrowRenderer.js';
import { ALL_TEXTURE_KEYS, WHITE_TEXTURE, MODEL_REGISTRY } from './model/ModelRegistry.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

export interface EntityCamera { x: number; y: number; z: number; }

const FLOATS_PER_VERTEX = 8;
const VERTEX_STRIDE = FLOATS_PER_VERTEX * 4;

export class EntityRenderDispatcher {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: GlProgram;
  private readonly batch: EntityBatch;
  private readonly vbo: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly texIdByKey = new Map<string, number>();
  private readonly textures: (WebGLTexture | null)[];
  private readonly renderers = new Map<string, EntityRenderer<Entity>>();
  private readonly starts: Int32Array;
  private readonly counts: Int32Array;
  private combined: Float32Array = new Float32Array(4096 * FLOATS_PER_VERTEX);
  private readonly n: number;
  private loading: Promise<void> | null = null;

  /** Entities farther than this (blocks) are culled. */
  renderDistance = 96;

  constructor(gl: WebGL2RenderingContext, base = '/mc/textures/entity') {
    this.gl = gl;
    this.n = ALL_TEXTURE_KEYS.length;
    this.program = new GlProgram(gl, ENTITY_VERT, ENTITY_FRAG, 'entity');
    for (let i = 0; i < this.n; i++) this.texIdByKey.set(ALL_TEXTURE_KEYS[i], i);
    this.textures = new Array(this.n).fill(null) as (WebGLTexture | null)[];
    this.batch = new EntityBatch(this.n);
    this.starts = new Int32Array(this.n);
    this.counts = new Int32Array(this.n);

    // solid white texture for items / arrows
    const whiteId = this.texIdByKey.get(WHITE_TEXTURE);
    if (whiteId !== undefined) {
      this.textures[whiteId] = createTexture2D(gl, 1, 1, new Uint8Array([255, 255, 255, 255]), gl.NEAREST);
    }

    // VAO + dynamic VBO (attribute layout is fixed)
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, VERTEX_STRIDE, 20);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.vbo = vbo;

    // one renderer per renderable entity type
    for (const name of Object.keys(MODEL_REGISTRY)) {
      if (name === 'quadruped') continue;
      this.renderers.set(name, new MobRenderer(name));
    }
    this.renderers.set('item', new ItemEntityRenderer());
    this.renderers.set('experience_orb', new ItemEntityRenderer());
    this.renderers.set('arrow', new ArrowRenderer());

    // kick off texture loading; render() simply skips textures not ready yet
    void this.init(base).catch(() => { /* headless / missing assets are non-fatal */ });
  }

  /** Loads all entity textures. Safe to call multiple times (idempotent). */
  init(base = '/mc/textures/entity'): Promise<void> {
    if (!this.loading) this.loading = this.loadTextures(base);
    return this.loading;
  }

  private async loadTextures(base: string): Promise<void> {
    const gl = this.gl;
    for (let i = 0; i < this.n; i++) {
      const key = ALL_TEXTURE_KEYS[i];
      if (key === WHITE_TEXTURE || this.textures[i]) continue;
      try {
        const img = await loadImage(`${base}/${key}.png`);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // vanilla entity textures: UV (0,0) is the top-left texel, no Y flip
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.textures[i] = tex;
      } catch {
        // leave null: entities using this texture are skipped until it loads
      }
    }
  }

  render(entities: Iterable<Entity>, viewProj: Float32Array, camera: EntityCamera, partialTick: number): void {
    const gl = this.gl;
    this.batch.reset();
    const maxDist2 = this.renderDistance * this.renderDistance;

    for (const e of entities) {
      if (e.isRemoved()) continue;
      const dx = e.x - camera.x, dy = e.y - camera.y, dz = e.z - camera.z;
      if (dx * dx + dy * dy + dz * dz > maxDist2) continue;
      const renderer = this.renderers.get(e.getTypeName());
      if (!renderer) continue;
      const texId = this.texIdByKey.get(renderer.getTextureKey(e));
      if (texId === undefined || !this.textures[texId]) continue;
      renderer.append(e, this.batch, texId, partialTick);
    }

    // total float count
    let total = 0;
    for (let t = 0; t < this.n; t++) total += this.batch.lengths[t];
    if (total === 0) return;
    this.ensureCombined(total);

    // concatenate buckets into one buffer (manual loop, no subarray allocation)
    this.starts.fill(0);
    this.counts.fill(0);
    let off = 0;
    for (let t = 0; t < this.n; t++) {
      const len = this.batch.lengths[t];
      if (len === 0) continue;
      const src = this.batch.buckets[t];
      for (let k = 0; k < len; k++) this.combined[off + k] = src[k];
      this.starts[t] = off / FLOATS_PER_VERTEX;
      this.counts[t] = len / FLOATS_PER_VERTEX;
      off += len;
    }

    this.program.use();
    this.program.setMat4('uViewProj', viewProj);
    this.program.set1i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, total * 4, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.combined, 0, total);

    gl.disable(gl.CULL_FACE); // mixed winding after mirror/models
    gl.enable(gl.DEPTH_TEST);
    for (let t = 0; t < this.n; t++) {
      if (this.counts[t] === 0) continue;
      gl.bindTexture(gl.TEXTURE_2D, this.textures[t]!);
      gl.drawArrays(gl.TRIANGLES, this.starts[t], this.counts[t]);
    }
    gl.bindVertexArray(null);
  }

  /** Number of draw calls the last render used (one per non-empty texture). */
  get lastDrawCallCount(): number {
    let n = 0;
    for (let t = 0; t < this.n; t++) if (this.counts[t] > 0) n++;
    return n;
  }

  private ensureCombined(floats: number): void {
    if (floats <= this.combined.length) return;
    let cap = this.combined.length;
    while (cap < floats) cap *= 2;
    this.combined = new Float32Array(cap);
  }
}
