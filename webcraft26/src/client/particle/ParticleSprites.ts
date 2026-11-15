// Parses assets/minecraft/particles/*.json (each is { "textures": [...] }),
// packs public/mc/textures/particle/**.png into one atlas, and emits
//   public/mc/particle_atlas.png  +  public/mc/particles.json (uv table).
//
// The packing is pure TypeScript (no DOM / Node / third-party types) so the
// verification script can drive it through an injected AtlasIoAdapter (fs+pngjs),
// while the browser side only uses ParticleSpriteAtlas to look up UVs.

import { loadImage } from '../renderer/gl/Gl.js';

export interface SpriteUv { u0: number; v0: number; u1: number; v1: number }

export interface ParticleDef {
  /** filename without .json, e.g. "explosion" */
  name: string;
  /** texture names with the minecraft: namespace stripped */
  textures: string[];
}

export interface TextureImage {
  name: string;                 // without .png, e.g. "flame"
  width: number;
  height: number;
  rgba: Uint8Array;             // length = width*height*4
}

export interface ParticleAtlasJson {
  version: number;
  atlas: string;
  width: number;
  height: number;
  sprites: Record<string, SpriteUv>;
  events: Record<string, string[]>;
  unresolved: string[];
}

export interface AtlasLayout {
  width: number;
  height: number;
  rgba: Uint8Array;
  sprites: Record<string, SpriteUv>;
  unresolved: string[];
}

