// Source: net.minecraft.world.inventory.CraftingMenu (26.2)
//
// Slot map: result 0, 3x3 craft 1..9, player inventory 10..36, hotbar 37..45.

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';
import type { RecipeManager } from '../item/crafting/RecipeManager.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import type { MenuPlayer } from './AbstractContainerMenu.js';
import { AbstractCraftingMenu } from './AbstractCraftingMenu.js';
import { Slot } from './Slot.js';
import { MenuType } from './MenuType.js';

export const CRAFT_RESULT_SLOT = 0;
export const CRAFT_GRID_START = 1;
export const CRAFT_GRID_END = 10;
export const CRAFT_INV_START = 10;
export const CRAFT_INV_END = 37;
export const CRAFT_HOTBAR_START = 37;
export const CRAFT_HOTBAR_END = 46;

export class CraftingMenu extends AbstractCraftingMenu {
  constructor(
    readonly playerInventory: PlayerInventory,
    recipeManager: RecipeManager,
    registry: ItemRegistry,
    containerId = 0,
  ) {
    super(MenuType.CRAFTING, containerId, 3, 3, recipeManager, registry);
    this.addResultSlot(124, 35);
    this.addCraftingGridSlots(30, 17);
    this.addStandardInventorySlots(playerInventory, 8, 84);
    this.recomputeResult();
  }

  override getResultSlot(): Slot { return this.slots[0]; }
  override getInputGridSlots(): readonly Slot[] { return this.slots.slice(1, 10); }

  /** CraftingMenu.quickMoveStack. */
  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    let clicked = ItemStack.EMPTY;
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return clicked;
    const stack = slot.getItem();
    clicked = stack.copy();

    if (slotIndex === CRAFT_RESULT_SLOT) {
      if (!this.moveItemStackTo(stack, CRAFT_INV_START, CRAFT_HOTBAR_END, true)) return ItemStack.EMPTY;
      slot.onQuickCraft(stack, clicked);
    } else if (slotIndex >= CRAFT_INV_START && slotIndex < CRAFT_HOTBAR_END) {
      if (!this.moveItemStackTo(stack, CRAFT_GRID_START, CRAFT_GRID_END, false)) {
        if (slotIndex < CRAFT_INV_END) {
          if (!this.moveItemStackTo(stack, CRAFT_HOTBAR_START, CRAFT_HOTBAR_END, false)) return ItemStack.EMPTY;
        } else if (!this.moveItemStackTo(stack, CRAFT_INV_START, CRAFT_INV_END, false)) {
          return ItemStack.EMPTY;
        }
      }
    } else if (!this.moveItemStackTo(stack, CRAFT_INV_START, CRAFT_HOTBAR_END, false)) {
      return ItemStack.EMPTY;
    }

    if (stack.isEmpty()) slot.setByPlayer(ItemStack.EMPTY);
    else slot.setChanged();
    if (stack.getCount() === clicked.getCount()) return ItemStack.EMPTY;
    slot.onTake(player, stack);
    if (slotIndex === CRAFT_RESULT_SLOT && player) player.drop(stack);
    return clicked;
  }

  override stillValid(_player: MenuPlayer | null): boolean { return true; }

  override removed(player: MenuPlayer | null): void {
    this.clearCraftingContent(player);
    super.removed(player);
  }
}
