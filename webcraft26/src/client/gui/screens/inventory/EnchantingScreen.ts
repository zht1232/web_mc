// Source: net.minecraft.client.gui.screens.inventory.EnchantmentScreen (26.2)
//
// 176x166 enchanting table: item + lapis slots, the three offer buttons
// (108x19 at x=60, y=14/33/52) drawn from the container/enchanting_table level
// sprites, and the standard player inventory. Offer rune text is not rendered
// (the port has no Standard Galactic Font glyphs); the buttons show the vanilla
// level numeral + enabled/disabled state.

import type { GuiGraphics } from '../../GuiGraphics.js';
import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { SLOT_GRID } from '../../GuiConstants.js';

const BTN_X = 60;
const BTN_Y = 14;
const BTN_W = 108;
const BTN_H = 19;

export class EnchantingScreen extends AbstractContainerScreen {
  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.enchant', 176, 166, 'gui/container/enchanting_table');
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [
      { index: 0, x: 15, y: 47 },
      { index: 1, x: 35, y: 47 },
    ];
    for (let i = 0; i < 27; i++) {
      out.push({ index: 2 + i, x: 8 + (i % 9) * SLOT_GRID, y: 84 + Math.floor(i / 9) * SLOT_GRID });
    }
    for (let i = 0; i < 9; i++) {
      out.push({ index: 29 + i, x: 8 + i * SLOT_GRID, y: 142 });
    }
    return out;
  }

  protected override renderForeground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    super.renderForeground(g, mx, my, pt);
    const levels = this.env.deps.playerLevel?.() ?? 0;
    const info = this.env.deps.container?.enchantInfo?.(levels);
    const bx = this.leftPos + BTN_X;
    for (let i = 0; i < 3; i++) {
      const y = this.topPos + BTN_Y + i * BTN_H;
      const enabled = info?.canEnchant[i] ?? false;
      g.blitSprite(`container/enchanting_table/enchantment_slot${enabled ? '' : '_disabled'}`, bx, y, BTN_W, BTN_H);
      g.blitSprite(`container/enchanting_table/level_${i + 1}${enabled ? '' : '_disabled'}`, bx + BTN_W - 18, y + 1, 16, 16);
      if (enabled && mx >= bx && mx < bx + BTN_W && my >= y && my < y + BTN_H) {
        g.blitSprite('container/enchanting_table/enchantment_slot_highlighted', bx, y, BTN_W, BTN_H);
      }
    }
  }

  protected override onMouseClicked(mx: number, my: number, button: number): boolean {
    if (button !== 0) return false;
    const bx = this.leftPos + BTN_X;
    for (let i = 0; i < 3; i++) {
      const y = this.topPos + BTN_Y + i * BTN_H;
      if (mx >= bx && mx < bx + BTN_W && my >= y && my < y + BTN_H) {
        if (this.env.deps.container?.enchant?.(i)) return true;
      }
    }
    return false;
  }
}
