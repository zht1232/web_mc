// Port of net.minecraft.client.gui.screens.inventory.ContainerScreen /
// ChestScreen via MenuScreens (26.2).
// Sources: ChestMenu.java (addChestGrid(container, 8, 18),
// inventoryTop = 18 + containerRows * 18 + 13, addStandardInventorySlots(8, inventoryTop)),
// ContainerScreen.java (GENERIC_54 background, imageHeight = 114 + rows*18,
// inventoryLabelY = imageHeight - 94).

import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { SLOT_GRID } from '../../GuiConstants.js';

export class ChestScreen extends AbstractContainerScreen {
  private readonly rows: number;

  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0], rows = 3) {
    const r = Math.max(1, Math.min(6, rows));
    super(env, 'container.chest', 176, 114 + r * 18, 'gui/container/generic_54');
    this.rows = r;
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [];
    const chestTop = 18;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < 9; x++) {
        out.push({ index: y * 9 + x, x: 8 + x * SLOT_GRID, y: chestTop + y * SLOT_GRID });
      }
    }
    const invTop = chestTop + this.rows * SLOT_GRID + 13;
    for (let i = 0; i < 27; i++) {
      out.push({ index: this.rows * 9 + i, x: 8 + (i % 9) * SLOT_GRID, y: invTop + Math.floor(i / 9) * SLOT_GRID });
    }
    for (let i = 0; i < 9; i++) {
      out.push({ index: this.rows * 9 + 27 + i, x: 8 + i * SLOT_GRID, y: invTop + 58 });
    }
    return out;
  }
}
