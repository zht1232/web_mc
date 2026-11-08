// Port of net.minecraft.client.gui.screens.options.OptionsSubScreen (26.2).
// Sources: OptionsSubScreen.java (lastScreen, options, title, layout with a
// 200x20 Done button in the footer), OptionsScreen.java (2-column grid,
// paddingHorizontal(4), paddingBottom(4)).

import type { GuiGraphics } from '../../GuiGraphics.js';
import { Screen } from '../Screen.js';
import { Button } from '../../components/Button.js';
import { Slider } from '../../components/Slider.js';
import { CycleButton } from '../../components/CycleButton.js';
import { Checkbox } from '../../components/Checkbox.js';
import { BUTTON_BIG_WIDTH, BUTTON_DEFAULT_HEIGHT, BUTTON_DEFAULT_SPACING } from '../../GuiConstants.js';

export const OPTIONS_GRID_COLUMNS = 2;
export const OPTIONS_BUTTON_WIDTH = 150;
export const OPTIONS_BUTTON_HEIGHT = 20;
export const OPTIONS_GRID_PADDING = 4;
export const OPTIONS_DONE_Y_FROM_BOTTOM = 27;

export abstract class OptionsSubScreen extends Screen {
  /** X of a two-column grid whose cells are 150 wide with 4px padding. */
  protected gridX(): number {
    const cell = OPTIONS_BUTTON_WIDTH + OPTIONS_GRID_PADDING * 2;
    return Math.floor(this.width / 2) - Math.floor((cell * OPTIONS_GRID_COLUMNS) / 2) + OPTIONS_GRID_PADDING;
  }

  protected gridColX(col: number): number {
    return this.gridX() + col * (OPTIONS_BUTTON_WIDTH + OPTIONS_GRID_PADDING * 2);
  }

  protected gridRowY(row: number): number {
    return 32 + row * (OPTIONS_BUTTON_HEIGHT + OPTIONS_GRID_PADDING * 2);
  }

  protected build(): void {
    this.addOptions();
    this.addDoneButton();
  }

  protected abstract addOptions(): void;

  protected addDoneButton(): void {
    this.addRenderableWidget(new Button(
      Math.floor(this.width / 2) - BUTTON_BIG_WIDTH / 2,
      this.height - OPTIONS_DONE_Y_FROM_BOTTOM,
      BUTTON_BIG_WIDTH,
      BUTTON_DEFAULT_HEIGHT,
      this.t('gui.done'),
      () => this.goBack(),
    ));
  }

  /** Standard labelled slider helper (mirrors Option.createButton). */
  protected addSlider(
    x: number, y: number, width: number,
    label: string, value: number,
    format: (v: number) => string,
    onChange: (v: number) => void,
  ): Slider {
    const slider = new Slider(x, y, width, OPTIONS_BUTTON_HEIGHT, label, value,
      (name, v) => `${name}: ${format(v)}`, onChange);
    this.addRenderableWidget(slider);
    return slider;
  }

  protected addCycle<T>(
    x: number, y: number, width: number,
    name: string, values: readonly T[], initial: T,
    toStringValue: (v: T) => string,
    onChange: (v: T) => void,
  ): CycleButton<T> {
    const b = new CycleButton<T>(x, y, width, OPTIONS_BUTTON_HEIGHT, name, values, initial, toStringValue, onChange);
    this.addRenderableWidget(b);
    return b;
  }

  protected addToggle(
    x: number, y: number, label: string, value: boolean,
    onChange: (v: boolean) => void,
  ): Checkbox {
    const cb = new Checkbox(x, y, 150, 20, label, value, onChange);
    this.addRenderableWidget(cb);
    return cb;
  }

  protected addButton(x: number, y: number, width: number, label: string, action: () => void): Button {
    const b = new Button(x, y, width, OPTIONS_BUTTON_HEIGHT, label, action);
    this.addRenderableWidget(b);
    return b;
  }

  protected goBack(): void { this.env.back(); }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 15, 0xffffffff, true);
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'Escape') { this.goBack(); return true; }
    return super.keyPressed(code, char, mods);
  }
}

/** Shared list of button labels used by OptionsScreen for the 2-column grid. */
export const OPTIONS_BUTTON_KEYS = [
  'options.skinCustomisation',
  // Real 26.2 keys (OptionsScreen.java). The old *Title variants were invented and only
  // existed in the English fallback table, so they stayed English under zh_cn.
  'options.sounds',
  'options.video',
  'options.controls',
  'options.language',
  'options.chat',
  'options.resourcepack',
  'options.accessibility',
  'options.telemetry',
  'options.credits_and_attribution',
] as const;

export const OPTIONS_BUTTON_SPACING = BUTTON_DEFAULT_SPACING;
