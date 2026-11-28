// Port of net.minecraft.client.gui.screens.inventory.HopperScreen (26.2).
// Image 176x133, HopperMenu.HOPPER_SIZE slots at (44 + 18i, 20), player
// inventory at (8, 51) and the hotbar at (8, 109); the inventory label sits
// at imageHeight - 94 = 39 (base class relayout).

import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { SLOT_GRID } from '../../GuiConstants.js';

export class HopperScreen extends AbstractContainerScreen {
  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.hopper', 176, 133, 'gui/container/hopper');
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [];
    for (let i = 0; i < 5; i++) out.push({ index: i, x: 44 + i * SLOT_GRID, y: 20 });
    for (let i = 0; i < 27; i++) {
      out.push({ index: 5 + i, x: 8 + (i % 9) * SLOT_GRID, y: 51 + Math.floor(i / 9) * SLOT_GRID });
    }
    for (let i = 0; i < 9; i++) out.push({ index: 32 + i, x: 8 + i * SLOT_GRID, y: 109 });
    return out;
  }
}
