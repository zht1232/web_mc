// Port of net.minecraft.client.gui.components.TabButton (26.2).
// Source: TabButton.java (widget/tab, widget/tab_selected + their highlighted
// variants; selected state; label centred), also used by
// components.tabs.TabNavigationBar and CreateWorldScreen tab headers.

import type { GuiGraphics } from '../GuiGraphics.js';
import { AbstractWidget } from './AbstractWidget.js';

export class TabButton extends AbstractWidget {
  constructor(
    x: number, y: number, width: number, height: number,
    message: string,
    public selected: boolean,
    private readonly onPress: (button: TabButton) => void,
  ) {
    super(x, y, width, height, message);
  }

  setSelected(value: boolean): void { this.selected = value; }

  protected renderWidget(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const hot = this.isHovered() || this.focused;
    const sprite = this.selected
      ? (hot ? 'widget/tab_selected_highlighted' : 'widget/tab_selected')
      : (hot ? 'widget/tab_highlighted' : 'widget/tab');
    g.blitSprite(sprite, this.x, this.y, this.width, this.height);
    const tw = g.textWidth(this.message);
    g.drawString(this.message, this.x + Math.floor((this.width - tw) / 2),
      this.y + Math.floor((this.height - 8) / 2), this.selected ? 0xffffffff : 0xffe0e0e0, true);
  }

  protected onClick(_mx: number, _my: number, _button: number): void {
    this.onPress(this);
  }
}
