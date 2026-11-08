// Port of net.minecraft.client.renderer.Panorama / CubeMap and the
// TitleScreen#extractPanorama path (26.2).
//
// The six faces are real 1024x1024 panorama photos in this pack. Rendering them as a blurred
// colour gradient (the old behaviour) made the title background look empty and the moving
// gradient stops shimmered; instead the four side faces are drawn as a slowly panning strip,
// which is the flat-screen equivalent of vanilla's rotating cube map.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { GuiTextures } from '../Hud.js';

const FACE_COUNT = 6;
/** The four horizontal faces; 4/5 are top/bottom and only matter with a real cube map. */
const SIDE_FACES = 4;
const PANORAMA_SPIN_SPEED = 0.035; // rad/s (~2 deg/s, vanilla Panorama#tick)

export class PanoramaRenderer {
  private faces: HTMLImageElement[] = [];
  private overlay?: HTMLImageElement;
  private colors: string[] = [];
  private angle = 0;
  private elapsed = 0;
  private fadingStart = 0;
  private fading = false;
  private sampled = false;

  async load(textures: GuiTextures): Promise<void> {
    const paths: string[] = [];
    for (let i = 0; i < FACE_COUNT; i++) paths.push(`gui/title/background/panorama_${i}`);
    paths.push('gui/title/background/panorama_overlay');
    await textures.preload(paths);
    this.faces = paths.slice(0, FACE_COUNT).map((p) => textures.get(p)).filter((x): x is HTMLImageElement => !!x);
    this.overlay = textures.get(paths[FACE_COUNT]);
  }

  /** TitleScreen calls panorama.startSpin() on construction. */
  startSpin(): void {
    this.fading = true;
    this.fadingStart = this.elapsed;
  }

  tick(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.angle += (deltaMs / 1000) * PANORAMA_SPIN_SPEED;
  }

  private sample(): void {
    if (this.sampled) return;
    // The six faces load asynchronously; before they are decoded the gradient must still be valid
    // (an undefined colour makes createLinearGradient throw, which used to kill the frame loop).
    if (this.faces.length === 0) {
      this.colors = ['#4a6b8a', '#5a7c9a', '#6d8eaa', '#5a7c9a', '#3a5a7a', '#2a3a5a'];
      return; // not sampled yet: try the real face colours again next frame
    }
    this.sampled = true;
    this.colors = [];
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    for (const img of this.faces) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(img, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      this.colors.push(`rgb(${d[0]}, ${d[1]}, ${d[2]})`);
    }
    if (this.colors.length === 0) this.colors = ['#4a6b8a', '#5a7c9a', '#6d8eaa', '#5a7c9a', '#3a5a7a', '#2a3a5a'];
    // Guarantee a seamless loop by repeating the first colour at the end.
    while (this.colors.length < FACE_COUNT) this.colors.push('#3a5a7a');
  }

  /** Fade-in envelope from Screen.FADE_IN_TIME = 2000 ms. */
  fadeAlpha(): number {
    if (!this.fading) return 1;
    const t = (this.elapsed - this.fadingStart) / 2000;
    if (t >= 1) { this.fading = false; return 1; }
    return Math.max(0, Math.min(1, t));
  }

  render(g: GuiGraphics, width: number, height: number, alpha = 1): void {
    const ctx = g.ctx;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevFilter = ctx.filter;
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    const fade = this.fadeAlpha();

    const sides = this.faces.slice(0, SIDE_FACES);
    if (sides.length === 0) {
      // Assets not decoded yet: a flat sky colour beats a black screen.
      this.sample();
      ctx.globalAlpha = alpha * fade;
      ctx.fillStyle = '#3a5a7a';
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = prevAlpha;
      ctx.imageSmoothingEnabled = prevSmoothing;
      return;
    }

    // One face per 90 degrees of yaw; the strip is 50% wider than the screen so panning
    // never exposes an edge.
    const stripW = width * 1.5;
    const faceW = stripW / sides.length;
    const shift = ((this.angle / (Math.PI / 2)) % 1 + 1) % 1;
    const offset = -shift * faceW + (width - stripW) / 2;

    ctx.globalAlpha = alpha * fade;
    for (let i = -1; i <= sides.length; i++) {
      const img = sides[((i % sides.length) + sides.length) % sides.length];
      const dx = Math.round(offset + i * faceW);
      if (dx > width || dx + faceW < 0) continue;
      // Cover-fit the square face into the slice, keeping the horizon near the middle.
      const scale = Math.max((faceW + 1) / img.width, height / img.height);
      const sw = Math.min(img.width, (faceW + 1) / scale);
      const sh = Math.min(img.height, height / scale);
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) * 0.42;
      ctx.drawImage(img, sx, sy, sw, sh, dx, 0, faceW + 1, height);
    }
    ctx.globalAlpha = prevAlpha;
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.filter = prevFilter;

    // Vanilla darkens the panorama under the menu (GuiGraphics#drawTitleBackground).
    // Light shading only: the panorama photos are already menu-friendly and the old 31% black
    // overlay made the background read as empty.
    g.fill(0, 0, width, height, 0x2a000000);
    if (this.overlay && this.overlay.width > 8) {
      const a = g.getAlpha();
      g.setAlpha(a * 0.5);
      g.blitFull('gui/title/background/panorama_overlay', 0, 0, width, height);
      g.setAlpha(a);
    }
  }
}
