// Source: net.minecraft.world.inventory.HopperMenu (26.2)
//
// HOPPER menu: five container slots in a row, then the standard 36 player
// slots. The block's Container is supplied by the caller so the GUI, the
// transfer tick and the block-entity record all share one storage.

import { ItemStack } from '../item/ItemStack.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import type { MenuPlayer } from './AbstractContainerMenu.js';
import { AbstractContainerMenu } from './AbstractContainerMenu.js';
import { SimpleContainer, type Container } from './Container.js';
import { Slot } from './Slot.js';
import { MenuType } from './MenuType.js';

export const HOPPER_SIZE = 5;

export class HopperMenu extends AbstractContainerMenu {
  readonly container: Container;

  constructor(
    containerId: number,
    playerInventory: PlayerInventory,
    container: Container = new SimpleContainer(HOPPER_SIZE),
  ) {
    super(MenuType.HOPPER, containerId);
    this.container = container;
    for (let i = 0; i < HOPPER_SIZE; i++) {
      this.addSlot(new Slot(this.container, i, 44 + i * 18, 20));
    }
    this.addStandardInventorySlots(playerInventory, 8, 51);
  }

  /** HopperMenu.quickMoveStack: container <-> player inventory. */
  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    let clicked = ItemStack.EMPTY;
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return clicked;
    const stack = slot.getItem();
    clicked = stack.copy();
    const end = this.slots.length;
    if (slotIndex < HOPPER_SIZE) {
      if (!this.moveItemStackTo(stack, HOPPER_SIZE, end, true)) return ItemStack.EMPTY;
    } else if (!this.moveItemStackTo(stack, 0, HOPPER_SIZE, false)) {
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
