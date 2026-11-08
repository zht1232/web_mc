// Port of net.minecraft.client.gui.screens.options.OptionsScreen (26.2).
// Sources: OptionsScreen.java (init: header with FOV button + online button at
// this.width / 2 + 5, this.height / 6 - 12 + 24, 150, 20;
// GridLayout 2 columns, paddingHorizontal(4), paddingBottom(4);
// footer Done button width 200; onClose -> lastScreen; removed -> options.save()).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import { Slider } from '../components/Slider.js';
import { OPTIONS_BUTTON_KEYS, OPTIONS_BUTTON_WIDTH, OPTIONS_BUTTON_HEIGHT, OPTIONS_GRID_PADDING } from './options/OptionsSubScreen.js';
import { BUTTON_BIG_WIDTH, BUTTON_DEFAULT_HEIGHT } from '../GuiConstants.js';
import { setOption, getOptionNumber } from '../OptionsBridge.js';

const GRID_COLUMNS = 2;

export class OptionsScreen extends Screen {
  private readonly inWorldMenu: boolean;

  constructor(env: ConstructorParameters<typeof Screen>[0], inWorld = false) {
    super(env, 'options.title');
    this.inWorldMenu = inWorld;
  }

  private gridX(): number {
    const cell = OPTIONS_BUTTON_WIDTH + OPTIONS_GRID_PADDING * 2;
    return Math.floor(this.width / 2) - Math.floor((cell * GRID_COLUMNS) / 2) + OPTIONS_GRID_PADDING;
  }

  protected build(): void {
    const cx = Math.floor(this.width / 2);
    const deps = this.env.deps;

    // HeaderAndFooterLayout(61, 33): title 12, then a 20px sub-header row at y=29 with 8px spacing.
    const subY = 29;
    const fov = getOptionNumber(deps, 'fov', 70);
    this.addRenderableWidget(new Slider(cx - 155, subY, 150, BUTTON_DEFAULT_HEIGHT,
      this.t('options.fov'), (fov - 30) / 80,
      (_name, v) => `${this.t('options.fov')}: ${Math.round(30 + v * 80)}`,
      (v) => setOption(deps, 'fov', Math.round(30 + v * 80))));
    this.addRenderableWidget(new Button(cx + 5, subY, 150, BUTTON_DEFAULT_HEIGHT,
      this.t(this.inWorldMenu ? 'selectWorld.gameRules' : 'options.online'),
      () => this.toast(this.t('options.online'))));

    // 2-column grid of the standard option sub-screens.
    const targets: Record<string, string | null> = {
      'options.skinCustomisation': null,
      'options.sounds': 'sound',
      'options.video': 'video',
      'options.controls': 'controls',
      'options.language': 'language',
      'options.chat': 'chat',
      'options.resourcepack': null,
      'options.accessibility': null,
      'options.telemetry': null,
      'options.credits_and_attribution': null,
    };
    const rows = Math.ceil(OPTIONS_BUTTON_KEYS.length / GRID_COLUMNS);
    const gridHeight = rows * (OPTIONS_BUTTON_HEIGHT + OPTIONS_GRID_PADDING * 2);
    // HeaderAndFooterLayout.arrangeElements: header 61 + 30, clamped above the footer.
    const startY = Math.max(0, Math.min(61 + 30, this.height - 33 - gridHeight));
    for (let i = 0; i < OPTIONS_BUTTON_KEYS.length; i++) {
      const key = OPTIONS_BUTTON_KEYS[i];
      const col = i % GRID_COLUMNS;
      const row = Math.floor(i / GRID_COLUMNS);
      const x = this.gridX() + col * (OPTIONS_BUTTON_WIDTH + OPTIONS_GRID_PADDING * 2);
      const y = startY + row * (OPTIONS_BUTTON_HEIGHT + OPTIONS_GRID_PADDING * 2);
      const target = targets[key];
      this.addRenderableWidget(new Button(x, y, OPTIONS_BUTTON_WIDTH, OPTIONS_BUTTON_HEIGHT,
        this.t(key), () => target ? this.open(target) : this.toast(this.t(key))));
    }

    this.addRenderableWidget(new Button(cx - BUTTON_BIG_WIDTH / 2, this.height - 27,
      BUTTON_BIG_WIDTH, BUTTON_DEFAULT_HEIGHT, this.t('gui.done'), () => this.goBack()));
  }

  private goBack(): void { this.env.back(); }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 12, 0xffffffff, true);
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'Escape') { this.goBack(); return true; }
    return super.keyPressed(code, char, mods);
  }

  onClose(): void {
    this.env.deps.callbacks.onOptionChange?.('save', true);
  }
}
