// Port of net.minecraft.client.gui.components.SplashRenderer (26.2).
// Source: SplashRenderer.java (splash from splashes.txt, x = width / 2 + 90,
// y = height / 4 + 48 - 6, rotated -8 degrees, pulsing scale 1.8, colour
// 0xFFFF00 with drop shadow, hidden when hideSplashTexts is enabled).

import type { GuiGraphics } from '../GuiGraphics.js';

const SPLASH_ANGLE = -Math.PI / 9;
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
    const textWidth = g.textWidth(this.splash);
    // SplashRenderer.extractRenderState: 1.8 - |sin(millis%1000 / 1000 * 2pi)| * 0.1,
    // scaled by 100 / (textWidth + 32) so long splashes shrink instead of covering the menu.
    const phase = 1.8 - Math.abs(Math.sin((performance.now() % 1000) / 1000 * Math.PI * 2)) * 0.1;
    const textScale = (phase * 100) / (textWidth + 32);
    const ctx = g.ctx;
    const a = g.getAlpha();
    ctx.save();
    ctx.globalAlpha = a * alpha;
    ctx.translate(x, y);
    ctx.rotate(SPLASH_ANGLE);
    ctx.scale(textScale, textScale);
    g.drawString(this.splash, -Math.floor(textWidth / 2), -8, SPLASH_COLOR, true);
    ctx.restore();
    g.setAlpha(a);
  }
}
