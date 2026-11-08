// Port of net.minecraft.client.gui.render.GuiItemAtlas /
// net.minecraft.client.renderer.entity.ItemRenderer (26.2 item icon baking).
// Renders every item into one icon atlas with the same baked models the world uses,
// so the hotbar and the inventory show the real block/item shapes (vanilla draws
// items with an isometric camera too: 30 degrees down, 45 degrees around Y).

import type { MinecraftData } from '../../vanilla/world/level/block/state/BlockState.js';
import type { ModelSource } from '../renderer/model/ModelSource.js';
import type { TextureManager } from '../renderer/TextureManager.js';
import { GlProgram, mat4Mul, mat4Perspective } from '../renderer/gl/Gl.js';
import { TERRAIN_FRAG, TERRAIN_VERT } from '../renderer/Shaders.js';

export interface ItemModelEntry {
  kind: 'block' | 'flat' | 'special' | 'composite' | 'none';
  model?: number;
  layers?: { texture: string; tint?: number; array?: string }[];
  special?: string;
  guiLight?: 'front' | 'side';
  parts?: { model: number; translation?: number[] }[];
}

// Vanilla bakes GUI item icons at the slot's own 16x16 resolution (GuiItemAtlas draws straight
// into the slot framebuffer). Baking at 48 and blitting down to 16 with nearest-neighbour threw
// away 2 of every 3 texels, which is what produced the grey "cracks" inside every block icon.
const CELL = 16;
const COLS = 40;
const ATLAS = CELL * COLS;

