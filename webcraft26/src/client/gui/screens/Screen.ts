// Port of net.minecraft.client.gui.screens.Screen (26.2).
// Sources: Screen.java (width/height, renderables/children/narratables,
// addRenderableWidget, init, resize, keyPressed/ESC handling,
// extractBackground, extractRenderState, onClose, isPauseScreen,
// shouldCloseOnEsc, isInGameUi, fadeWidgets, tick).

import type { GuiGraphics } from '../GuiGraphics.js';
import type { MouseAction, ScreenEnv, ScreenLike, WidgetLike } from '../Types.js';
import { LABEL_COLOR, MENU_SHADE_COLOR } from '../GuiConstants.js';

export abstract class Screen implements ScreenLike {
  width = 0;
  height = 0;
  /** ChatScreen keeps the HUD visible; menus clear it. */
  preserveHud = false;
  protected readonly children: WidgetLike[] = [];
  protected focusedWidget: WidgetLike | null = null;
  protected title: string;
  protected inWorld = false;
  private _isPauseScreen = true;
  private _closeOnEsc = true;
  private draggingButton = -1;
  private lastMouseX = 0;
  private lastMouseY = 0;

  protected readonly titleKey: string;

  constructor(protected readonly env: ScreenEnv, title: string) {
    this.titleKey = title;
    this.title = env.t(title);
  }

  /** Re-translate cached labels after a live language switch. */
  refreshTexts(): void {
    this.title = this.env.t(this.titleKey);
  }

  getTitle(): string { return this.title; }
  setTitle(title: string): void { this.title = title; }

  /** Screen#isInGameUi: container screens render the translucent gradient. */
  isInGameUi(): boolean { return this.inWorld; }
  setInGameUi(value: boolean): void { this.inWorld = value; }
  isPauseScreen(): boolean { return this._isPauseScreen; }
  setPauseScreen(value: boolean): void { this._isPauseScreen = value; }
  shouldCloseOnEsc(): boolean { return this._closeOnEsc; }
  setCloseOnEsc(value: boolean): void { this._closeOnEsc = value; }

