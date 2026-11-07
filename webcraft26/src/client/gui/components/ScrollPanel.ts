// Port of net.minecraft.client.gui.components.AbstractSelectionList /
// AbstractScrollArea (26.2).
// Sources: AbstractSelectionList.java (scrollAmount, renderList, renderScrollbar,
// mouseClicked/mouseDragged/mouseScrolled), AbstractScrollArea.java
// (scroller / scroller_background sprites), OptionsList.java,
// worldselection.WorldSelectionList.java.

import type { GuiGraphics } from '../GuiGraphics.js';
import { AbstractWidget } from './AbstractWidget.js';
import { clamp } from './geometry.js';

export interface ScrollPanelConfig<T> {
  itemHeight: number;
  renderItem: (g: GuiGraphics, item: T, index: number, x: number, y: number, w: number, h: number, hovered: boolean, selected: boolean) => void;
  onSelect?: (item: T, index: number) => void;
  /** Extra top padding (header separator etc.). */
  headerHeight?: number;
  /** Always reserve space for the scrollbar. */
  alwaysShowScrollbar?: boolean;
}

export class ScrollPanel<T> extends AbstractWidget {
  items: T[] = [];
  scrollOffset = 0;
  selectedIndex = -1;
  private draggingScrollbar = false;
  private dragStartY = 0;
  private dragStartOffset = 0;
  private hoveredIndex = -1;

  constructor(
    x: number, y: number, width: number, height: number,
    message: string,
    private readonly config: ScrollPanelConfig<T>,
  ) {
    super(x, y, width, height, message);
  }

  setItems(items: readonly T[]): void {
    this.items = items.slice();
    this.scrollOffset = clamp(this.scrollOffset, 0, this.maxScroll());
    if (this.selectedIndex >= this.items.length) this.selectedIndex = -1;
  }

  getSelected(): T | undefined {
    return this.selectedIndex >= 0 ? this.items[this.selectedIndex] : undefined;
  }

  private get itemHeight(): number { return this.config.itemHeight; }
  private get headerHeight(): number { return this.config.headerHeight ?? 0; }
  private get contentHeight(): number { return this.items.length * this.itemHeight; }
  private get scrollbarReserved(): number { return 6; }
  private get rowWidth(): number { return this.width - (this.needsScrollbar() ? this.scrollbarReserved : 0); }

  private needsScrollbar(): boolean {
    return this.config.alwaysShowScrollbar === true || this.contentHeight > this.height - this.headerHeight;
  }

  maxScroll(): number {
    return Math.max(0, this.contentHeight - (this.height - this.headerHeight));
  }

  scrollBy(delta: number): void {
    this.scrollOffset = clamp(this.scrollOffset + delta, 0, this.maxScroll());
  }

  protected renderWidget(g: GuiGraphics, mouseX: number, mouseY: number, _pt: number): void {
    const { x, y, width, height } = this;
    // Vanilla list background: dark, with a subtle top/bottom gradient edge.
    g.fill(x, y, x + width, y + height, 0xc0101010);
    g.hLine(x, x + width - 1, y, 0xffffffff);
    g.hLine(x, x + width - 1, y + height - 1, 0xffffffff);

    g.enableScissor(x, y, x + width, y + height);
    this.hoveredIndex = -1;
    const top = y + this.headerHeight - this.scrollOffset;
    for (let i = 0; i < this.items.length; i++) {
      const rowY = top + i * this.itemHeight;
      if (rowY + this.itemHeight < y + this.headerHeight || rowY > y + height) continue;
      const hovered = mouseX >= x && mouseX < x + this.rowWidth && mouseY >= Math.max(rowY, y + this.headerHeight) &&
        mouseY < Math.min(rowY + this.itemHeight, y + height);
      if (hovered) this.hoveredIndex = i;
      this.config.renderItem(g, this.items[i], i, x, rowY, this.rowWidth, this.itemHeight, hovered, i === this.selectedIndex);
    }
    g.disableScissor();

    if (this.needsScrollbar()) this.renderScrollbar(g);
  }

