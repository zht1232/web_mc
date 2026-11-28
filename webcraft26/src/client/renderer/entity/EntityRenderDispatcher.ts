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
// Lighting: every vertex carries the entity's lightmap levels (sampled at the
// entity's eye position, vanilla EntityRenderer.getPackedLightCoords) so a
// single batched draw can still light each mob independently. Fog uses the same
// cylindrical formula as the terrain pass; the environment (lightmap texture,
// fog colour, render distance) is pushed once per frame by the caller.
//
// Integration (called from LevelRenderer by the main agent):
//   const dispatcher = new EntityRenderDispatcher(gl);  // auto-loads textures
//   await dispatcher.init();                            // optional, waits for PNGs
//   dispatcher.setEnvironment(textures.lightmap, skyState.fogColor, renderDistance);
//   dispatcher.render(manager.getEntities(), viewProj, camera, partialTick);

import { GlProgram, createTexture2D, loadImage } from '../gl/Gl.js';
import { ENTITY_VERT, ENTITY_FRAG, SHADOW_VERT, SHADOW_FRAG } from './EntityShaders.js';
import { EntityBatch, EntityRenderer, FLOATS_PER_VERTEX } from './EntityRenderer.js';
import { MobRenderer } from './MobRenderer.js';
import { MinecartRenderer } from './MinecartRenderer.js';
import { BoatRenderer } from './BoatRenderer.js';
import { SkeletonRenderer } from './SkeletonRenderer.js';
import { ItemEntityRenderer, type ItemIconSource } from './ItemEntityRenderer.js';
import { ArrowRenderer } from './ArrowRenderer.js';
import { TntRenderer } from './TntRenderer.js';
import { FishingBobberRenderer } from './FishingBobberRenderer.js';
import { ThrownEggRenderer } from './ThrownEggRenderer.js';
import { ALL_TEXTURE_KEYS, WHITE_TEXTURE, ITEM_ICON_TEXTURE, MODEL_REGISTRY } from './model/ModelRegistry.js';
import { computeFog, argbFromRgb } from '../environment/FogState.js';
import type { SkyState } from '../../EnvironmentLighting.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

