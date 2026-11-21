// Source: net.minecraft.client.gui.screens.inventory.BrewingStandScreen (26.2)
//
// 176x166 brewing stand panel (textures/gui/container/brewing_stand.png),
// three PotionSlots at (56,51)/(79,58)/(102,51), the ingredient slot (79,17)
// and the blaze-powder fuel slot (17,17). The fuel bar, the rising brew
// progress and the bubbles are cropped from their fixed-size GUI sprites.

import type { GuiGraphics } from '../../GuiGraphics.js';
import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { PLAYER_INV_LEFT, PLAYER_INV_TOP, PLAYER_INV_HOTBAR_TOP, SLOT_GRID } from '../../GuiConstants.js';

const FUEL_X = 60;
const FUEL_Y = 44;
const FUEL_W = 18;
const BREW_X = 97;
const BREW_Y = 16;
const BUBBLE_X = 63;
const BUBBLE_Y = 14;
const BREW_TIME = 400;

export class BrewingScreen extends AbstractContainerScreen {
  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.brewing', 176, 166, 'gui/container/brewing_stand');
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [
      { index: 0, x: 56, y: 51 },
      { index: 1, x: 79, y: 58 },
      { index: 2, x: 102, y: 51 },
      { index: 3, x: 79, y: 17 },
      { index: 4, x: 17, y: 17 },
    ];
    for (let i = 0; i < 27; i++) {
      out.push({ index: 5 + i, x: PLAYER_INV_LEFT + (i % 9) * SLOT_GRID, y: PLAYER_INV_TOP + Math.floor(i / 9) * SLOT_GRID });
    }
    for (let i = 0; i < 9; i++) {
      out.push({ index: 32 + i, x: PLAYER_INV_LEFT + i * SLOT_GRID, y: PLAYER_INV_HOTBAR_TOP });
    }
    return out;
  }

  protected override emptySlotSprite(menuSlot: number): string | undefined {
    return menuSlot === 4 ? 'container/slot/brewing_fuel' : undefined;
  }

  protected override renderBackground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    super.renderBackground(g, mx, my, pt);
    const info = this.env.deps.container?.brewInfo?.() ?? { progress: 0, fuel: 0 };
    g.pushPose();
    g.translate(this.leftPos, this.topPos);
    // Fuel bar: 18 pixels wide, up to 20 fuel points (BrewingStandScreen.renderBg).
    const fuel = Math.max(0, Math.min(20, info.fuel));
    const fuelW = Math.max(0, Math.min(FUEL_W, Math.floor((FUEL_W * fuel + 20 - 1) / 20)));
    if (fuelW > 0) {
      g.blitSpriteRegion('container/brewing_stand/fuel_length', FUEL_X, FUEL_Y, fuelW, 4, 0, 0, fuelW, 4);
    }
    const ticks = Math.max(0, Math.min(BREW_TIME, info.progress));
    if (ticks > 0) {
      // Progress rises from the bottom of the 9x28 column.
      const progress = Math.floor(28 * (1 - ticks / BREW_TIME));
      if (progress > 0) {
        g.blitSpriteRegion(
          'container/brewing_stand/brew_progress',
          BREW_X, BREW_Y + 28 - progress, 9, progress,
          0, 28 - progress, 9, progress,
        );
      }
      // Bubbles shrink as the brew timer runs down (12x29).
      const bubbles = Math.max(0, Math.min(29, Math.floor(ticks / 2)));
      if (bubbles > 0) {
        g.blitSpriteRegion(
          'container/brewing_stand/bubbles',
          BUBBLE_X, BUBBLE_Y + 29 - bubbles, 12, bubbles,
          0, 29 - bubbles, 12, bubbles,
        );
      }
    }
    g.popPose();
  }
}