  /** Screen#init(width, height) -> init(); Screen#resize -> repositionElements(). */
  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.clearWidgets();
    this.build();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.clearWidgets();
    this.build();
  }

  /** Subclasses create their widgets here (Screen#init). */
  protected abstract build(): void;

  /** Screen#addRenderableWidget */
  protected addRenderableWidget<T extends WidgetLike>(widget: T): T {
    this.children.push(widget);
    return widget;
  }

  protected clearWidgets(): void {
    this.children.length = 0;
    this.focusedWidget = null;
  }

  protected removeWidget(widget: WidgetLike): void {
    const i = this.children.indexOf(widget);
    if (i >= 0) this.children.splice(i, 1);
    if (this.focusedWidget === widget) this.focusedWidget = null;
  }

  protected setFocusedWidget(widget: WidgetLike | null): void {
    if (this.focusedWidget && this.focusedWidget !== widget) this.focusedWidget.setFocused(false);
    this.focusedWidget = widget;
    if (widget) widget.setFocused(true);
  }

  /** Screen#fadeWidgets */
  protected fadeWidgets(alpha: number): void {
    for (const c of this.children) {
      if ('setAlpha' in c && typeof c.setAlpha === 'function') (c as unknown as { setAlpha(a: number): void }).setAlpha(alpha);
    }
  }

  // ------------------------------------------------------------- rendering
  render(g: GuiGraphics, mouseX: number, mouseY: number, partialTick: number): void {
    this.renderBackground(g, mouseX, mouseY, partialTick);
    for (const c of this.children) c.render(g, mouseX, mouseY, partialTick);
    this.renderForeground(g, mouseX, mouseY, partialTick);
    this.renderDeferredTooltips(g, mouseX, mouseY);
  }

  /** Screen#extractBackground */
  protected renderBackground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    if (this.inWorld) g.renderTransparentBackground();
    else g.renderMenuBackground(false, true);
  }

  /** Screen#extractRenderState content hook (labels, entity preview...). */
  protected renderForeground(_g: GuiGraphics, _mx: number, _my: number, _pt: number): void { /* overridden */ }

  private renderDeferredTooltips(g: GuiGraphics, mouseX: number, mouseY: number): void {
    for (const c of this.children) {
      const getter = (c as unknown as { getHoveredTooltip?: () => { render(gr: GuiGraphics, x: number, y: number): void } | null }).getHoveredTooltip;
      const tip = getter?.call(c);
      if (tip) tip.render(g, mouseX, mouseY);
    }
  }

  /** Vanilla title line: centred at y=6..20 with a separator at y=22. */
  protected drawTitle(g: GuiGraphics, color = 0xffffffff): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 8, color, true);
  }

  protected drawMenuTitle(g: GuiGraphics): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 15, 0xffffffff, true);
  }

  /** Screen#extractMenuBackground with the classic 0x60000000 shade. */
  protected drawShade(g: GuiGraphics): void {
    g.fill(0, 0, this.width, this.height, MENU_SHADE_COLOR);
  }

  protected drawLabel(g: GuiGraphics, text: string, x: number, y: number): void {
    g.drawString(text, x, y, LABEL_COLOR, false);
  }

  tick(): void {
    for (const c of this.children) c.tick();
  }

  // ------------------------------------------------------------- input
  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'Escape' && this.shouldCloseOnEsc()) {
      this.onClose();
      this.env.close();
      return true;
    }
    if (this.focusedWidget?.keyPressed(code, char, mods)) return true;
    // Screen#keyPressed: TAB / arrow focus navigation.
    if (code === 'Tab') {
      this.cycleFocus((mods & 1) === 0 ? 1 : -1);
      return true;
    }
    return this.onKeyPressed(code, char, mods);
  }

  /** Screen-specific key hook. */
  protected onKeyPressed(_code: string, _char: string, _mods: number): boolean { return false; }

  charTyped(ch: string, mods: number): boolean {
    return this.focusedWidget?.charTyped(ch, mods) ?? false;
  }

  private cycleFocus(dir: number): void {
    if (this.children.length === 0) return;
    const current = this.focusedWidget ? this.children.indexOf(this.focusedWidget) : -1;
    for (let i = 1; i <= this.children.length; i++) {
      const next = this.children[(current + i * dir + this.children.length * 2) % this.children.length];
      if (next.visible && next.active) { this.setFocusedWidget(next); return; }
    }
  }

  mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0): boolean {
    switch (action) {
      case 'cancel': {
        this.draggingButton = -1;
        return true;
      }
      case 'down': {
        this.draggingButton = button;
        this.lastMouseX = mx; this.lastMouseY = my;
        for (let i = this.children.length - 1; i >= 0; i--) {
          const c = this.children[i];
          if (c.visible && c.active && c.mouseClicked(mx, my, button)) {
            this.setFocusedWidget(c);
            return true;
          }
        }
        this.setFocusedWidget(null);
        return this.onMouseClicked(mx, my, button);
      }
      case 'up': {
        const wasDragging = this.draggingButton;
        this.draggingButton = -1;
        let consumed = false;
        for (let i = this.children.length - 1; i >= 0; i--) {
          if (this.children[i].mouseReleased(mx, my, button)) consumed = true;
        }
        return consumed || this.onMouseReleased(mx, my, button, wasDragging);
      }
      case 'move': {
        const dx = mx - this.lastMouseX;
        const dy = my - this.lastMouseY;
        this.lastMouseX = mx; this.lastMouseY = my;
        if (this.draggingButton >= 0) {
          for (let i = this.children.length - 1; i >= 0; i--) {
            if (this.children[i].mouseDragged(mx, my, this.draggingButton, dx, dy)) return true;
          }
        }
        return false;
      }
      case 'wheel': {
        for (let i = this.children.length - 1; i >= 0; i--) {
          if (this.children[i].mouseScrolled(mx, my, wheelDelta)) return true;
        }
        return false;
      }
    }
  }

  protected onMouseClicked(_mx: number, _my: number, _button: number): boolean { return false; }
  protected onMouseReleased(_mx: number, _my: number, _button: number, _dragging: number): boolean { return false; }

  onClose(): void { /* overridden */ }

  /** Convenience: open another screen via the environment. */
  protected open(name: string, ...args: unknown[]): void { this.env.open(name, ...args); }
  protected close(): void { this.env.close(); }
  protected back(): void { this.env.back(); }
  protected t(key: string): string { return this.env.t(key); }
  protected toast(message: string): void { this.env.toast(message); }
}
