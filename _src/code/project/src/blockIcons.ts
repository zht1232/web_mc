// Software-rasterized vanilla-style GUI block icons from baked quad geometry.
import type { LoadedAssets } from './assets.js';
import type { BlockDef, Quad } from './blocks.js';

const ROT_X = (30 * Math.PI) / 180;
const ROT_Y = (225 * Math.PI) / 180;
const CX = Math.cos(ROT_X);
const SX = Math.sin(ROT_X);
const CY = Math.cos(ROT_Y);
const SY = Math.sin(ROT_Y);
const FACE_SHADE = [0.58, 1, 0.84, 0.91, 0.75, 0.66];
const FLAT_ITEMS = new Set(['torch', 'short_grass', 'fern', 'dead_bush', 'poppy', 'dandelion', 'cornflower',
  'azure_bluet', 'oxeye_daisy', 'allium', 'lily_of_the_valley', 'water', 'lava']);
const WHITE: [number, number, number] = [1, 1, 1];
const GRASS: [number, number, number] = [145 / 255, 189 / 255, 89 / 255];
const FOLIAGE: [number, number, number] = [119 / 255, 171 / 255, 47 / 255];
const WATER: [number, number, number] = [63 / 255, 118 / 255, 228 / 255];
const TINT_GRASS = 1;
const TINT_FOLIAGE = 2;
const TINT_WATER = 3;
const TINT_FIXED = 4;

type Pt = [number, number];

interface Face {
  q: Quad;
  pts: Pt[];
  depth: number;
  order: number;
}

function project(x: number, y: number, z: number): [number, number, number] {
  const px = x - 0.5, py = y - 0.5, pz = z - 0.5;
  const y1 = CX * py - SX * pz;
  const z1 = SX * py + CX * pz;
  return [CY * px + SY * z1, -y1, -SY * px + CY * z1];
}

function isCrossShape(def: BlockDef): boolean {
  if (def.quads.length !== 4) return false;
  for (const q of def.quads) if (q.d < 2 || q.d > 5) return false;
  return true;
}

export class BlockIconRenderer {
  private layerKeys = new Map<number, string>();
  private textures = new Map<string, HTMLCanvasElement>();
  private size = 64;
  private half = 32;
  private fit = 56;

  constructor(private assets: LoadedAssets) {
    for (const [key, tex] of Object.entries(assets.manifest.textures)) {
      if (tex.arrayLayer >= 0) this.layerKeys.set(tex.arrayLayer, key);
    }
  }

