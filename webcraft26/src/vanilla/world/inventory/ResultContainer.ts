// Source: net.minecraft.world.inventory.ResultContainer (26.2)

import { ItemStack } from '../item/ItemStack.js';
import { AbstractContainer } from './Container.js';

/** The single output slot of a crafting grid. Port of ResultContainer. */
export class ResultContainer extends AbstractContainer {
  private item: ItemStack = ItemStack.EMPTY;
  private recipeUsed: unknown | null = null;

  override getContainerSize(): number { return 1; }
  override getItem(_slot: number): ItemStack { return this.item; }
  override setItem(_slot: number, stack: ItemStack): void { this.item = stack; }
  override removeItem(_slot: number, _count: number): ItemStack {
    const prev = this.item;
    this.item = ItemStack.EMPTY;
    return prev;
  }
  override removeItemNoUpdate(_slot: number): ItemStack {
    const prev = this.item;
    this.item = ItemStack.EMPTY;
    return prev;
  }
  override setChanged(): void {}

  setRecipeUsed(recipe: unknown | null): void { this.recipeUsed = recipe; }
  getRecipeUsed(): unknown | null { return this.recipeUsed; }
}
