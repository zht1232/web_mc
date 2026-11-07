// Source: net.minecraft.world.inventory.ChestMenu (26.2)
//
// generic_9x1..generic_9x6. Container slots 0..(9*rows-1), then the standard
// 36 player slots. Used by ChestScreen / BlockEntity-less containers.

import { ItemStack } from '../item/ItemStack.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import type { MenuPlayer } from './AbstractContainerMenu.js';
import { AbstractContainerMenu } from './AbstractContainerMenu.js';
import { SimpleContainer, type Container } from './Container.js';
import { Slot } from './Slot.js';
import { MenuType, chestMenuType, chestRows } from './MenuType.js';

export class ChestMenu extends AbstractContainerMenu {
  readonly container: Container;
  readonly rows: number;
  readonly containerSlots: number;

  constructor(
    containerId: number,
    playerInventory: PlayerInventory,
    rowsOrContainer: number | Container = 3,
  ) {
    const rows = typeof rowsOrContainer === 'number' ? rowsOrContainer : Math.floor((rowsOrContainer.getContainerSize() + 8) / 9);
    super(chestMenuType(rows), containerId);
    this.rows = rows;
    this.container = typeof rowsOrContainer === 'number' ? new SimpleContainer(rows * 9) : rowsOrContainer;
    this.containerSlots = rows * 9;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < 9; x++) this.addSlot(new Slot(this.container, x + y * 9, 8 + x * 18, 18 + y * 18));
    }
    this.addStandardInventorySlots(playerInventory, 8, 18 + rows * 18 + (rows === 6 ? 18 : 14));
  }

  /** ChestMenu.quickMoveStack: container <-> player inventory. */
  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    let clicked = ItemStack.EMPTY;
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return clicked;
    const stack = slot.getItem();
    clicked = stack.copy();
    const end = this.slots.length;
    if (slotIndex < this.containerSlots) {
      if (!this.moveItemStackTo(stack, this.containerSlots, end, true)) return ItemStack.EMPTY;
    } else if (!this.moveItemStackTo(stack, 0, this.containerSlots, false)) {
      return ItemStack.EMPTY;
    }
    if (stack.isEmpty()) slot.setByPlayer(ItemStack.EMPTY);
    else slot.setChanged();
    if (stack.getCount() === clicked.getCount()) return ItemStack.EMPTY;
    slot.onTake(player, stack);
    return clicked;
  }

  override stillValid(_player: MenuPlayer | null): boolean { return true; }
}

export function chestRowsOf(menu: ChestMenu): number { return chestRows(menu.menuType as MenuType); }
