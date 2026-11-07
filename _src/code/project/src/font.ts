import { loadBitmap } from './gl.js';

interface Glyph {
  cx: number; cy: number; w: number; h: number; advance: number;
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class VanillaFont {
  private atlas: HTMLCanvasElement;
  private glyphs = new Map<number, Glyph>();
  private tinted = new Map<string, HTMLCanvasElement>();
  private shadowTinted = new Map<string, HTMLCanvasElement>();
  readonly lineHeight = 9;
  readonly height = 8;
  spaceAdvance = 4;

  private constructor(atlas: HTMLCanvasElement) {
    this.atlas = atlas;
  }

  static async load(manifestFont: Record<string, string>, base: string): Promise<VanillaFont> {
    const includeUrl = base + 'font/meta/include/default.json';
    const data = await (await fetch(includeUrl)).json();
    const provider = data.providers.find((p: any) => typeof p.file === 'string' && p.file.includes('ascii.png'));
    if (!provider) throw new Error('ascii font provider not found');
    const spaceData = await (await fetch(base + 'font/meta/include/space.json')).json().catch(() => null);
    const spaceProvider = spaceData?.providers?.find((p: any) => p.type === 'space');
    const bmp = await loadBitmap(base + 'font/textures/ascii.png');
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const font = new VanillaFont(canvas);
    if (spaceProvider?.advances?.[' '] != null) font.spaceAdvance = spaceProvider.advances[' '];

    const cellW = 8;
    const cellH = 8;
    const cols = Math.floor(canvas.width / cellW);
    provider.chars.forEach((row: string, rowIndex: number) => {
      for (let col = 0; col < row.length; col++) {
        const cp = row.charCodeAt(col);
        if (!cp) continue;
        const x0 = col * cellW;
        const y0 = rowIndex * cellH;
        let maxX = -1;
        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < cellW; x++) {
            if (image[((y0 + y) * canvas.width + (x0 + x)) * 4 + 3] > 8 && x > maxX) maxX = x;
          }
        }
        const advance = Math.max(1, maxX + 2);
        font.glyphs.set(cp, { cx: x0, cy: y0, w: cellW, h: cellH, advance });
      }
    });
    if (font.glyphs.has(32)) font.glyphs.get(32)!.advance = font.spaceAdvance;
    return font;
  }

  width(text: string): number {
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (ch === ' ') { w += this.spaceAdvance; continue; }
      const g = this.glyphs.get(cp);
      w += g ? g.advance : 6;
    }
    return w;
  }

  private getAtlas(color: string): HTMLCanvasElement {
    let c = this.tinted.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = this.atlas.width;
    c.height = this.atlas.height;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    this.tinted.set(color, c);
    return c;
  }

  private getShadowAtlas(color: string): HTMLCanvasElement {
    let c = this.shadowTinted.get(color);
    if (c) return c;
    const [r, g, b] = parseHex(color);
    const shadow = `rgb(${Math.floor(r * 0.25)},${Math.floor(g * 0.25)},${Math.floor(b * 0.25)})`;
    c = this.getAtlas(shadow);
    this.shadowTinted.set(color, c);
    return c;
  }

  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff', shadow = true): void {
    let xx = Math.round(x);
    const yy = Math.round(y);
    const atlas = this.getAtlas(color);
    const shadowAtlas = shadow ? this.getShadowAtlas(color) : null;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (ch === ' ') { xx += this.spaceAdvance; continue; }
      const g = this.glyphs.get(cp);
      if (!g) { xx += 6; continue; }
      if (shadowAtlas) ctx.drawImage(shadowAtlas, g.cx, g.cy, g.w, g.h, xx + 1, yy + 1, g.w, g.h);
      ctx.drawImage(atlas, g.cx, g.cy, g.w, g.h, xx, yy, g.w, g.h);
      xx += g.advance;
    }
  }

  drawCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = '#ffffff', shadow = true): void {
    this.draw(ctx, text, cx - this.width(text) / 2, y, color, shadow);
  }
}
