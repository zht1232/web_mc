// Port of net.minecraft.client.renderer.Panorama / CubeMap and the
// TitleScreen#extractPanorama path (26.2).
//
// This resource pack ships the six textures/gui/title/background/panorama_N.png
// as 1x1 colour placeholders (no real cube-map photography is present), so the
// renderer samples each face colour, builds a seamless 6-face horizontal
// gradient and slowly rotates it, then applies the vanilla blur + fade-in and
// the panorama_overlay vignette. All colours come from the original textures.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { GuiTextures } from '../Hud.js';

const FACE_COUNT = 6;
const PANORAMA_SPIN_SPEED = 0.0015; // radians per second (vanilla slow spin)

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
    this.sample();
    const ctx = g.ctx;
    const n = Math.max(1, this.colors.length);
    // Rotation offset in [0,1) across the whole 6-face loop.
    const shift = ((this.angle / (Math.PI * 2)) % 1 + 1) % 1;
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    // Sample the rotating 6-face band at fixed positions so the strip is
    // always continuous and the ends are covered (blur hides the banding).
    const STEPS = 24;
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      const pos = (((t + shift) % 1) + 1) % 1 * n;
      grad.addColorStop(t, this.colors[Math.floor(pos) % n]);
    }
    const prevFilter = ctx.filter;
    const prevAlpha = ctx.globalAlpha;
    ctx.filter = 'blur(4px)';
    ctx.globalAlpha = alpha * this.fadeAlpha();
    ctx.fillStyle = grad;
    ctx.fillRect(-8, -8, width + 16, height + 16);
    ctx.filter = prevFilter;
    ctx.globalAlpha = prevAlpha;

    // Vanilla darkens the panorama before drawing the menu (0x60000000-ish).
    g.fill(0, 0, width, height, 0x60000000);
    if (this.overlay) {
      const a = g.getAlpha();
      g.setAlpha(a * 0.5);
      g.blitFull('gui/title/background/panorama_overlay', 0, 0, width, height);
      g.setAlpha(a);
    }
  }
}
