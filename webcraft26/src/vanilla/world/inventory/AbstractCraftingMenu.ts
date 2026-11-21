// Source: net.minecraft.world.inventory.AbstractCraftingMenu (26.2)
//         net.minecraft.world.inventory.CraftingMenu#slotChangedCraftingGrid
//         net.minecraft.world.inventory.ResultSlot#onTake (remaining-item return)

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';
import type { RecipeManager, CraftingGrid } from '../item/crafting/RecipeManager.js';
import { AbstractContainerMenu, type MenuPlayer } from './AbstractContainerMenu.js';
import { ResultSlot, Slot } from './Slot.js';
import { ResultContainer } from './ResultContainer.js';
import { TransientCraftingContainer, type CraftingContainer } from './CraftingContainer.js';

/** Shared logic for InventoryMenu (2x2) and CraftingMenu (3x3). */
export abstract class AbstractCraftingMenu extends AbstractContainerMenu {
  readonly craftSlots: TransientCraftingContainer;
  readonly resultSlots = new ResultContainer();
  protected readonly recipeManager: RecipeManager;
  protected readonly registry: ItemRegistry;
  readonly width: number;
  readonly height: number;
  /** Stats.ITEM_CRAFTED hook wired by the game layer. */
  onCrafted?: (itemName: string, count: number) => void;
  /** Guards against re-entrant result recomputation while consuming ingredients. */
  private consuming = false;

  constructor(
    menuType: string,
    containerId: number,
    width: number,
    height: number,
    recipeManager: RecipeManager,
    registry: ItemRegistry,
  ) {
    super(menuType, containerId);
    this.width = width;
    this.height = height;
    this.recipeManager = recipeManager;
    this.registry = registry;
    this.craftSlots = new TransientCraftingContainer(this, width, height);
  }

  protected addResultSlot(x: number, y: number): ResultSlot {
    const slot = this.addSlot(new ResultSlot(this.resultSlots, 0, x, y)) as ResultSlot;
    slot.onTakeRecipe = (player) => this.consumeCraftingIngredients(player as MenuPlayer | null);
    slot.onCrafted = (name, count) => this.onCrafted?.(name, count);
    return slot;
  }

  protected addCraftingGridSlots(left: number, top: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.addSlot(new Slot(this.craftSlots, x + y * this.width, left + x * 18, top + y * 18));
      }
    }
  }

  getCraftSlots(): CraftingContainer { return this.craftSlots; }
  getGridWidth(): number { return this.width; }
  getGridHeight(): number { return this.height; }
  abstract getResultSlot(): Slot;
  abstract getInputGridSlots(): readonly Slot[];

  /** CraftingMenu.slotChangedCraftingGrid: resolve the recipe and set the result. */
  protected override onSlotsChanged(_container: unknown): void {
    this.recomputeResult();
  }

  recomputeResult(): void {
    if (this.consuming) return;
    const recipe = this.recipeManager.getRecipeFor(this.craftSlots as CraftingGrid);
    const result = recipe ? recipe.assemble(this.registry) : ItemStack.EMPTY;
    this.resultSlots.setItem(0, result);
    this.resultSlots.setRecipeUsed(recipe);
  }

  /**
   * ResultSlot.onTake: consume one item per occupied craft cell and return
   * container items (bucket / glass_bottle) into the grid or the inventory.
   */
  consumeCraftingIngredients(player: MenuPlayer | null): void {
    const pos = this.craftSlots.asPositionedCraftInput();
    const input = pos.input;
    const remaining = this.recipeManager.getRemainingItems(input);
    this.consuming = true;
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const gridIndex = x + pos.left + (y + pos.top) * this.craftSlots.getWidth();
        let itemStack = this.craftSlots.getItem(gridIndex);
        const replacement = remaining[x + y * input.width] ?? ItemStack.EMPTY;
        if (!itemStack.isEmpty()) {
          // removeItem triggers slotsChanged, suppressed by `consuming`.
          this.craftSlots.removeItem(gridIndex, 1);
          itemStack = this.craftSlots.getItem(gridIndex);
        }
        if (!replacement.isEmpty()) {
          if (itemStack.isEmpty()) {
            this.craftSlots.setItem(gridIndex, replacement);
          } else if (ItemStack.isSameItemSameComponents(itemStack, replacement)) {
            replacement.grow(itemStack.getCount());
            this.craftSlots.setItem(gridIndex, replacement);
          } else if (player) {
            if (!player.inventory.add(replacement)) player.drop(replacement);
          }
        }
      }
    }
    this.consuming = false;
    this.recomputeResult();
  }

  /** Result slots cannot be picked up by PICKUP_ALL. */
  override canTakeItemForPickAll(_carried: ItemStack, target: Slot): boolean {
    return target.container !== this.resultSlots && super.canTakeItemForPickAll(_carried, target);
  }

  /** Clears the crafting grid, returning stacks to the player. */
  clearCraftingContent(player: MenuPlayer | null): void {
    const n = this.craftSlots.getContainerSize();
    for (let i = 0; i < n; i++) {
      const stack = this.craftSlots.removeItemNoUpdate(i);
      if (!stack.isEmpty() && player) {
        player.inventory.add(stack);
        if (!stack.isEmpty()) player.drop(stack);
      }
    }
    this.resultSlots.setItem(0, ItemStack.EMPTY);
    this.recomputeResult();
  }
}