export interface EntityCamera { x: number; y: number; z: number; }

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

  /** Dropped-item icons come from the GUI atlas; uploaded lazily when it (re)builds. */
  private itemIconAtlas: ItemIconSource | null = null;
  private itemIconCanvas: HTMLCanvasElement | null = null;
  private itemIconTexture: WebGLTexture | null = null;
  private readonly itemEntityRenderer: ItemEntityRenderer;

  // entity shadows (ShadowFeatureRenderer): one program + one 1-float-per-vertex VBO
  private readonly shadowProgram: GlProgram;
  private readonly shadowTex: WebGLTexture;
  private readonly shadowVao: WebGLVertexArrayObject | null;
  private readonly shadowVbo: WebGLBuffer;
  private shadowData: Float32Array = new Float32Array(6 * 64);
  private shadowVertices = 0;

  /** 1x1 white fallback used until the real 16x16 lightmap arrives. */
  private readonly whiteLightmap: WebGLTexture;
  private lightmap: WebGLTexture;
  private fogColor: [number, number, number] = [1, 1, 1];
  private fogEnvStart = 0;
  private fogEnvEnd = 1024;
  private fogRenderStart = 128;
  private fogRenderEnd = 192;
  private fogKey = '';

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
    this.whiteLightmap = createTexture2D(gl, 1, 1, new Uint8Array([255, 255, 255, 255]), gl.NEAREST);
    this.lightmap = this.whiteLightmap;

    // VAO + dynamic VBO (attribute layout is fixed)
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, VERTEX_STRIDE, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, VERTEX_STRIDE, 32);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, VERTEX_STRIDE, 40);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.vbo = vbo;

    // shadows: a soft radial blob (textures/misc/shadow.png equivalent) drawn as
    // one quad per block below the entity.
    this.shadowProgram = new GlProgram(gl, SHADOW_VERT, SHADOW_FRAG, 'entityShadow');
    const S = 64;
    const radial = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = ((x + 0.5) / S) * 2 - 1;
        const dz = ((y + 0.5) / S) * 2 - 1;
        let a = 1 - Math.sqrt(Math.min(1, dx * dx + dz * dz));
        a = a * a;
        const i = (y * S + x) * 4;
        radial[i + 3] = Math.round(a * 255);
      }
    }
    this.shadowTex = createTexture2D(gl, S, S, radial, gl.LINEAR);
    const shadowVao = gl.createVertexArray();
    const shadowVbo = gl.createBuffer()!;
    gl.bindVertexArray(shadowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    this.shadowVao = shadowVao;
    this.shadowVbo = shadowVbo;

    // one renderer per renderable entity type
    for (const name of Object.keys(MODEL_REGISTRY)) {
      if (name === 'quadruped') continue;
      // The skeleton family draws its bow as an equipment layer (only when held).
      if (name === 'skeleton' || name === 'stray' || name === 'bogged'
        || name === 'parched' || name === 'wither_skeleton') {
        this.renderers.set(name, new SkeletonRenderer(name));
      } else if (name === 'minecart' || name === 'chest_minecart') {
        this.renderers.set(name, new MinecartRenderer());
      } else if (name.endsWith('_boat') || name.endsWith('_raft')) {
        this.renderers.set(name, new BoatRenderer());
      } else {
        this.renderers.set(name, new MobRenderer(name));
      }
    }
    this.itemEntityRenderer = new ItemEntityRenderer();
    this.renderers.set('item', this.itemEntityRenderer);
    this.renderers.set('experience_orb', this.itemEntityRenderer);
    this.renderers.set('arrow', new ArrowRenderer());
    this.renderers.set('tnt', new TntRenderer());
    this.renderers.set('fishing_bobber', new FishingBobberRenderer());
    this.renderers.set('egg', new ThrownEggRenderer());
    // ThrownItemRenderer: splash/lingering potions draw their item sprite while in flight.
    this.renderers.set('splash_potion', this.itemEntityRenderer);
    this.renderers.set('lingering_potion', this.itemEntityRenderer);

    // kick off texture loading; render() simply skips textures not ready yet
    void this.init(base).catch(() => { /* headless / missing assets are non-fatal */ });
  }

  /** True when this entity type has a renderer (types without one would spawn invisible). */
  canRender(typeName: string): boolean { return this.renderers.has(typeName); }

  /** Supplies the GUI's baked item-icon atlas; dropped items then draw real icons. */
  setItemIconAtlas(atlas: ItemIconSource): void {
    this.itemIconAtlas = atlas;
    this.itemEntityRenderer.setIconAtlas(atlas);
  }

  /** Uploads/refreshes the atlas texture only when ItemIconAtlas produced a new canvas. */
  private syncItemIconTexture(): void {
    const atlas = this.itemIconAtlas;
    const canvas = atlas?.bakedCanvas ?? null;
    const slot = this.texIdByKey.get(ITEM_ICON_TEXTURE);
    if (!atlas || !canvas || slot === undefined) return;
    if (this.itemIconCanvas === canvas && this.textures[slot]) return;
    const gl = this.gl;
    if (!this.itemIconTexture) this.itemIconTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.itemIconTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.textures[slot] = this.itemIconTexture;
    this.itemIconCanvas = canvas;
  }

  /** Loads all entity textures. Safe to call multiple times (idempotent). */
  init(base = '/mc/textures/entity'): Promise<void> {
    if (!this.loading) this.loading = this.loadTextures(base);
    return this.loading;
  }

  /**
   * Per-frame environment: the shared lightmap texture and the fog, both owned
   * by other packages. `sky` is the single source of truth (SkyState) and the
   * fog numbers come from the light package's FogState.computeFog().
   */
  setEnvironment(lightmap: WebGLTexture | null, sky: SkyState, renderDistance: number): void {
    this.lightmap = lightmap ?? this.whiteLightmap;
    const key = `${renderDistance}|${sky.fogColor[0]},${sky.fogColor[1]},${sky.fogColor[2]}`
      + `|${sky.skyColor[0]},${sky.skyColor[1]},${sky.skyColor[2]}|${sky.sunAngleDeg}`;
    if (key === this.fogKey) return;
    this.fogKey = key;
    // NOTE: rainLevel / sunrise alpha are not available on SkyState yet, so the
    // fog is computed for clear weather (vanilla defaults for those inputs).
    const fog = computeFog({
      renderDistanceBlocks: renderDistance * 16,
      fogColorArgb: argbFromRgb(sky.fogColor),
      skyColorArgb: argbFromRgb(sky.skyColor),
      sunAngleDeg: sky.sunAngleDeg,
    });
    this.fogColor[0] = fog.color[0];
    this.fogColor[1] = fog.color[1];
    this.fogColor[2] = fog.color[2];
    this.fogEnvStart = fog.environmentalStart;
    this.fogEnvEnd = fog.environmentalEnd;
    this.fogRenderStart = fog.renderDistanceStart;
    this.fogRenderEnd = fog.renderDistanceEnd;
  }

  private async loadTextures(base: string): Promise<void> {
    const gl = this.gl;
    for (let i = 0; i < this.n; i++) {
      const key = ALL_TEXTURE_KEYS[i];
      if (key === WHITE_TEXTURE || key === ITEM_ICON_TEXTURE || this.textures[i]) continue;
      try {
        // `block/...` keys (PrimedTnt) live under textures/block, not textures/entity.
        const url = key.startsWith('block/')
          ? `${base.slice(0, base.lastIndexOf('/'))}/${key}.png`
          : `${base}/${key}.png`;
        const img = await loadImage(url);
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

  // ---------------------------------------------------------------- preview

  private previewFbo: WebGLFramebuffer | null = null;
  private previewTex: WebGLTexture | null = null;
  private previewDepth: WebGLRenderbuffer | null = null;
  private previewW = 0;
  private previewH = 0;
  private previewCanvas: HTMLCanvasElement | null = null;
  /** Cache key + time of the last preview bake (see renderPreview). */
  private previewKey = '';
  private previewAt = 0;
  private readonly previewView = new Float32Array(16);
  private readonly previewProj = new Float32Array(16);
  private readonly previewVp = new Float32Array(16);

  /**
   * Renders one entity into an offscreen target and returns it as a canvas, for the survival
   * inventory's 3D player preview (vanilla InventoryScreen.renderEntityInInventoryFollowsMouse).
   * The GUI is Canvas2D, so the rendered pixels are read back once per mouse move.
   */
  renderPreview(
    player: { x: number; y: number; z: number },
    level: { getSkyLight(x: number, y: number, z: number): number; getBlockLight(x: number, y: number, z: number): number },
    size: number,
    yawRad: number,
  ): HTMLCanvasElement | null {
    // The client Player is a physics object, not an Entity subclass; the renderers only need the
    // render-state fields, so build the minimal record here.
    const entity = playerStub(player, level);
    const gl = this.gl;
    const w = Math.max(8, Math.floor(size));
    const h = Math.max(8, Math.floor(size * 1.35));
    if (!this.previewFbo || this.previewW !== w || this.previewH !== h) {
      if (this.previewFbo) gl.deleteFramebuffer(this.previewFbo);
      if (this.previewTex) gl.deleteTexture(this.previewTex);
      if (this.previewDepth) gl.deleteRenderbuffer(this.previewDepth);
      this.previewTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.previewTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.previewDepth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.previewDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      this.previewFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.previewFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.previewTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.previewDepth);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[preview] framebuffer incomplete', status);
        return null;
      }
      this.previewW = w;
      this.previewH = h;
    }

    // The readPixels below is a GPU sync point. Running it every frame while an inventory is open
    // showed up as `screens` 30 ms spikes and a 35 fps dip. The preview only changes with the
    // size and the mouse-follow yaw, so reuse the last canvas unless the yaw moved ~1.4 degrees
    // (or 200 ms passed, which covers an equipment change).
    const key = `${w}x${h}|${Math.round(yawRad * 40)}`;
    const now = performance.now();
    if (this.previewCanvas && key === this.previewKey && now - this.previewAt < 200) {
      return this.previewCanvas;
    }
    this.previewKey = key;
    this.previewAt = now;

    // InventoryScreen#extractEntityInInventoryFollowsMouse(x0,y0,x1,y1, 30, 0.0625, mouseX, mouseY):
    // the figure is a 3/4 view (vanilla applies ~30 deg of body yaw plus the mouse delta), seen
    // slightly from above, and fills about 70% of the 49x70 box. A straight-on, head-cropped
    // close-up is what made the preview look unlike vanilla.
    const cx = entity.x;
    const cy = entity.y;
    const cz = entity.z;
    const targetY = cy + 0.95;
    const dist = 4.55;
    const bodyYaw = -0.52 + yawRad; // ~30 deg three-quarter view + mouse follow
    const camX = cx + Math.sin(bodyYaw) * dist;
    const camZ = cz + Math.cos(bodyYaw) * dist;
    const camY = targetY + 0.42; // look down a little, like the vanilla inventory camera
    lookAt(this.previewView, camX, camY, camZ, cx, targetY, cz);
    perspective(this.previewProj, (30 * Math.PI) / 180, w / h, 0.05, 16);
    mul4(this.previewVp, this.previewProj, this.previewView);

    // Face the camera: body yaw points away from it (the model is rotated by 180 - bodyRot).
    const stub = entity as unknown as { yBodyRot: number; yHeadRot: number };
    entity.yaw = (bodyYaw * 180) / Math.PI;
    stub.yBodyRot = entity.yaw;
    stub.yHeadRot = entity.yaw;

    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.previewFbo);
    gl.viewport(0, 0, w, h);
    // InventoryScreen's preview box is BLACK in the vanilla 26.2 inventory texture (the
    // entity is drawn into that black window), not the grey container panel. Clearing to an
    // opaque black keeps the alpha channel stable and matches the reference screenshot.
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    try {
      // Distance culling in render() uses `camera`; put it at the preview camera.
      this.render([entity], this.previewVp, { x: camX, y: camY, z: camZ }, 0);
      // Must read while the preview FBO is still bound.
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const canvas = this.previewCanvas ?? (this.previewCanvas = document.createElement('canvas'));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(pixels.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  render(entities: Iterable<Entity>, viewProj: Float32Array, camera: EntityCamera, partialTick: number): void {
    const gl = this.gl;
    this.batch.reset();
    this.syncItemIconTexture();
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
      // Extra render layers (e.g. SheepRenderer's tinted wool over the skin).
      const layers = renderer.getLayers(e);
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const layerTex = this.texIdByKey.get(layer.texture);
        if (layerTex === undefined || !this.textures[layerTex]) continue;
        renderer.appendModel(e, layer.model, layer.tint, this.batch, layerTex, partialTick);
      }
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
    this.program.set1i('uLightmap', 1);
    this.program.set3f('uFogColor', this.fogColor[0], this.fogColor[1], this.fogColor[2]);
    this.program.set1f('uFogEnvStart', this.fogEnvStart);
    this.program.set1f('uFogEnvEnd', this.fogEnvEnd);
    this.program.set1f('uFogRenderStart', this.fogRenderStart);
    this.program.set1f('uFogRenderEnd', this.fogRenderEnd);
    this.program.set3f('uCameraPos', camera.x, camera.y, camera.z);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lightmap);
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

    // vanilla draws entity shadows right after the models (ShadowFeatureRenderer)
    this.renderShadows(entities, viewProj, camera);

    // GL state contract (REPORTS/session-reports/05-environment-audio.md:74-76):
    // draw only into the current framebuffer, never touch viewport/FBO/clear, and
    // restore depthMask / CULL_FACE BACK / BLEND off before returning.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Number of draw calls the last render used (one per non-empty texture). */
  get lastDrawCallCount(): number {
    let n = 0;
    for (let t = 0; t < this.n; t++) if (this.counts[t] > 0) n++;
    return n;
  }

  /**
   * Source: net.minecraft.client.renderer.feature.ShadowFeatureRenderer +
   * EntityRenderer.extractShadow. Every entity within 16 blocks gets one
   * textured quad per full block below it (vanilla shadowPower = 1 - distSq/256,
   * depth = min(power / 0.5 - 1, radius), alpha = powerAtDepth * 0.5 * brightness).
   */
  private renderShadows(entities: Iterable<Entity>, viewProj: Float32Array, camera: EntityCamera): void {
    const gl = this.gl;
    let out = this.shadowData;
    let o = 0;

    for (const e of entities) {
      if (e.isRemoved()) continue;
      const renderer = this.renderers.get(e.getTypeName());
      if (!renderer) continue;
      const radius = Math.min(renderer.getShadowRadius(e) * e.scale, 32);
      if (radius <= 0) continue;
      const dx = e.x - camera.x, dy = e.y - camera.y, dz = e.z - camera.z;
      const pow = (1 - (dx * dx + dy * dy + dz * dz) / 256) * renderer.getShadowStrength(e);
      if (pow <= 0) continue;
      const depth = Math.min(pow / 0.5 - 1, radius);
      const x0 = Math.floor(e.x - radius), x1 = Math.floor(e.x + radius);
      const z0 = Math.floor(e.z - radius), z1 = Math.floor(e.z + radius);
      const y0 = Math.floor(e.y - depth), y1 = Math.floor(e.y);
      const level = e.level;

      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const state = level.getBlockState(x, y - 1, z);
            if (state === 0) continue;
            if (level.mc.collision(state).length === 0) continue;
            const brightness = level.getBrightness(x, y, z);
            if (brightness <= 3) continue;
            const alpha = Math.max(0, Math.min(1, (pow - (e.y - y) * 0.5) * 0.5 * (brightness / 15)));
            if (alpha <= 0) continue;

            const need = o + 36;
            if (need > out.length) {
              let cap = out.length;
              while (cap < need) cap *= 2;
              const grown = new Float32Array(cap);
              grown.set(out);
              out = grown;
            }
            const wy = y + 0.02;
            const u0 = -(x - e.x) / (2 * radius) + 0.5;
            const u1 = -(x + 1 - e.x) / (2 * radius) + 0.5;
            const v0 = -(z - e.z) / (2 * radius) + 0.5;
            const v1 = -(z + 1 - e.z) / (2 * radius) + 0.5;
            // two triangles: (0,1,2) (0,2,3)
            out[o++] = x; out[o++] = wy; out[o++] = z; out[o++] = u0; out[o++] = v0; out[o++] = alpha;
            out[o++] = x; out[o++] = wy; out[o++] = z + 1; out[o++] = u0; out[o++] = v1; out[o++] = alpha;
            out[o++] = x + 1; out[o++] = wy; out[o++] = z + 1; out[o++] = u1; out[o++] = v1; out[o++] = alpha;
            out[o++] = x; out[o++] = wy; out[o++] = z; out[o++] = u0; out[o++] = v0; out[o++] = alpha;
            out[o++] = x + 1; out[o++] = wy; out[o++] = z + 1; out[o++] = u1; out[o++] = v1; out[o++] = alpha;
            out[o++] = x + 1; out[o++] = wy; out[o++] = z; out[o++] = u1; out[o++] = v0; out[o++] = alpha;
          }
        }
      }
    }

    this.shadowData = out;
    this.shadowVertices = o / 6;
    if (this.shadowVertices === 0) return;

    this.shadowProgram.use();
    this.shadowProgram.setMat4('uViewProj', viewProj);
    this.shadowProgram.set1i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.bindVertexArray(this.shadowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, this.shadowVertices);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  private ensureCombined(floats: number): void {
    if (floats <= this.combined.length) return;
    let cap = this.combined.length;
    while (cap < floats) cap *= 2;
    this.combined = new Float32Array(cap);
  }
}

