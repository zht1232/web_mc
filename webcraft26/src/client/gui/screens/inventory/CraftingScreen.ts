// Port of net.minecraft.client.gui.screens.inventory.CraftingScreen (26.2).
// Sources: CraftingScreen.java (BACKGROUND_LOCATION =
// textures/gui/container/crafting_table.png, imageWidth 176, imageHeight 166),
// CraftingMenu.java (addResultSlot(player, 124, 35), addCraftingGridSlots(30, 17),
// addStandardInventorySlots(inventory, 8, 84)).

import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { PLAYER_INV_LEFT, PLAYER_INV_TOP, PLAYER_INV_HOTBAR_TOP, SLOT_GRID } from '../../GuiConstants.js';

export class CraftingScreen extends AbstractContainerScreen {
  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.crafting', 176, 166, 'gui/container/crafting_table');
    this.titleLabelX = 28;
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [];
    // result slot (menu index 0)
    out.push({ index: 0, x: 124, y: 35 });
    // 3x3 crafting grid (menu indices 1..9)
    for (let i = 0; i < 9; i++) {
      out.push({ index: i + 1, x: 30 + (i % 3) * SLOT_GRID, y: 17 + Math.floor(i / 3) * SLOT_GRID });
    }
    // player main inventory (menu indices 10..36 -> container 9..35)
    for (let i = 0; i < 27; i++) {
      out.push({ index: 10 + i, x: PLAYER_INV_LEFT + (i % 9) * SLOT_GRID, y: PLAYER_INV_TOP + Math.floor(i / 9) * SLOT_GRID });
    }
    // hotbar (menu indices 37..45 -> container 0..8)
    for (let i = 0; i < 9; i++) {
      out.push({ index: 37 + i, x: PLAYER_INV_LEFT + i * SLOT_GRID, y: PLAYER_INV_HOTBAR_TOP });
    }
    return out;
  }
}