export class ItemIconAtlas {
  private readonly program: GlProgram;
  private canvas: HTMLCanvasElement | null = null;
  private itemModels: Record<string, ItemModelEntry> = {};
  private whiteLightmap: WebGLTexture;
  /** item index -> cell index */
  private cellOf = new Int32Array(0);

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mc: MinecraftData,
    private readonly models: ModelSource,
    private readonly textures: TextureManager,
  ) {
    this.program = new GlProgram(gl, TERRAIN_VERT, TERRAIN_FRAG, 'icons');
    const white = new Uint8Array(16 * 16 * 4).fill(255);
    this.whiteLightmap = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.whiteLightmap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  get ready(): boolean { return this.canvas !== null; }

  async loadModels(base = '/mc'): Promise<void> {
    const res = await fetch(`${base}/itemmodels.json`);
    if (!res.ok) return;
    const json = await res.json();
    this.itemModels = json.items;
  }

  /** Draws every item once into the atlas. Call after loadModels(). */
  build(): void {
    const gl = this.gl;
    this.cellOf = new Int32Array(this.mc.items.length).fill(-1);

    const fb = gl.createFramebuffer()!;
    const color = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS, ATLAS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, ATLAS, ATLAS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

    gl.viewport(0, 0, ATLAS, ATLAS);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.program.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
    this.program.set1i('uAtlas', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.whiteLightmap);
    this.program.set1i('uLightmap', 1);
    // TERRAIN_FRAG also declares the Phase B shadow-map sampler (render package). The icon
    // pass never uses shadows, but WebGL validates every active sampler per draw, so the
    // sampler still needs a legal unit that does not collide with uAtlas (sampler2DArray, 0).
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.whiteLightmap);
    this.program.set1i('uShadowMap', 3);
    this.program.set1i('uUseShadows', 0);
    this.program.set1f('uFogStart', 1e9);
    this.program.set1f('uFogEnd', 1e9 + 1);
    this.program.set3f('uFogColor', 0, 0, 0);
    this.program.set3f('uCameraPos', 0, 0, 0);
    this.program.set3f('uChunkOrigin', 0, 0, 0);
    this.program.set1f('uAlphaTest', 0.02);
    this.program.set1f('uTranslucent', 0);

    // Block items: vanilla display.gui rotation [30, 225, 0] => eye-space basis
    // R = Rx(30deg) * Ry(225deg); top + north + east faces are the visible ones.
    const proj = ortho(-0.8, 0.8, -0.8, 0.8, -8, 8);
    const yaw = (225 * Math.PI) / 180;
    const pitch = (30 * Math.PI) / 180;
    const view = isoView(yaw, pitch);
    const isoVp = mat4Mul(proj, view, new Float32Array(16));
    // Flat items: GuiItemAtlas.drawToSlot (net/minecraft/client/gui/render/GuiItemAtlas.java:103-108)
    // does *not* rotate a generated item model - it only translates to the slot centre and
    // scale(slotTextureSize), so the sprite faces the GUI camera and fills the whole slot.
    // Model space runs 0..1; centring it and using a 1-unit ortho box makes the quad fill the cell.
    const flatVp = ortho(-0.5, 0.5, -0.5, 0.5, -8, 8);
    this.program.setMat4('uViewProj', isoVp);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
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
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

    const verts = new Uint8Array(24 * 4);
    const dv = new DataView(verts.buffer);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    let cell = 0;
    for (let itemId = 0; itemId < this.mc.items.length; itemId++) {
      const name = this.mc.items[itemId].name;
      const entry = this.itemModels[`minecraft:${name}`];
      if (!entry || entry.kind === 'none') continue;
      if (cell >= COLS * COLS) break;
      const cx = (cell % COLS) * CELL;
      const cy = Math.floor(cell / COLS) * CELL;
      this.cellOf[itemId] = cell;
      cell++;

      gl.viewport(cx, ATLAS - cy - CELL, CELL, CELL);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // Flat sprites are drawn screen-aligned (see flatVp above); blocks use the iso camera.
      const flatIcon = entry.kind === 'flat' || entry.kind === 'special';
      this.program.setMat4('uViewProj', flatIcon ? flatVp : isoVp);

      const tint = itemIconTint(name);
      if (entry.kind === 'block' && entry.model !== undefined) {
        this.drawModel(entry.model, vao, vbo, ibo, verts, dv, indices, entry.guiLight === 'front', tint);
      } else if (entry.kind === 'composite' && entry.parts) {
        for (const part of entry.parts) this.drawModel(part.model, vao, vbo, ibo, verts, dv, indices, false, tint);
      } else if (entry.kind === 'flat' && entry.layers?.length) {
        this.drawFlat(entry, vao, vbo, ibo, verts, dv, indices);
      } else if (entry.kind === 'special') {
        this.drawSpecial(entry, vao, vbo, ibo, verts, dv, indices);
      }
    }

    // read back into a canvas so the 2D GUI can draw from it
    const pixels = new Uint8ClampedArray(ATLAS * ATLAS * 4);
    gl.readPixels(0, 0, ATLAS, ATLAS, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS;
    canvas.height = ATLAS;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(ATLAS, ATLAS);
    // flip vertically: GL origin is bottom left
    for (let y = 0; y < ATLAS; y++) {
      const src = (ATLAS - y - 1) * ATLAS * 4;
      imageData.data.set(pixels.subarray(src, src + ATLAS * 4), y * ATLAS * 4);
    }
    ctx.putImageData(imageData, 0, 0);
    this.canvas = canvas;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteRenderbuffer(depth);
    gl.deleteTexture(color);
  }

  private drawModel(
    modelIndex: number, vao: WebGLVertexArrayObject, vbo: WebGLBuffer, ibo: WebGLBuffer,
    verts: Uint8Array, dv: DataView, indices: Uint32Array, frontLight: boolean,
    tint: number,
  ): void {
    const gl = this.gl;
    const model = this.models.getModel(modelIndex);
    if (!model.quads.length) return;
    // Re-bind the block array: a flat icon drawn just before this leaves the item array on unit 0.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
    const buffer = new Uint8Array(model.quads.length * 4 * 24);
    const bdv = new DataView(buffer.buffer);
    const indexBuffer = new Uint32Array(model.quads.length * 6);
    let vi = 0;
    let ii = 0;
    for (const quad of model.quads) {
      const shade = frontLight ? 1 : faceShade(quad.dir);
      for (let v = 0; v < 4; v++) {
        const o = vi * 24;
        bdv.setFloat32(o, quad.p[v * 3], true);
        bdv.setFloat32(o + 4, quad.p[v * 3 + 1], true);
        bdv.setFloat32(o + 8, quad.p[v * 3 + 2], true);
        bdv.setUint16(o + 12, Math.round((quad.uv[v * 2] / 16) * 4096), true);
        bdv.setUint16(o + 14, Math.round((quad.uv[v * 2 + 1] / 16) * 4096), true);
        bdv.setUint16(o + 16, quad.tex, true);
        bdv.setUint8(o + 18, 15);
        bdv.setUint8(o + 19, 15);
        // tintIndex >= 0 uses the default grass/foliage colour, exactly like vanilla's
        // ItemBlockRenderTypes path with a null biome (grass_block tops were white before).
        const tr = quad.tint >= 0 ? (tint >> 16) & 255 : 255;
        const tg = quad.tint >= 0 ? (tint >> 8) & 255 : 255;
        const tb = quad.tint >= 0 ? tint & 255 : 255;
        bdv.setUint8(o + 20, Math.round(shade * tr));
        bdv.setUint8(o + 21, Math.round(shade * tg));
        bdv.setUint8(o + 22, Math.round(shade * tb));
        bdv.setUint8(o + 23, 255);
        vi++;
      }
      const base = (ii / 6) * 4;
      indexBuffer[ii++] = base;
      indexBuffer[ii++] = base + 1;
      indexBuffer[ii++] = base + 2;
      indexBuffer[ii++] = base;
      indexBuffer[ii++] = base + 2;
      indexBuffer[ii++] = base + 3;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBuffer, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, ii, gl.UNSIGNED_INT, 0);
  }

  private drawFlat(
    entry: ItemModelEntry, vao: WebGLVertexArrayObject, vbo: WebGLBuffer, ibo: WebGLBuffer,
    verts: Uint8Array, dv: DataView, indices: Uint32Array,
  ): void {
    const gl = this.gl;
    const layerInfo = entry.layers![0];
    const isItemArray = (layerInfo.array ?? 'item') === 'item';
    const layer = isItemArray ? this.textures.itemLayer.get(layerInfo.texture) : this.textures.blockLayer.get(layerInfo.texture);
    if (layer === undefined) return;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, isItemArray ? this.textures.item.texture : this.textures.block.texture);

    // A generated item model spans 0..1 in model space and faces +Z; centred on the origin and
    // paired with flatVp it covers the whole CELL, exactly like a 16x16 GUI blit of the slot.
    const quad = [
      [-0.5, 0.5, 0, 0], [0.5, 0.5, 1, 0], [0.5, -0.5, 1, 1], [-0.5, -0.5, 0, 1],
    ];
    // items/*.json tint of the layer (short_grass, fern, vine, lily_pad ...): baked ARGB, -1/undefined = white
    const tintArgb = layerInfo.tint !== undefined && layerInfo.tint !== -1 ? layerInfo.tint | 0 : 0xffffffff | 0;
    const tr = (tintArgb >> 16) & 255, tg = (tintArgb >> 8) & 255, tb = tintArgb & 255;
    const buffer = new Uint8Array(4 * 24);
    const bdv = new DataView(buffer.buffer);
    quad.forEach(([x, y, u, v], i) => {
      const o = i * 24;
      bdv.setFloat32(o, x, true);
      bdv.setFloat32(o + 4, y, true);
      bdv.setFloat32(o + 8, 0, true);
      bdv.setUint16(o + 12, Math.round(u * 4096), true);
      bdv.setUint16(o + 14, Math.round(v * 4096), true);
      bdv.setUint16(o + 16, layer, true);
      bdv.setUint8(o + 18, 15);
      bdv.setUint8(o + 19, 15);
      bdv.setUint8(o + 20, tr);
      bdv.setUint8(o + 21, tg);
      bdv.setUint8(o + 22, tb);
      bdv.setUint8(o + 23, 255);
    });
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);

    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
  }

  private drawSpecial(
    entry: ItemModelEntry, vao: WebGLVertexArrayObject, vbo: WebGLBuffer, ibo: WebGLBuffer,
    verts: Uint8Array, dv: DataView, indices: Uint32Array,
  ): void {
    const textures: Record<string, string> = {
      chest: 'entity/chest/normal',
      shulker_box: 'entity/shulker/shulker',
      banner: 'entity/banner/banner_base',
      shield: 'entity/shield/shield_base',
      conduit: 'entity/conduit/base',
    };
    const tex = entry.special ? textures[entry.special] : undefined;
    if (tex) {
      this.drawFlat({ ...entry, layers: [{ texture: tex, array: 'block' }] }, vao, vbo, ibo, verts, dv, indices);
    }
  }

  /** Draws an item icon at GUI pixel coordinates. */
  draw(ctx: CanvasRenderingContext2D, itemId: number, x: number, y: number, size: number): void {
    if (!this.canvas || itemId < 0 || itemId >= this.cellOf.length) return;
    const cell = this.cellOf[itemId];
    if (cell < 0) return;
    const cx = (cell % COLS) * CELL;
    const cy = Math.floor(cell / COLS) * CELL;
    ctx.drawImage(this.canvas, cx, cy, CELL, CELL, x, y, size, size);
  }

  /** True when the item has a rendered icon. */
  hasIcon(itemId: number): boolean {
    return itemId >= 0 && itemId < this.cellOf.length && this.cellOf[itemId] >= 0;
  }
}

