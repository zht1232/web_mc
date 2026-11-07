// Port of net.minecraft.client.gui.screens.inventory.FurnaceScreen /
// AbstractFurnaceScreen (26.2).
// Sources: AbstractFurnaceMenu.java (Slot(0, 56, 17), FurnaceFuelSlot(1, 56, 53),
// FurnaceResultSlot(2, 116, 35), addStandardInventorySlots(inventory, 8, 84)),
// AbstractFurnaceScreen.java (BACKGROUND_LOCATION =
// textures/gui/container/furnace.png, LIT_PROGRESS_SPRITE, BURN_PROGRESS_SPRITE,
// flame and burn-progress indicators, imageWidth 176, imageHeight 166).

import type { GuiGraphics } from '../../GuiGraphics.js';
import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { PLAYER_INV_LEFT, PLAYER_INV_TOP, PLAYER_INV_HOTBAR_TOP, SLOT_GRID } from '../../GuiConstants.js';

export class FurnaceScreen extends AbstractContainerScreen {
  /** Burn progress 0..1 and lit progress 0..1 (injected by the main agent). */
  burnProgress = 0.5;
  litProgress = 0.75;

  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.furnace', 176, 166, 'gui/container/furnace');
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [
      { index: 0, x: 56, y: 17 },   // ingredient
      { index: 1, x: 56, y: 53 },   // fuel
      { index: 2, x: 116, y: 35 },  // result
    ];
    for (let i = 0; i < 27; i++) {
      out.push({ index: 3 + i, x: PLAYER_INV_LEFT + (i % 9) * SLOT_GRID, y: PLAYER_INV_TOP + Math.floor(i / 9) * SLOT_GRID });
    }
    for (let i = 0; i < 9; i++) {
      out.push({ index: 30 + i, x: PLAYER_INV_LEFT + i * SLOT_GRID, y: PLAYER_INV_HOTBAR_TOP });
    }
    return out;
  }

  protected renderBackground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    super.renderBackground(g, mx, my, pt);
    g.pushPose();
    g.translate(this.leftPos, this.topPos);
    // Flame sprite (container/furnace/lit_progress) clipped from the bottom.
    const flame = Math.max(0, Math.min(1, this.litProgress));
    if (flame > 0) {
      const h = Math.round(14 * flame);
      if (g.sprites.get('container/furnace/lit_progress')) {
        g.blitSprite('container/furnace/lit_progress', 57, 36 + (14 - h), 14, h);
      } else {
        g.fill(57, 36 + (14 - h), 57 + 14, 36 + 14, 0xffffaa00);
      }
    }
    // Burn/progress arrow (container/furnace/burn_progress) clipped from left.
    const burn = Math.max(0, Math.min(1, this.burnProgress));
    if (burn > 0) {
      const w = Math.round(24 * burn);
      if (g.sprites.get('container/furnace/burn_progress')) {
        g.blitSprite('container/furnace/burn_progress', 79, 34, w, 16);
      } else {
        g.fill(79, 47, 79 + w, 49, 0xffffffff);
      }
    }
    g.popPose();
  }
}
