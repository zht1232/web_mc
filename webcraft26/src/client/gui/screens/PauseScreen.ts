// Port of net.minecraft.client.gui.screens.PauseScreen (26.2).
// Sources: PauseScreen.java (COLUMNS 2, MENU_PADDING_TOP 50, BUTTON_PADDING 4,
// BUTTON_WIDTH_FULL 204, BUTTON_WIDTH_HALF 98, createPauseMenu grid,
// title StringWidget at y=40).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import {
  PAUSE_BUTTON_WIDTH_FULL,
  PAUSE_BUTTON_WIDTH_HALF,
  PAUSE_BUTTON_PADDING,
  PAUSE_MENU_PADDING_TOP,
  BUTTON_DEFAULT_HEIGHT,
} from '../GuiConstants.js';

export class PauseScreen extends Screen {
  private readonly showPauseMenu: boolean;

  constructor(env: ConstructorParameters<typeof Screen>[0], showPauseMenu = true) {
    super(env, showPauseMenu ? 'menu.game' : 'menu.paused');
    this.showPauseMenu = showPauseMenu;
  }

  protected build(): void {
    if (!this.showPauseMenu) return;
    const cx = Math.floor(this.width / 2);
    const left = cx - Math.floor(PAUSE_BUTTON_WIDTH_FULL / 2);
    const halfW = PAUSE_BUTTON_WIDTH_HALF;
    const gap = PAUSE_BUTTON_PADDING * 2;
    let y = PAUSE_MENU_PADDING_TOP;

    this.addRenderableWidget(new Button(left, y, PAUSE_BUTTON_WIDTH_FULL, BUTTON_DEFAULT_HEIGHT,
      this.t('menu.returnToGame'), () => this.close()));
    y += BUTTON_DEFAULT_HEIGHT + PAUSE_BUTTON_PADDING * 2 + 16;

    const addHalf = (label: string, action: () => void, col: number): void => {
      this.addRenderableWidget(new Button(left + col * (halfW + gap), y, halfW, BUTTON_DEFAULT_HEIGHT, label, action));
    };

    addHalf(this.t('menu.advancements'), () => this.toast('Advancements'), 0);
    addHalf(this.t('menu.stats'), () => this.toast('Statistics'), 1);
    y += BUTTON_DEFAULT_HEIGHT + PAUSE_BUTTON_PADDING;

    addHalf(this.t('menu.options'), () => this.open('options'), 0);
    addHalf(this.t('menu.shareToLan'), () => this.toast('Open to LAN'), 1);
    y += BUTTON_DEFAULT_HEIGHT + PAUSE_BUTTON_PADDING;

    addHalf(this.t('menu.playerReporting'), () => this.toast('Player Reporting'), 0);
    addHalf(this.t('menu.multiplayerOptions.button'), () => this.toast('Multiplayer Options'), 1);
    y += BUTTON_DEFAULT_HEIGHT + PAUSE_BUTTON_PADDING * 2;

    this.addRenderableWidget(new Button(left, y, PAUSE_BUTTON_WIDTH_FULL, BUTTON_DEFAULT_HEIGHT,
      this.t('menu.disconnect'), () => this.env.deps.callbacks.onQuit?.()));
  }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), this.showPauseMenu ? 40 : 10, 0xffffffff, true);
  }
}