/**
 * Default tint applied when a model face declares a tintIndex (grass_block top, leaves, ...).
 * Vanilla uses GrassColor/FoliageColor#getDefaultColor for GUI icons (no biome context).
 */
function itemIconTint(name: string): number {
  if (/leaves|vine|mangrove_roots|azalea/.test(name)) return 0x48b518;
  if (/grass_block|short_grass|tall_grass|fern|potted_fern/.test(name)) return 0x7cbd6b;
  if (/water|bubble_column/.test(name)) return 0x3f76e4;
  if (/lily_pad/.test(name)) return 0x71c35c;
  if (/attached_melon_stem|attached_pumpkin_stem/.test(name)) return 0xe0c71c;
  if (/redstone_wire/.test(name)) return 0xff0000;
  return 0xffffff;
}

function faceShade(dir: number): number {
  switch (dir) {
    case 0: return 0.5;
    case 1: return 1;
    case 2: case 3: return 0.8;
    default: return 0.6;
  }
}

function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  const out = new Float32Array(16);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

function isoView(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // R = Rx(pitch) * Ry(yaw), column-major; then translate the model centre to the origin.
  const m = new Float32Array(16);
  m[0] = cy; m[4] = 0; m[8] = sy;
  m[1] = sp * sy; m[5] = cp; m[9] = -sp * cy;
  m[2] = -cp * sy; m[6] = sp; m[10] = cp * cy;
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  // center of a 1x1x1 block at (0.5, 0.5, 0.5)
  const cx = 0.5, cyy = 0.5, cz = 0.5;
  m[12] = -(m[0] * cx + m[4] * cyy + m[8] * cz);
  m[13] = -(m[1] * cx + m[5] * cyy + m[9] * cz);
  m[14] = -(m[2] * cx + m[6] * cyy + m[10] * cz);
  return m;
}