  render(def: BlockDef, size = 64): HTMLCanvasElement {
    this.size = Math.max(16, Math.min(256, Math.round(size)));
    this.half = this.size / 2;
    this.fit = this.size - Math.max(2, Math.round(this.size * 0.0625));
    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    if (FLAT_ITEMS.has(def.name) || isCrossShape(def)) {
      this.drawFlat(ctx, def);
      return canvas;
    }

    const faces: Face[] = [];
    for (const q of def.quads) {
      const key = this.layerKeys.get(q.layer);
      if (q.p.length < 12 || !key || !this.assets.icons.has(key)) continue;
      const pts: Pt[] = [];
      let depth = 0;
      for (let i = 0; i < 4; i++) {
        const [x, y, z] = project(q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]);
        pts.push([x, y]);
        depth += z;
      }
      faces.push({ q, pts, depth: depth / 4, order: faces.length });
    }
    if (faces.length === 0) {
      this.drawFallback(ctx, def);
      return canvas;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of faces) {
      for (const [x, y] of f.pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const scale = this.fit / span;
    const ox = this.half - ((minX + maxX) / 2) * scale;
    const oy = this.half - ((minY + maxY) / 2) * scale;
    for (const f of faces) {
      for (const p of f.pts) {
        p[0] = ox + p[0] * scale;
        p[1] = oy + p[1] * scale;
      }
    }
    faces.sort((a, b) => (b.depth - a.depth) || (a.order - b.order));

    for (const f of faces) {
      const key = this.layerKeys.get(f.q.layer);
      if (!key) continue;
      const tint = this.tintFor(def, f.q.ti);
      const shade = f.q.d >= 0 && f.q.d < FACE_SHADE.length ? FACE_SHADE[f.q.d] : 0.8;
      const tex = this.textureFor(key, tint, shade);
      if (tex) this.drawQuad(ctx, tex, f.pts, f.q.uv);
    }
    return canvas;
  }

  private tintFor(def: BlockDef, ti: number): [number, number, number] {
    if (ti < 0) return WHITE;
    switch (def.tintMode) {
      case TINT_GRASS: return GRASS;
      case TINT_FOLIAGE: return FOLIAGE;
      case TINT_WATER: return WATER;
      case TINT_FIXED: return def.tintColor;
      default: return WHITE;
    }
  }

  private textureFor(key: string, tint: [number, number, number], shade: number): HTMLCanvasElement | null {
    const tintKey = `${Math.round(tint[0] * 255)},${Math.round(tint[1] * 255)},${Math.round(tint[2] * 255)}`;
    const cacheKey = `${key}|${tintKey}|${Math.round(shade * 1000)}`;
    const cached = this.textures.get(cacheKey);
    if (cached) return cached;
    const src = this.assets.icons.get(key);
    if (!src) return null;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    if (tint[0] !== 1 || tint[1] !== 1 || tint[2] !== 1 || shade !== 1) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      const r = tint[0] * shade, g = tint[1] * shade, b = tint[2] * shade;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.round(d[i] * r);
        d[i + 1] = Math.round(d[i + 1] * g);
        d[i + 2] = Math.round(d[i + 2] * b);
      }
      ctx.putImageData(img, 0, 0);
    }
    this.textures.set(cacheKey, canvas);
    return canvas;
  }

  private drawFlat(ctx: CanvasRenderingContext2D, def: BlockDef): void {
    const key = def.iconFlat ?? def.iconTop ?? def.iconSide;
    if (!key) return;
    const ti = def.quads[0]?.ti ?? 0;
    const tex = this.textureFor(key, this.tintFor(def, ti), 1);
    if (tex) ctx.drawImage(tex, 0, 0, this.size, this.size);
  }

  private drawFallback(ctx: CanvasRenderingContext2D, def: BlockDef): void {
    const tint = this.tintFor(def, 0);
    const key = def.iconFlat ?? def.iconTop ?? def.iconSide;
    if (!key) return;
    const tex = this.textureFor(key, tint, 1);
    if (tex) ctx.drawImage(tex, 0, 0, this.size, this.size);
  }

  private drawQuad(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement, pts: Pt[], uv: number[]): void {
    const us = tex.width / 16;
    const vs = tex.height / 16;
    const u = [uv[0] * us, uv[2] * us, uv[4] * us, uv[6] * us];
    const v = [uv[1] * vs, uv[3] * vs, uv[5] * vs, uv[7] * vs];
    this.triangle(ctx, tex, pts[0][0], pts[0][1], u[0], v[0], pts[1][0], pts[1][1], u[1], v[1], pts[2][0], pts[2][1], u[2], v[2]);
    this.triangle(ctx, tex, pts[0][0], pts[0][1], u[0], v[0], pts[2][0], pts[2][1], u[2], v[2], pts[3][0], pts[3][1], u[3], v[3]);
  }

  private triangle(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement,
    x0: number, y0: number, u0: number, v0: number,
    x1: number, y1: number, u1: number, v1: number,
    x2: number, y2: number, u2: number, v2: number): void {
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(det) < 1e-6) return;
    const m11 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
    const m21 = ((u1 - u0) * (x2 - x0) - (u2 - u0) * (x1 - x0)) / det;
    const m12 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
    const m22 = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
    const dx = x0 - m11 * u0 - m21 * v0;
    const dy = y0 - m12 * u0 - m22 * v0;
    const gx = (x0 + x1 + x2) / 3;
    const gy = (y0 + y1 + y2) / 3;
    const grow = 0.7;
    const vx = [x0, x1, x2];
    const vy = [y0, y1, y2];
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ax = vx[i] - gx, ay = vy[i] - gy;
      const len = Math.hypot(ax, ay) || 1;
      const px = vx[i] + (ax / len) * grow;
      const py = vy[i] + (ay / len) * grow;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m11, m12, m21, m22, dx, dy);
    ctx.drawImage(tex, 0, 0);
    ctx.restore();
  }
}
