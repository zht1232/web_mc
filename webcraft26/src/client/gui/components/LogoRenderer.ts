// Port of net.minecraft.client.gui.components.LogoRenderer (26.2).
// Source: LogoRenderer.java (MINECRAFT_LOGO, EASTER_EGG_LOGO, MINECRAFT_EDITION,
// LOGO_WIDTH 256, LOGO_HEIGHT 44, DEFAULT_HEIGHT_OFFSET 30, EDITION_WIDTH 128,
// EDITION_HEIGHT 14, EDITION_LOGO_OVERLAP 7, extractRenderState).
//
// The shipped minecraft.png is a 4x sheet (1024x256) whose logical sheet is
// 256x64, so blitScaled() multiplies source rects by 4.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { GuiTextures } from '../Hud.js';
import {
  LOGO_WIDTH, LOGO_HEIGHT, LOGO_DEFAULT_HEIGHT_OFFSET,
  EDITION_WIDTH, EDITION_HEIGHT, EDITION_LOGO_OVERLAP,
} from '../GuiConstants.js';

const LOGICAL_SHEET_W = 256;
const LOGICAL_SHEET_H = 64;
const EDITION_SHEET_W = 128;
const EDITION_SHEET_H = 16;

export class LogoRenderer {
  private readonly showEasterEgg: boolean;

  constructor(easterEgg = false) {
    // Vanilla picks the "minceraft" logo with a 1/1000 chance.
    this.showEasterEgg = easterEgg || Math.random() < 0.001;
  }

  async load(textures: GuiTextures): Promise<void> {
    await textures.preload([
      'gui/title/minecraft', 'gui/title/minceraft', 'gui/title/edition',
    ]);
  }

  keepLogoThroughFade(): boolean { return false; }

  render(g: GuiGraphics, width: number, alpha = 1, heightOffset = LOGO_DEFAULT_HEIGHT_OFFSET): void {
    const logoX = Math.floor(width / 2) - LOGO_WIDTH / 2;
    const a = g.getAlpha();
    g.setAlpha(a * alpha);

    // graphics.blit(..., MINECRAFT_LOGO, logoX, heightOffset, 0, 0, 256, 44, 256, 64, color)
    const logo = this.showEasterEgg ? 'gui/title/minceraft' : 'gui/title/minecraft';
    g.blitScaled(logo, logoX, heightOffset, LOGO_WIDTH, LOGO_HEIGHT,
      0, 0, LOGO_WIDTH, LOGO_HEIGHT, LOGICAL_SHEET_W, LOGICAL_SHEET_H);

    // graphics.blit(..., MINECRAFT_EDITION, width/2 - 64, heightOffset + 44 - 7, 0, 0, 128, 14, 128, 16)
    const editionX = Math.floor(width / 2) - EDITION_WIDTH / 2;
    const editionY = heightOffset + LOGO_HEIGHT - EDITION_LOGO_OVERLAP;
    g.blitScaled('gui/title/edition', editionX, editionY, EDITION_WIDTH, EDITION_HEIGHT,
      0, 0, EDITION_WIDTH, EDITION_HEIGHT, EDITION_SHEET_W, EDITION_SHEET_H);

    g.setAlpha(a);
  }
}
