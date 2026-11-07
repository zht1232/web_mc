// Source: net.minecraft.world.inventory.InventoryMenu (26.2)
//
// Slot map (vanilla constants): result 0, 2x2 craft 1..4, armor 5..8 (HEAD,
// CHEST, LEGS, FEET wrapping container slots 39,38,37,36), player inventory
// 9..35, hotbar 36..44, offhand 45 (container slot 40).

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';
import type { RecipeManager } from '../item/crafting/RecipeManager.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import type { MenuPlayer } from './AbstractContainerMenu.js';
import { AbstractCraftingMenu } from './AbstractCraftingMenu.js';
import { ArmorSlot, Slot } from './Slot.js';
import { MenuType } from './MenuType.js';

export const INV_RESULT_SLOT = 0;
export const INV_CRAFT_SLOT_START = 1;
export const INV_CRAFT_SLOT_END = 5;
export const INV_ARMOR_SLOT_START = 5;
export const INV_ARMOR_SLOT_END = 9;
export const INV_MAIN_START = 9;
export const INV_MAIN_END = 36;
export const INV_HOTBAR_START = 36;
export const INV_HOTBAR_END = 45;
export const INV_OFFHAND_SLOT = 45;

const ARMOR_MENU_SLOT: Record<string, number> = { HEAD: 5, CHEST: 6, LEGS: 7, FEET: 8 };

export class InventoryMenu extends AbstractCraftingMenu {
  constructor(
    readonly playerInventory: PlayerInventory,
    recipeManager: RecipeManager,
    registry: ItemRegistry,
    containerId = 0,
  ) {
    super(MenuType.INVENTORY, containerId, 2, 2, recipeManager, registry);
    this.addResultSlot(154, 28);
    this.addCraftingGridSlots(98, 18);

    const equips = ['HEAD', 'CHEST', 'LEGS', 'FEET'] as const;
    for (let i = 0; i < 4; i++) {
      const containerSlot = 39 - i;
      this.addSlot(new ArmorSlot(playerInventory, containerSlot, 8, 8 + i * 18, equips[i]));
    }
    this.addStandardInventorySlots(playerInventory, 8, 84);
    this.addSlot(new Slot(playerInventory, 40, 77, 62));
    this.recomputeResult();
  }

  override getResultSlot(): Slot { return this.slots[0]; }
  override getInputGridSlots(): readonly Slot[] { return this.slots.slice(1, 5); }

  /** InventoryMenu.quickMoveStack (shift-click). */
  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    let clicked = ItemStack.EMPTY;
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return clicked;
    const stack = slot.getItem();
    clicked = stack.copy();
    const equip = stack.item ? stack.item.equip : '';

    if (slotIndex === INV_RESULT_SLOT) {
      if (!this.moveItemStackTo(stack, INV_MAIN_START, INV_HOTBAR_END, true)) return ItemStack.EMPTY;
      slot.onQuickCraft(stack, clicked);
    } else if (slotIndex >= INV_CRAFT_SLOT_START && slotIndex < INV_ARMOR_SLOT_END) {
      if (!this.moveItemStackTo(stack, INV_MAIN_START, INV_HOTBAR_END, false)) return ItemStack.EMPTY;
    } else if (ARMOR_MENU_SLOT[equip] !== undefined && !this.slots[ARMOR_MENU_SLOT[equip]].hasItem()) {
      const pos = ARMOR_MENU_SLOT[equip];
      if (!this.moveItemStackTo(stack, pos, pos + 1, false)) return ItemStack.EMPTY;
    } else if (equip === 'OFFHAND' && !this.slots[INV_OFFHAND_SLOT].hasItem()) {
      if (!this.moveItemStackTo(stack, INV_OFFHAND_SLOT, INV_OFFHAND_SLOT + 1, false)) return ItemStack.EMPTY;
    } else if (slotIndex >= INV_MAIN_START && slotIndex < INV_MAIN_END) {
      if (!this.moveItemStackTo(stack, INV_HOTBAR_START, INV_HOTBAR_END, false)) return ItemStack.EMPTY;
    } else if (slotIndex >= INV_HOTBAR_START && slotIndex < INV_HOTBAR_END) {
      if (!this.moveItemStackTo(stack, INV_MAIN_START, INV_MAIN_END, false)) return ItemStack.EMPTY;
    } else if (!this.moveItemStackTo(stack, INV_MAIN_START, INV_HOTBAR_END, false)) {
      return ItemStack.EMPTY;
    }

    if (stack.isEmpty()) slot.setByPlayer(ItemStack.EMPTY, clicked);
    else slot.setChanged();
    if (stack.getCount() === clicked.getCount()) return ItemStack.EMPTY;
    slot.onTake(player, stack);
    if (slotIndex === INV_RESULT_SLOT && player) player.drop(stack);
    return clicked;
  }

  override stillValid(_player: MenuPlayer | null): boolean { return true; }

  override removed(player: MenuPlayer | null): void {
    this.clearCraftingContent(player);
    super.removed(player);
  }
}