  private renderScrollbar(g: GuiGraphics): void {
    const { x, y, width, height } = this;
    const sbX = x + width - this.scrollbarReserved;
    g.blitSprite('widget/scroller_background', sbX, y, this.scrollbarReserved, height);
    const view = height - this.headerHeight;
    const thumbH = Math.max(15, Math.round(view * view / Math.max(1, this.contentHeight)));
    const maxOffset = Math.max(1, view - thumbH);
    const thumbY = y + this.headerHeight + Math.round((this.scrollOffset / Math.max(1, this.maxScroll())) * maxOffset);
    g.blitSprite('widget/scroller', sbX, thumbY, this.scrollbarReserved, thumbH);
  }

  mouseScrolled(mx: number, my: number, delta: number): boolean {
    if (!this.visible || !this.active || !this.isMouseOver(mx, my)) return false;
    this.scrollBy(-delta * this.itemHeight);
    return true;
  }

  mouseClicked(mx: number, my: number, button: number): boolean {
    if (!this.visible || !this.active || button !== 0) return false;
    if (!this.isMouseOver(mx, my)) return false;
    const { x, y, width, height } = this;
    if (this.needsScrollbar() && mx >= x + width - this.scrollbarReserved) {
      this.draggingScrollbar = true;
      this.dragStartY = my;
      this.dragStartOffset = this.scrollOffset;
      return true;
    }
    const rel = my - y - this.headerHeight + this.scrollOffset;
    const index = Math.floor(rel / this.itemHeight);
    if (index >= 0 && index < this.items.length && rel >= 0) {
      this.selectedIndex = index;
      this.config.onSelect?.(this.items[index], index);
      return true;
    }
    return false;
  }

  mouseDragged(mx: number, my: number, _button: number, _dx: number, _dy: number): boolean {
    if (!this.draggingScrollbar) return false;
    const view = this.height - this.headerHeight;
    const thumbH = Math.max(15, Math.round(view * view / Math.max(1, this.contentHeight)));
    const maxOffset = Math.max(1, view - thumbH);
    const deltaPx = my - this.dragStartY;
    this.scrollOffset = clamp(this.dragStartOffset + (deltaPx / maxOffset) * this.maxScroll(), 0, this.maxScroll());
    void mx;
    return true;
  }

  mouseReleased(_mx: number, _my: number, _button: number): boolean {
    if (!this.draggingScrollbar) return false;
    this.draggingScrollbar = false;
    return true;
  }

  keyPressed(code: string, _char: string, _mods: number): boolean {
    if (!this.visible) return false;
    switch (code) {
      case 'ArrowDown': this.setSelectedIndex(this.selectedIndex + 1); return true;
      case 'ArrowUp': this.setSelectedIndex(this.selectedIndex - 1); return true;
      case 'PageDown': this.scrollBy(this.height); return true;
      case 'PageUp': this.scrollBy(-this.height); return true;
      case 'Home': this.scrollOffset = 0; return true;
      case 'End': this.scrollOffset = this.maxScroll(); return true;
      default: return false;
    }
  }

  private setSelectedIndex(index: number): void {
    if (this.items.length === 0) return;
    this.selectedIndex = clamp(index, 0, this.items.length - 1);
    this.config.onSelect?.(this.items[this.selectedIndex], this.selectedIndex);
    const rowTop = this.headerHeight + this.selectedIndex * this.itemHeight;
    const rowBottom = rowTop + this.itemHeight;
    if (rowTop < this.scrollOffset) this.scrollOffset = rowTop;
    else if (rowBottom > this.scrollOffset + this.height - this.headerHeight) {
      this.scrollOffset = rowBottom - (this.height - this.headerHeight);
    }
    this.scrollOffset = clamp(this.scrollOffset, 0, this.maxScroll());
  }
}
