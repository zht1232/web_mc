// Port of net.minecraft.client.renderer.Panorama / CubeMap (26.2).
//
// Vanilla renders the six 1024x1024 faces as a rotating cube map, so neighbouring faces are
// continuous by construction. Two problems with the previous flat-screen approximation here:
//   * it drew 4-6 independently cover-fitted 1024x1024 images EVERY frame (the title-screen
//     stutter), and each face had its own crop, so a hard vertical seam appeared at every
//     quarter of the screen (the "obvious stitching" report);
//   * `Math.round(offset + i * faceW)` plus a 1px overlap left hairline gaps.
//
// This version pre-composites the four side faces ONCE into an offscreen strip, with a
// per-column linear cross-fade at each face boundary, then performs a single drawImage per
// frame. The strip is 1.5x the screen width so the slow pan never exposes an edge.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { GuiTextures } from '../Hud.js';

const FACE_COUNT = 6;
const SIDE_FACES = 4;
const PANORAMA_SPIN_SPEED = 0.035; // rad/s (~2 deg/s, vanilla Panorama#tick)
/** Half-width of the cross-fade used to hide the discontinuity between two cube faces. */
const BLEND = 40;

export class PanoramaRenderer {
  private faces: HTMLImageElement[] = [];
  private overlay?: HTMLImageElement;
  private angle = 0;
  private elapsed = 0;
  private fadingStart = 0;
  private fading = false;

  /** Pre-composited side-face strip. Rebuilt only when the viewport size changes. */
  private strip: HTMLCanvasElement | null = null;
  private stripW = 0;
  private stripH = 0;
  private stripFaceW = 0;

  async load(textures: GuiTextures): Promise<void> {
    const paths: string[] = [];
    for (let i = 0; i < FACE_COUNT; i++) paths.push(`gui/title/background/panorama_${i}`);
    paths.push('gui/title/background/panorama_overlay');
    await textures.preload(paths);
    this.faces = paths.slice(0, FACE_COUNT).map((p) => textures.get(p)).filter((x): x is HTMLImageElement => !!x);
    this.overlay = textures.get(paths[FACE_COUNT]);
    this.strip = null; // force a rebuild with the newly decoded images
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

  /** Fade-in envelope from Screen.FADE_IN_TIME = 2000 ms. */
  fadeAlpha(): number {
    if (!this.fading) return 1;
    const t = (this.elapsed - this.fadingStart) / 2000;
    if (t >= 1) { this.fading = false; return 1; }
    return Math.max(0, Math.min(1, t));
  }

  /**
   * Bake the four side faces into one strip at the target resolution, then blend a band of
   * `2*BLEND` columns around every seam. On the left of a seam the next face fades in; on the
   * right the previous face fades out. Doing it in ImageData avoids drawImage clip/scale
   * ambiguity and runs once per resize instead of once per frame.
   */
  private buildStrip(height: number, faceW: number): HTMLCanvasElement | null {
    const sides = this.faces.slice(0, SIDE_FACES);
    if (sides.length < SIDE_FACES) return null;
    const w = Math.max(1, Math.ceil(faceW * SIDE_FACES));
    const h = Math.max(1, Math.ceil(height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;

    const scale = h / sides[0].height;
    for (let i = 0; i < SIDE_FACES; i++) {
      const img = sides[i];
      // Keep the FULL horizontal extent (no centre crop) so the cube faces stay continuous.
      ctx.drawImage(img, 0, 0, img.width, img.height, i * faceW, 0, img.width * scale, h);
    }

    const fade = Math.min(BLEND, Math.floor(faceW / 2), Math.floor(1024 * scale / 2));
    if (fade > 0) {
      const data = ctx.getImageData(0, 0, w, h);
      const px = data.data;
      for (let i = 0; i < SIDE_FACES - 1; i++) {
        const seam = (i + 1) * faceW;
        for (let k = 0; k < fade; k++) {
          const t = (k + 1) / (fade + 1);
          // Left of the seam: mix in the first `fade` columns of the NEXT face.
          const nextSrcX = (i + 1) * faceW + k;
          const leftDstX = seam - fade + k;
          // Right of the seam: mix in the last `fade` columns of the PREVIOUS face.
          const prevSrcX = (i + 1) * faceW - fade + k;
          const rightDstX = seam + k;
          for (let y = 0; y < h; y++) {
            mixPixel(px, y * w + leftDstX, y * w + nextSrcX, t);
            mixPixel(px, y * w + rightDstX, y * w + prevSrcX, 1 - t);
          }
        }
      }
      ctx.putImageData(data, 0, 0);
    }

    this.stripW = w;
    this.stripH = h;
    this.stripFaceW = faceW;
    return canvas;
  }

  render(g: GuiGraphics, width: number, height: number, alpha = 1): void {
    const ctx = g.ctx;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevFilter = ctx.filter;
    ctx.filter = 'none';
    const fade = this.fadeAlpha();

    const faceW = Math.max(1, Math.ceil((width * 1.5) / SIDE_FACES));
    if (!this.strip || this.stripH !== Math.ceil(height) || this.stripFaceW !== faceW) {
      this.strip = this.buildStrip(height, faceW);
    }

    if (this.strip) {
      ctx.imageSmoothingEnabled = false; // strip is already at target resolution
      ctx.globalAlpha = alpha * fade;
      const stripW = this.stripW;
      const shift = (((this.angle / (Math.PI / 2)) % 1) + 1) % 1;
      const pan = shift * this.stripFaceW;
      // start far enough left that the first tile covers the viewport, then wrap
      let offset = -((pan + (stripW - width) / 2) % stripW);
      if (offset > 0) offset -= stripW;
      for (let x = offset; x < width; x += stripW) {
        ctx.drawImage(this.strip, Math.round(x), 0, stripW, height);
      }
    } else {
      ctx.globalAlpha = alpha * fade;
      ctx.fillStyle = '#3a5a7a';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = prevAlpha;
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.filter = prevFilter;

    // Vanilla darkens the panorama under the menu (GuiGraphics#drawTitleBackground).
    g.fill(0, 0, width, height, 0x2a000000);
    if (this.overlay && this.overlay.width > 8) {
      const a = g.getAlpha();
      g.setAlpha(a * 0.5);
      g.blitFull('gui/title/background/panorama_overlay', 0, 0, width, height);
      g.setAlpha(a);
    }
  }
}

/** Linear blend of pixel `src` into pixel `dst` with weight `t` (0..1). */
function mixPixel(px: Uint8ClampedArray, dst: number, src: number, t: number): void {
  const d = dst * 4, s = src * 4;
  px[d] = px[d] * (1 - t) + px[s] * t;
  px[d + 1] = px[d + 1] * (1 - t) + px[s + 1] * t;
  px[d + 2] = px[d + 2] * (1 - t) + px[s + 2] * t;
  px[d + 3] = 255;
}
