// Port of net.minecraft.client.gui.components.SplashRenderer (26.2).
// Source: SplashRenderer.java (splash from splashes.txt, x = width / 2 + 90,
// y = height / 4 + 48 - 6, rotated -8 degrees, pulsing scale 1.8, colour
// 0xFFFF00 with drop shadow, hidden when hideSplashTexts is enabled).

import type { GuiGraphics } from '../GuiGraphics.js';

const SPLASH_ANGLE = -8 * (Math.PI / 180);
const SPLASH_BASE_SCALE = 1.8;
const SPLASH_COLOR = 0xffffff00;

export class SplashRenderer {
  private splash = '';
  private time = 0;

  async load(base = '/mc'): Promise<void> {
    try {
      const res = await fetch(`${base}/splashes.txt`);
      if (!res.ok) return;
      const text = await res.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length) this.splash = lines[Math.floor(Math.random() * lines.length)];
    } catch {
      // Keep the empty splash; the title screen simply hides it.
    }
  }

  tick(deltaMs: number): void { this.time += deltaMs; }

  get text(): string { return this.splash; }

  render(g: GuiGraphics, x: number, y: number, alpha = 1): void {
    if (!this.splash) return;
    // Mth.sin(timer * 0.1F) * 0.1F pulse around the 1.8 base scale.
    const scale = SPLASH_BASE_SCALE * (1 + Math.sin(this.time * 0.0004) * 0.1);
    const ctx = g.ctx;
    const a = g.getAlpha();
    ctx.save();
    ctx.globalAlpha = a * alpha;
    ctx.translate(x, y);
    ctx.rotate(SPLASH_ANGLE);
    ctx.scale(scale, scale);
    // FontRenderer draws from a top-left corner; offset back into GUI space.
    const w = g.textWidth(this.splash);
    g.ctx.globalAlpha = a * alpha;
    g.drawString(this.splash, -Math.floor(w / 2), -4, SPLASH_COLOR, true);
    ctx.restore();
    g.setAlpha(a);
  }
}
