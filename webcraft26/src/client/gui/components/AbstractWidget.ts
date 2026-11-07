// Port of net.minecraft.client.gui.components.AbstractWidget (26.2).
// Sources: AbstractWidget.java (x/y/width/height, active, visible, alpha,
// isHovered, isMouseOver, setPosition, mouseClicked) and
// AbstractButton.java (onClick / onRelease).

import type { GuiGraphics } from '../GuiGraphics.js';
import type { Rect, WidgetLike } from '../Types.js';
import { isInside } from './geometry.js';
import type { Tooltip } from './Tooltip.js';

export abstract class AbstractWidget implements WidgetLike {
  message: string;
  active = true;
  visible = true;
  alpha = 1;
  tabOrderGroup = 0;
  protected _focused = false;
  protected _hovered = false;
  tooltip?: Tooltip;

  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
    message: string,
  ) {
    this.message = message;
  }

  get focused(): boolean { return this._focused; }
  setFocused(value: boolean): void { this._focused = value; }
  isHovered(): boolean { return this._hovered; }

  getRect(): Rect {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setAlpha(a: number): void { this.alpha = a; }
  setTooltip(tooltip: Tooltip | undefined): void { this.tooltip = tooltip; }

  /** AbstractWidget#isMouseOver / areCoordinatesInRectangle (half-open rect). */
  isMouseOver(mx: number, my: number): boolean {
    return isInside(mx, my, this.getRect());
  }

  /** Called by Screen at the end of the frame so tooltips stay on top. */
  getHoveredTooltip(): Tooltip | null {
    return this.visible && this._hovered && this.tooltip ? this.tooltip : null;
  }

  render(g: GuiGraphics, mouseX: number, mouseY: number, partialTick: number): void {
    if (!this.visible) return;
    // AbstractWidget#extractRenderState: hover requires the point to be inside
    // the active scissor as well as the widget rectangle.
    this._hovered = g.containsPointInScissor(mouseX, mouseY) && this.isMouseOver(mouseX, mouseY);
    const prevAlpha = g.getAlpha();
    g.setAlpha(prevAlpha * this.alpha);
    this.renderWidget(g, mouseX, mouseY, partialTick);
    g.setAlpha(prevAlpha);
  }

  protected abstract renderWidget(g: GuiGraphics, mouseX: number, mouseY: number, partialTick: number): void;

  /** AbstractWidget#mouseClicked -> onClick. */
  mouseClicked(mx: number, my: number, button: number): boolean {
    if (!this.active || !this.visible || button !== 0) return false;
    if (!this.isMouseOver(mx, my)) return false;
    this.onClick(mx, my, button);
    return true;
  }

  protected onClick(_mx: number, _my: number, _button: number): void { /* overridden */ }

  mouseReleased(_mx: number, _my: number, _button: number): boolean { return false; }
  mouseDragged(_mx: number, _my: number, _button: number, _dx: number, _dy: number): boolean { return false; }
  mouseScrolled(_mx: number, _my: number, _delta: number): boolean { return false; }
  keyPressed(_code: string, _char: string, _mods: number): boolean { return false; }
  charTyped(_ch: string, _mods: number): boolean { return false; }
  tick(): void { /* overridden */ }
}
