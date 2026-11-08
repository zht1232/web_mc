// Port of net.minecraft.client.gui.Font: draws with the official 8x8 bitmap font
// atlas (textures/font/ascii.png is a 16x16 grid of 8x8 glyphs).

export class FontRenderer {
  private atlas: HTMLImageElement | null = null;
  private glyphWidths = new Uint8Array(256).fill(6);

  async load(base = '/mc'): Promise<void> {
    const img = new Image();
    img.src = `${base}/textures/font/ascii.png`;
    await img.decode();
    this.atlas = img;
    this.measureGlyphs(img);
  }

  /** Vanilla DefaultFontSet: most glyphs are 6px wide, a few are wider. */
  private measureGlyphs(img: HTMLImageElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    for (let c = 32; c < 127; c++) {
      const cx = (c & 15) * 8;
      const cy = (c >> 4) * 8;
      let maxX = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const a = data[((cy + y) * img.width + cx + x) * 4 + 3];
          if (a > 0) maxX = Math.max(maxX, x);
        }
      }
      // BitmapProvider: advance = actual ink width (maxX + 1) + 1px spacing.
      this.glyphWidths[c] = maxX + 2;
    }
    // the vanilla space is 4px
    this.glyphWidths[32] = 4;
  }

  charWidth(ch: string): number {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return 8;
    return this.glyphWidths[c];
  }

  width(text: string): number {
    let w = 0;
    for (const ch of text) w += this.charWidth(ch);
    return w;
  }

  /**
   * Draws text with a drop shadow, vanilla style.
   * `x`,`y` are the top left corner in GUI pixels; the glyph cell is 8x8.
   */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadow = true, alpha = 1): number {
    if (!this.atlas) return 0;
    let cx = x;
    if (shadow) {
      ctx.globalAlpha = alpha * 0.25;
      this.drawRaw(ctx, text, cx + 1, y + 1, '#000000');
      ctx.globalAlpha = alpha;
    }
    this.drawRaw(ctx, text, cx, y, color);
    return cx - x;
  }

  private drawRaw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    if (!this.atlas) return;
    // tint the glyph atlas by drawing it into an offscreen mask once per colour
    const mask = this.maskFor(color);
    let cx = x;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code === 32) { cx += this.glyphWidths[32]; continue; }
      if (code < 32) continue;
      if (code > 126) {
        // No unifont page is shipped; fall back to the browser font so CJK/Cyrillic language
        // names and chat are not blank. Keep the cell width aligned with charWidth().
        ctx.save();
        ctx.font = '8px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillStyle = color;
        ctx.fillText(ch, cx, y);
        ctx.restore();
        cx += 8;
        continue;
      }
      const sx = (code & 15) * 8;
      const sy = (code >> 4) * 8;
      ctx.drawImage(mask, sx, sy, 8, 8, cx, y, 8, 8);
      cx += this.glyphWidths[code];
    }
  }

  private maskCache = new Map<string, HTMLCanvasElement>();

  private maskFor(color: string): HTMLCanvasElement {
    const cached = this.maskCache.get(color);
    if (cached) return cached;
    const img = this.atlas!;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.maskCache.set(color, canvas);
    return canvas;
  }

  /**
   * Draws a component-aware string: § codes are interpreted like vanilla.
   * Returns the advance width.
   */
  drawFormatted(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, baseColor: string, shadow = true): number {
    let color = baseColor;
    let cx = x;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\u00a7' && i + 1 < text.length) {
        const code = text[i + 1].toLowerCase();
        const table: Record<string, string> = {
          '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000',
          '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff',
          a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
        };
        if (table[code]) color = table[code];
        i += 2;
        continue;
      }
      // charWidth() already contains the 1px inter-glyph spacing (vanilla
      // BitmapProvider advance = ink width + 1); adding another +1 here made
      // every label wider than what width()/centering assumed.
      const w = this.charWidth(ch);
      this.draw(ctx, ch, cx, y, color, shadow);
      cx += w;
      i++;
    }
    return cx - x;
  }
}
