// Port of net.minecraft.client.gui.components.CycleButton (26.2).
// Source: CycleButton.java (values list, current index, valueString supplier,
// onValueChange, create(...) factories, cycles on click).

import type { GuiGraphics } from '../GuiGraphics.js';
import { AbstractWidget } from './AbstractWidget.js';

export class CycleButton<T> extends AbstractWidget {
  private index: number;

  constructor(
    x: number, y: number, width: number, height: number,
    private readonly name: string,
    private readonly values: readonly T[],
    initial: T,
    private readonly toStringValue: (value: T) => string,
    private readonly onValueChange: (value: T) => void,
  ) {
    super(x, y, width, height, '');
    const found = values.indexOf(initial);
    this.index = found >= 0 ? found : 0;
    this.updateMessage();
  }

  static builder<T>(
    name: string,
    values: readonly T[],
    initial: T,
    toStringValue: (value: T) => string,
    onValueChange: (value: T) => void,
  ): (x: number, y: number, width: number, height: number) => CycleButton<T> {
    return (x, y, width, height) => new CycleButton<T>(x, y, width, height, name, values, initial, toStringValue, onValueChange);
  }

  getValue(): T { return this.values[this.index]; }
  getIndex(): number { return this.index; }

  setValue(value: T, notify = true): void {
    const i = this.values.indexOf(value);
    if (i < 0) return;
    this.index = i;
    this.updateMessage();
    if (notify) this.onValueChange(value);
  }

  setIndex(index: number, notify = true): void {
    if (this.values.length === 0) return;
    this.index = ((index % this.values.length) + this.values.length) % this.values.length;
    this.updateMessage();
    if (notify) this.onValueChange(this.getValue());
  }

  private updateMessage(): void {
    const v = this.getValue();
    this.message = this.name ? `${this.name}: ${this.toStringValue(v)}` : this.toStringValue(v);
  }

  protected renderWidget(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const hot = this.isHovered() || this.focused;
    const sprite = !this.active ? 'widget/button_disabled' : hot ? 'widget/button_highlighted' : 'widget/button';
    g.blitSprite(sprite, this.x, this.y, this.width, this.height);
    const tw = g.textWidth(this.message);
    g.drawString(this.message, this.x + Math.floor((this.width - tw) / 2),
      this.y + Math.floor((this.height - 8) / 2), this.active ? 0xffe0e0e0 : 0xffa0a0a0, true);
  }

  protected onClick(_mx: number, _my: number, _button: number): void {
    this.setIndex(this.index + 1);
  }

  keyPressed(code: string, _char: string, _mods: number): boolean {
    if (!this.focused) return false;
    if (code === 'ArrowLeft' || code === 'ArrowUp') { this.setIndex(this.index - 1); return true; }
    if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'Space' || code === 'Enter') {
      this.setIndex(this.index + 1);
      return true;
    }
    return false;
  }
}
