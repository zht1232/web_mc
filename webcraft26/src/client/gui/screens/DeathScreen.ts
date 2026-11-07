// Port of net.minecraft.client.gui.screens.DeathScreen (26.2).
// Sources: DeathScreen.java (init: respawn button at
// this.width / 2 - 100, this.height / 4 + 72, 200, 20;
// titleScreen button at this.height / 4 + 96; shouldCloseOnEsc false;
// extractDeathBackground: fillGradient(0,0,w,h, 1615855616, -1602211792);
// visitText: title 2x scale at y=30, cause at y=85, score at y=100).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import {
  DEATH_BG_TOP,
  DEATH_BG_BOTTOM,
  DEATH_BUTTON_Y,
  DEATH_TITLE_BUTTON_Y,
  BUTTON_BIG_WIDTH,
  BUTTON_DEFAULT_HEIGHT,
} from '../GuiConstants.js';

export class DeathScreen extends Screen {
  private cause = '';
  private score = '';

  constructor(env: ConstructorParameters<typeof Screen>[0], cause = '', score = '') {
    super(env, 'deathScreen.title');
    this.cause = cause;
    this.score = score;
    this.setCloseOnEsc(false);
  }

  protected build(): void {
    const x = Math.floor(this.width / 2) - 100;
    const base = Math.floor(this.height / 4);
    this.addRenderableWidget(new Button(x, base + DEATH_BUTTON_Y, BUTTON_BIG_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('deathScreen.respawn'), () => {
        this.env.deps.callbacks.onRespawn?.();
        this.close();
      }));
    this.addRenderableWidget(new Button(x, base + DEATH_TITLE_BUTTON_Y, BUTTON_BIG_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('deathScreen.titleScreen'), () => this.open('title')));
  }

  protected renderBackground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.fillGradient(0, 0, this.width, this.height, DEATH_BG_TOP, DEATH_BG_BOTTOM);
  }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const cx = Math.floor(this.width / 2);
    // Vanilla draws the title at 2x scale. FontRenderer has no scale flag, so
    // we render it through a canvas transform (still using the vanilla glyphs).
    const ctx = g.ctx;
    ctx.save();
    ctx.translate(cx / 2, 30);
    ctx.scale(2, 2);
    g.drawCenteredString(this.title, 0, 0, 0xffff0000, true);
    ctx.restore();
    if (this.cause) g.drawCenteredString(this.cause, cx, 85, 0xffffffff, true);
    g.drawCenteredString(`${this.t('deathScreen.score')}: ${this.score || '0'}`, cx, 100, 0xffffffff, true);
  }
}
