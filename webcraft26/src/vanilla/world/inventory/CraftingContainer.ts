// Source: net.minecraft.world.inventory.CraftingContainer (26.2)
//         net.minecraft.world.inventory.TransientCraftingContainer (26.2)

import { ItemStack } from '../item/ItemStack.js';
import { positionedOf, type PositionedCraftingInput } from '../item/crafting/Recipe.js';
import type { CraftingGrid } from '../item/crafting/RecipeManager.js';
import { AbstractContainer, ContainerHelper } from './Container.js';

/** Minimal listener so a container can notify its menu without a circular import. */
export interface SlotsChangedListener {
  slotsChanged(container: unknown): void;
}

/** Port of net.minecraft.world.inventory.CraftingContainer. */
export interface CraftingContainer extends CraftingGrid {
  getWidth(): number;
  getHeight(): number;
  getItems(): readonly ItemStack[];
  asPositionedCraftInput(): PositionedCraftingInput;
}

/** Port of net.minecraft.world.inventory.TransientCraftingContainer. */
export class TransientCraftingContainer extends AbstractContainer implements CraftingContainer {
  private readonly items: ItemStack[];

  constructor(
    private readonly menu: SlotsChangedListener,
    readonly width: number,
    readonly height: number,
  ) {
    super();
    this.items = new Array(width * height).fill(ItemStack.EMPTY);
  }

  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }
  override getContainerSize(): number { return this.items.length; }
  override getItem(slot: number): ItemStack {
    return slot >= 0 && slot < this.items.length ? this.items[slot] : ItemStack.EMPTY;
  }
  override setItem(slot: number, stack: ItemStack): void {
    if (slot >= 0 && slot < this.items.length) {
      this.items[slot] = stack;
      this.menu.slotsChanged(this);
    }
  }
  override removeItem(slot: number, count: number): ItemStack {
    const result = ContainerHelper.removeItem(this.items, slot, count);
    if (!result.isEmpty()) this.menu.slotsChanged(this);
    return result;
  }
  override removeItemNoUpdate(slot: number): ItemStack {
    return ContainerHelper.takeItem(this.items, slot);
  }
  override getMaxStackSize(): number { return 64; }
  getItems(): readonly ItemStack[] { return this.items; }

  asPositionedCraftInput(): PositionedCraftingInput {
    return positionedOf(this.width, this.height, this.items);
  }
}