/** Accepts a map of "<file>.json" -> parsed definition object. */
export function parseParticleDefinitions(raw: Record<string, unknown>): ParticleDef[] {
  const out: ParticleDef[] = [];
  for (const [file, value] of Object.entries(raw)) {
    const name = file.replace(/\.json$/, '');
    const obj = (value ?? {}) as { textures?: unknown };
    const list = Array.isArray(obj.textures) ? obj.textures : [];
    out.push({
      name,
      textures: list.map((t) => String(t).replace(/^minecraft:/, '')),
    });
  }
  return out;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Shelf packing: sort by (height desc, name), place left-to-right, wrap rows.
 * Returns normalised [0,1] UVs for every texture plus the list of definition
 * textures that could not be found among the supplied images.
 */
export function computeAtlasLayout(
  images: TextureImage[],
  defs: ParticleDef[],
  atlasWidth = 512,
): AtlasLayout {
  const sorted = [...images].sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  let x = 0, y = 0, rowH = 0;
  const placements: { img: TextureImage; x: number; y: number }[] = [];
  for (const img of sorted) {
    if (x + img.width > atlasWidth) { x = 0; y += rowH; rowH = 0; }
    placements.push({ img, x, y });
    x += img.width;
    if (img.height > rowH) rowH = img.height;
  }
  const height = nextPow2(Math.max(1, y + rowH));
  const rgba = new Uint8Array(atlasWidth * height * 4);
  const sprites: Record<string, SpriteUv> = {};

  for (const p of placements) {
    const { img } = p;
    for (let row = 0; row < img.height; row++) {
      const src = row * img.width * 4;
      const dst = ((p.y + row) * atlasWidth + p.x) * 4;
      rgba.set(img.rgba.subarray(src, src + img.width * 4), dst);
    }
    sprites[img.name] = {
      u0: p.x / atlasWidth,
      v0: p.y / height,
      u1: (p.x + img.width) / atlasWidth,
      v1: (p.y + img.height) / height,
    };
  }

  const referenced = new Set<string>();
  for (const d of defs) for (const t of d.textures) referenced.add(t);
  const unresolved = [...referenced].filter((t) => !sprites[t]).sort();
  return { width: atlasWidth, height, rgba, sprites, unresolved };
}

export function buildAtlasJson(layout: AtlasLayout, defs: ParticleDef[]): ParticleAtlasJson {
  const events: Record<string, string[]> = {};
  for (const d of defs) events[d.name] = d.textures;
  return {
    version: 1,
    atlas: 'particle_atlas.png',
    width: layout.width,
    height: layout.height,
    sprites: layout.sprites,
    events,
    unresolved: layout.unresolved,
  };
}

export interface AtlasIoAdapter {
  /** texture names (without .png) available under textures/particle/ */
  listTextures(): Promise<string[]> | string[];
  readPng(name: string): Promise<TextureImage> | TextureImage;
  /** map of "<file>.json" -> parsed json */
  readDefinitions(): Promise<Record<string, unknown>> | Record<string, unknown>;
  writePng(width: number, height: number, rgba: Uint8Array): Promise<void> | void;
  writeJson(json: ParticleAtlasJson): Promise<void> | void;
}

export interface AtlasGenerationResult {
  textureCount: number;
  eventCount: number;
  spriteCount: number;
  width: number;
  height: number;
  unresolved: string[];
}

/** Builds both output files. IO is injected so this works in Node and Node-only. */
export async function generateParticleAtlas(io: AtlasIoAdapter): Promise<AtlasGenerationResult> {
  const raw = await io.readDefinitions();
  const defs = parseParticleDefinitions(raw);
  const names = await io.listTextures();
  const images: TextureImage[] = [];
  for (const name of names) images.push(await io.readPng(name));
  const layout = computeAtlasLayout(images, defs);
  const json = buildAtlasJson(layout, defs);
  await io.writePng(layout.width, layout.height, layout.rgba);
  await io.writeJson(json);
  return {
    textureCount: images.length,
    eventCount: defs.length,
    spriteCount: Object.keys(json.sprites).length,
    width: layout.width,
    height: layout.height,
    unresolved: json.unresolved,
  };
}

const FALLBACK_UV: SpriteUv = { u0: 0, v0: 0, u1: 1, v1: 1 };

/** Runtime side: looks up sprite UVs from /mc/particles.json and loads the atlas. */
export class ParticleSpriteAtlas {
  texture: WebGLTexture | null = null;
  /** Pre-resolved frame arrays so frame() allocates nothing per particle. */
  private readonly frameCache = new Map<string, SpriteUv[]>();

  constructor(readonly json: ParticleAtlasJson) {
    for (const [event, names] of Object.entries(json.events)) {
      this.frameCache.set(event, names.map((n) => json.sprites[n] ?? FALLBACK_UV));
    }
  }

  get width(): number { return this.json.width; }
  get height(): number { return this.json.height; }
  get spriteCount(): number { return Object.keys(this.json.sprites).length; }
  get unresolved(): readonly string[] { return this.json.unresolved; }

  static async load(gl: WebGL2RenderingContext, url = '/mc/particles.json'): Promise<ParticleSpriteAtlas> {
    const res = await fetch(url);
    if (!res.ok) throw new Error('failed to load ' + url);
    const json = await res.json() as ParticleAtlasJson;
    const atlas = new ParticleSpriteAtlas(json);
    await atlas.loadTexture(gl);
    return atlas;
  }

  async loadTexture(gl: WebGL2RenderingContext, url = '/mc/particle_atlas.png'): Promise<WebGLTexture> {
    const img = await loadImage(url);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Vanilla binds the particle sheet with NEAREST (TextureManager / ParticleEngine): the
    // sprites are 8x8 / 16x16 pixel art. LINEAR turned a smoke puff into a soft blurry blob
    // (the "campfire smoke is not pixelated" report) and bled neighbouring atlas sprites in.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.texture = tex;
    return tex;
  }

  uv(spriteName: string): SpriteUv {
    return this.json.sprites[spriteName] ?? FALLBACK_UV;
  }

  /** All frames of a particle event in spritesheet order (cached, do not mutate). */
  frames(eventName: string): SpriteUv[] {
    return this.frameCache.get(eventName) ?? [FALLBACK_UV];
  }

  frame(eventName: string, index: number): SpriteUv {
    const f = this.frameCache.get(eventName);
    if (!f || !f.length) return FALLBACK_UV;
    return f[((index % f.length) + f.length) % f.length] ?? FALLBACK_UV;
  }
}
