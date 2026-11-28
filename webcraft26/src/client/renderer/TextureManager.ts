// Loads the packed texture arrays and the loose PNGs the 3D passes need, and plays
// block texture animations by re-uploading single array layers (vanilla stitches
// animation frames into the atlas; we keep UVs constant and animate the texels).

import { createTexture2D, createTextureArray, loadImage, updateTextureArrayLayer, type TextureArray } from './gl/Gl.js';

export interface AnimationInfo {
  layer: number;
  frames: number;
  frametime: number;
  interpolate: boolean;
  frameList: { index: number; time?: number }[] | number[] | null;
  offset: number;
  length: number;
}

export class TextureManager {
  block!: TextureArray;
  item!: TextureArray;
  blockNames: string[] = [];
  itemNames: string[] = [];
  readonly blockLayer = new Map<string, number>();
  readonly itemLayer = new Map<string, number>();
  animations: Record<string, AnimationInfo> = {};
  private animData: Uint8Array = new Uint8Array(0);

  lightmap: WebGLTexture | null = null;
  private lightmapData = new Uint8Array(16 * 16 * 4);
  private lastLightmapKey = '';

  /** Refraction noise (refraction.glsl samples the pack's `noisetex` through this). */
  noise: WebGLTexture | null = null;

  readonly images = new Map<string, HTMLImageElement>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    // Refraction noise: deterministic RG noise on the pack's 256² repeat sampling. The shader
    // pack ships lib/textures/noise.png; generating an equivalent field here keeps the same
    // distortion character without redistributing the pack's assets. Created in the
    // constructor so the terrain program never samples an unbound unit during boot.
    const N = 256;
    const noise = new Uint8Array(N * N * 4);
    let seed = 0x9e3779b9;
    for (let i = 0; i < N * N; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise[i * 4] = seed >>> 24;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise[i * 4 + 1] = seed >>> 24;
      noise[i * 4 + 3] = 255;
    }
    this.noise = createTexture2D(gl, N, N, noise, gl.LINEAR, gl.REPEAT);
  }

  async load(base = '/mc'): Promise<void> {
    const gl = this.gl;
    const [blockMetaRes, blockBinRes, itemMetaRes, itemBinRes, animRes] = await Promise.all([
      fetch(`${base}/tex/block.json`),
      fetch(`${base}/tex/block.bin`),
      fetch(`${base}/tex/item.json`),
      fetch(`${base}/tex/item.bin`),
      fetch(`${base}/tex/anim.bin`),
    ]);
    if (!blockMetaRes.ok) throw new Error('missing block texture pack');
    const blockMeta = await blockMetaRes.json();
    const blockBin = new Uint8Array(await blockBinRes.arrayBuffer());
    const itemMeta = await itemMetaRes.json();
    const itemBin = new Uint8Array(await itemBinRes.arrayBuffer());
    this.animData = new Uint8Array(await animRes.arrayBuffer());

    const header = new DataView(blockBin.buffer, blockBin.byteOffset, blockBin.byteLength);
    const layerCount = header.getUint32(8, true);
    const size = header.getUint32(12, true);
    const blockPixels = blockBin.subarray(16);
    this.block = createTextureArray(gl, blockPixels, layerCount, size, true);

    const ih = new DataView(itemBin.buffer, itemBin.byteOffset, itemBin.byteLength);
    this.item = createTextureArray(gl, itemBin.subarray(16), ih.getUint32(8, true), ih.getUint32(12, true), true);

    this.blockNames = blockMeta.names;
    this.itemNames = itemMeta.names;
    this.blockNames.forEach((n, i) => this.blockLayer.set(n, i));
    this.itemNames.forEach((n, i) => this.itemLayer.set(n, i));
    this.animations = blockMeta.animated ?? {};

    // Vanilla LightTexture uses GL_LINEAR on the 16x16 lightmap. NEAREST quantises the
    // interpolated per-vertex light back to 16 hard steps, which is what made the
    // "shader lighting not smooth" banding visible on large flat faces.
    this.lightmap = createTexture2D(gl, 16, 16, this.lightmapData, gl.LINEAR);
  }

  /** Loads a loose PNG once (celestial bodies, clouds, GUI). */
  async image(path: string): Promise<HTMLImageElement> {
    const cached = this.images.get(path);
    if (cached) return cached;
    const img = await loadImage(`/mc/textures/${path}.png`);
    this.images.set(path, img);
    return img;
  }

  async imageTexture(path: string): Promise<WebGLTexture> {
    const img = await this.image(path);
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  /** uploads a new lightmap if the sky state changed */
  updateLightmap(data: Uint8Array, key: string): void {
    if (key === this.lastLightmapKey) return;
    this.lastLightmapKey = key;
    this.lightmapData.set(data);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lightmap);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, this.lightmapData);
  }

  /** Advances block animations; `tick` is the world time in ticks (20 per second). */
  animate(tick: number): void {
    const gl = this.gl;
    const size = this.block.size;
    for (const [name, anim] of Object.entries(this.animations)) {
      if (anim.frames <= 1) continue;
      const frameTime = anim.frametime || 1;
      let index: number;
      if (Array.isArray(anim.frameList) && anim.frameList.length > 0) {
        const list = anim.frameList as (number | { index: number })[];
        index = typeof list[0] === 'number'
          ? (list[Math.floor(tick / frameTime) % list.length] as number)
          : (list[Math.floor(tick / frameTime) % list.length] as { index: number }).index;
      } else {
        index = Math.floor(tick / frameTime) % anim.frames;
      }
      const bytes = animDataFrame(this.animData, anim, index, size);
      if (bytes) updateTextureArrayLayer(gl, this.block.texture, anim.layer, size, bytes);
    }
  }

  /** Resolves a texture name ("block/stone") to its array layer, or -1. */
  blockTextureLayer(name: string): number {
    return this.blockLayer.get(name) ?? -1;
  }

  itemTextureLayer(name: string): number {
    return this.itemLayer.get(name) ?? -1;
  }
}

function animDataFrame(data: Uint8Array, anim: AnimationInfo, frame: number, size: number): Uint8Array | null {
  const frameBytes = size * size * 4;
  const start = anim.offset + frame * frameBytes;
  if (start + frameBytes > data.length) return null;
  return data.subarray(start, start + frameBytes);
}