// ---- small matrix helpers for the inventory preview -------------------------

function lookAt(out: Float32Array, ex: number, ey: number, ez: number, cx: number, cy: number, cz: number): void {
  let fx = cx - ex, fy = cy - ey, fz = cz - ez;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let sx = fy * 0 - fz * 1;
  let sy = fz * 0 - fx * 0;
  let sz = fx * 1 - fy * 0;
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;
  out[0] = sx; out[4] = sy; out[8] = sz; out[12] = -(sx * ex + sy * ey + sz * ez);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * ex + uy * ey + uz * ez);
  out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = -(-fx * ex + -fy * ey + -fz * ez);
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
}

function perspective(out: Float32Array, fovY: number, aspect: number, near: number, far: number): void {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
}

function mul4(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
}

/** Minimal Entity record for the inventory preview (fields read by EntityRenderer/MobRenderer). */
function playerStub(
  p: { x: number; y: number; z: number },
  level: { getSkyLight(x: number, y: number, z: number): number; getBlockLight(x: number, y: number, z: number): number },
): Entity {
  const stub = {
    x: p.x, y: p.y, z: p.z, xo: p.x, yo: p.y, zo: p.z,
    yaw: 0, yRotO: 0, pitch: 0, xRotO: 0,
    yHeadRot: 0, yHeadRotO: 0, yBodyRot: 0, yBodyRotO: 0,
    scale: 1, onGround: true, dead: false, deathTime: 0, hurtTime: 0,
    tickCount: 0, walkAnimPos: 0, walkAnimSpeed: 0, walkAnimSpeedOld: 0,
    swingProgress: 0, isOnFire: () => false,
    level,
    position: () => ({ x: p.x, y: p.y, z: p.z }),
    getEyeY: () => p.y + 1.62,
    getTypeName: () => 'player',
    isRemoved: () => false,
  };
  return stub as unknown as Entity;
}
