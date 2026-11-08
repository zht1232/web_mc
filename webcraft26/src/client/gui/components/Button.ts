// Port of net.minecraft.client.gui.components.Button / AbstractButton /
// WidgetSprites (26.2).
// Sources: Button.java (SMALL_WIDTH 120, DEFAULT_WIDTH 150, BIG_WIDTH 200,
// DEFAULT_HEIGHT 20, DEFAULT_SPACING 8, Builder), AbstractButton.java
// (extractDefaultSprite / extractDefaultLabel), WidgetSprites.java.
//
// Default button is 150x20 via Builder; TitleScreen & DeathScreen use
// .bounds(..., 200, 20) (see GuiConstants / layout/TitleLayout.ts).

import type { GuiGraphics } from '../GuiGraphics.js';
import type { Rect } from '../Types.js';
import type { Tooltip } from './Tooltip.js';
import { AbstractWidget } from './AbstractWidget.js';
import {
  BUTTON_DEFAULT_WIDTH,
  BUTTON_DEFAULT_HEIGHT,
  BUTTON_BIG_WIDTH,
  BUTTON_SMALL_WIDTH,
  BUTTON_DEFAULT_SPACING,
} from '../GuiConstants.js';

export { BUTTON_DEFAULT_WIDTH, BUTTON_DEFAULT_HEIGHT, BUTTON_BIG_WIDTH, BUTTON_SMALL_WIDTH, BUTTON_DEFAULT_SPACING };

/** net.minecraft.client.gui.components.WidgetSprites */
export interface WidgetSprites {
  enabled: string;
  disabled: string;
  highlighted: string;
}

export const BUTTON_SPRITES: WidgetSprites = {
  enabled: 'widget/button',
  disabled: 'widget/button_disabled',
  highlighted: 'widget/button_highlighted',
};

export type OnPress = (button: Button) => void;

export class Button extends AbstractWidget {
  /** Optional 16x16 sprite (gui/sprites path) drawn centred instead of the label. */
  icon: string | null = null;

  setIcon(path: string): this {
    this.icon = path;
    return this;
  }

  constructor(
    x: number, y: number, width: number, height: number,
    message: string,
    public onPress: OnPress,
    public sprites: WidgetSprites = BUTTON_SPRITES,
  ) {
    super(x, y, width, height, message);
  }

  /** Button.builder(Component, OnPress) */
  static builder(message: string, onPress: OnPress): ButtonBuilder {
    return new ButtonBuilder(message, onPress);
  }

  /** Convenience constructor matching the vanilla 200x20 TitleScreen buttons. */
  static big(x: number, y: number, message: string, onPress: OnPress): Button {
    return new Button(x, y, BUTTON_BIG_WIDTH, BUTTON_DEFAULT_HEIGHT, message, onPress);
  }

  protected renderWidget(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const sprite = !this.active
      ? this.sprites.disabled
      : (this.isHovered() || this.focused) ? this.sprites.highlighted : this.sprites.enabled;
    g.blitSprite(sprite, this.x, this.y, this.width, this.height);

    if (this.icon && g.sprites.get(this.icon)) {
      g.blitSprite(this.icon, this.x + Math.floor((this.width - 16) / 2), this.y + Math.floor((this.height - 16) / 2), 16, 16);
      return;
    }
    // AbstractButton#extractDefaultLabel: 0xE0E0E0 normally, 0xA0A0A0 disabled,
    // 0xFFFFA0 highlighted, always with the vanilla drop shadow.
    const color = !this.active ? 0xffa0a0a0 : (this.isHovered() || this.focused) ? 0xffffffa0 : 0xffe0e0e0;
    const tw = g.textWidth(this.message);
    const tx = this.x + Math.floor((this.width - tw) / 2);
    const ty = this.y + Math.floor((this.height - 8) / 2);
    g.drawString(this.message, tx, ty, color, true);
  }

  protected onClick(_mx: number, _my: number, _button: number): void {
    this.onPress(this);
  }

  /** Hit-test helper (pure geometry) exposed for the Node test suite. */
  hitTest(mx: number, my: number): boolean { return this.isMouseOver(mx, my); }

  getRect(): Rect { return super.getRect(); }
}

export class ButtonBuilder {
  private x = 0;
  private y = 0;
  private _width = BUTTON_DEFAULT_WIDTH;
  private _height = BUTTON_DEFAULT_HEIGHT;
  private _tooltip?: Tooltip;
  private sprites: WidgetSprites = BUTTON_SPRITES;

  constructor(private readonly message: string, private readonly onPress: OnPress) {}

  pos(x: number, y: number): this { this.x = x; this.y = y; return this; }
  width(value: number): this { this._width = value; return this; }
  height(value: number): this { this._height = value; return this; }
  size(width: number, height: number): this { this._width = width; this._height = height; return this; }
  bounds(x: number, y: number, width: number, height: number): this {
    return this.pos(x, y).size(width, height);
  }
  tooltip(tooltip: Tooltip | undefined): this { this._tooltip = tooltip; return this; }
  widgetSprites(sprites: WidgetSprites): this { this.sprites = sprites; return this; }

  build(): Button {
    const b = new Button(this.x, this.y, this._width, this._height, this.message, this.onPress, this.sprites);
    b.setTooltip(this._tooltip);
    return b;
  }
}
