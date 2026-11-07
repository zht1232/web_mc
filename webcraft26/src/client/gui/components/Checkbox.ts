// Port of net.minecraft.client.gui.components.Checkbox (26.2).
// Source: Checkbox.java (20x20 box, 4 sprite variants, label to the right,
// onValueChange, onClick).

import type { GuiGraphics } from '../GuiGraphics.js';
import { AbstractWidget } from './AbstractWidget.js';

export const CHECKBOX_SIZE = 20;
export const CHECKBOX_LABEL_OFFSET = 24;

export type CheckboxChange = (selected: boolean) => void;

export class Checkbox extends AbstractWidget {
  constructor(
    x: number, y: number, width: number, height: number,
    message: string,
    public selected: boolean,
    private readonly onValueChange: CheckboxChange,
  ) {
    super(x, y, width, height, message);
  }

  static of(x: number, y: number, message: string, selected: boolean, onChange: CheckboxChange): Checkbox {
    return new Checkbox(x, y, CHECKBOX_SIZE + Math.max(0, message.length * 6), CHECKBOX_SIZE, message, selected, onChange);
  }

  setSelected(value: boolean, notify = true): void {
    this.selected = value;
    if (notify) this.onValueChange(value);
  }

  protected renderWidget(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const hot = this.isHovered() || this.focused;
    const sprite = this.selected
      ? (hot ? 'widget/checkbox_selected_highlighted' : 'widget/checkbox_selected')
      : (hot ? 'widget/checkbox_highlighted' : 'widget/checkbox');
    g.blitSprite(sprite, this.x, this.y, CHECKBOX_SIZE, CHECKBOX_SIZE);
    if (this.message) {
      g.drawString(this.message, this.x + CHECKBOX_LABEL_OFFSET,
        this.y + Math.floor((CHECKBOX_SIZE - 8) / 2), this.active ? 0xffffffff : 0xffa0a0a0, true);
    }
  }

  protected onClick(_mx: number, _my: number, _button: number): void {
    this.selected = !this.selected;
    this.onValueChange(this.selected);
  }

  keyPressed(code: string, _char: string, _mods: number): boolean {
    if (this.focused && (code === 'Space' || code === 'Enter')) {
      this.onClick(this.x, this.y, 0);
      return true;
    }
    return false;
  }
}
