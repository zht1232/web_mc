// Port of net.minecraft.client.gui.components.Tooltip and
// net.minecraft.client.gui.components.WidgetTooltipHolder (26.2).
// A Tooltip is immutable text lines; GuiGraphics.renderTooltip does the layout.

import type { GuiGraphics } from '../GuiGraphics.js';

export class Tooltip {
  constructor(public readonly lines: readonly string[]) {}

  /** Tooltip.create(Component): splits on explicit newlines. */
  static create(text: string): Tooltip {
    return new Tooltip(text.split('\n'));
  }

  static of(...lines: string[]): Tooltip {
    return new Tooltip(lines);
  }

  get text(): string { return this.lines.join('\n'); }

  render(g: GuiGraphics, mouseX: number, mouseY: number): void {
    g.renderTooltip(this.lines, mouseX, mouseY);
  }
}
