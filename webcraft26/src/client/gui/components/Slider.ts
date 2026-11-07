// Port of net.minecraft.client.gui.components.AbstractSliderButton /
// AbstractOptionSliderButton (26.2).
// Sources: AbstractSliderButton.java (value 0..1, applyValue, onValueChange,
// SPRITE/HANDLE_SPRITE, renderWidget, onClick/mouseDragged/keyPressed).

import type { GuiGraphics } from '../GuiGraphics.js';
import { AbstractWidget } from './AbstractWidget.js';
import { clamp } from './geometry.js';

export type SliderLabel = (message: string, value: number) => string;
export type SliderChange = (value: number) => void;

export const SLIDER_HANDLE_WIDTH = 8;

export class Slider extends AbstractWidget {
  private dragging = false;

  constructor(
    x: number, y: number, width: number, height: number,
    message: string,
    public value: number,
    private readonly label: SliderLabel,
    private readonly onValueChange: SliderChange,
  ) {
    super(x, y, width, height, message);
    this.value = clamp(value, 0, 1);
  }

  get displayMessage(): string { return this.label(this.message, this.value); }

  setValue(value: number, notify = true): void {
    this.value = clamp(value, 0, 1);
    if (notify) this.onValueChange(this.value);
  }

  protected renderWidget(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const hot = this.isHovered() || this.focused || this.dragging;
    g.blitSprite(this.active ? (hot ? 'widget/slider_highlighted' : 'widget/slider') : 'widget/slider', this.x, this.y, this.width, this.height);
    const handleX = this.x + Math.round((this.width - SLIDER_HANDLE_WIDTH) * this.value);
    g.blitSprite(hot && this.active ? 'widget/slider_handle_highlighted' : 'widget/slider_handle',
      handleX, this.y, SLIDER_HANDLE_WIDTH, this.height);
    const text = this.displayMessage;
    const tw = g.textWidth(text);
    g.drawString(text, this.x + Math.floor((this.width - tw) / 2), this.y + Math.floor((this.height - 8) / 2),
      this.active ? 0xffe0e0e0 : 0xffa0a0a0, true);
  }

  private valueFromX(mx: number): number {
    return clamp((mx - this.x - SLIDER_HANDLE_WIDTH / 2) / Math.max(1, this.width - SLIDER_HANDLE_WIDTH), 0, 1);
  }

  protected onClick(mx: number, _my: number, _button: number): void {
    this.dragging = true;
    this.setValue(this.valueFromX(mx));
  }

  mouseClicked(mx: number, my: number, button: number): boolean {
    if (super.mouseClicked(mx, my, button)) return true;
    // Allow clicking anywhere on the track, not only the handle.
    if (this.active && this.visible && button === 0 && this.isMouseOver(mx, my)) {
      this.dragging = true;
      this.setValue(this.valueFromX(mx));
      return true;
    }
    return false;
  }

  mouseDragged(mx: number, _my: number, _button: number, _dx: number, _dy: number): boolean {
    if (!this.dragging || !this.active) return false;
    this.setValue(this.valueFromX(mx));
    return true;
  }

  mouseReleased(_mx: number, _my: number, _button: number): boolean {
    if (!this.dragging) return false;
    this.dragging = false;
    return true;
  }

  keyPressed(code: string, _char: string, _mods: number): boolean {
    if (!this.focused) return false;
    const step = 1 / 20;
    if (code === 'ArrowLeft' || code === 'ArrowDown') { this.setValue(this.value - step); return true; }
    if (code === 'ArrowRight' || code === 'ArrowUp') { this.setValue(this.value + step); return true; }
    if (code === 'Home') { this.setValue(0); return true; }
    if (code === 'End') { this.setValue(1); return true; }
    return false;
  }
}
