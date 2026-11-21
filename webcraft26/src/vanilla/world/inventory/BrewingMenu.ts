// Source: net.minecraft.world.inventory.BrewingStandMenu (26.2)
//         net.minecraft.world.level.block.entity.BrewingStandBlockEntity#serverTick
//         net.minecraft.world.item.alchemy.PotionBrewing
//
// Five container slots (three potions, ingredient, blaze-powder fuel), the
// 400-tick brew timer and the 20-point fuel buffer. The client has no block
// entity ticker, so the menu itself advances one 20 Hz step while its GUI is
// open (same stand-in as FurnaceMenu).

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import { AbstractContainerMenu, type MenuPlayer } from './AbstractContainerMenu.js';
import { SimpleContainer } from './Container.js';
import { Slot } from './Slot.js';
import { MenuType } from './MenuType.js';
import {
  BREWING_INGREDIENTS, POTION_ITEMS, brewResult,
} from '../item/potion/Potions.js';

export const BREW_TIME = 400;
export const FUEL_PER_POWDER = 20;

function potionId(stack: ItemStack): string | undefined {
  return stack.components.potion;
}

/** PotionSlot: potions, splash/lingering potions and empty glass bottles. */
class PotionSlot extends Slot {
  override mayPlace(stack: ItemStack): boolean {
    if (stack.isEmpty() || !stack.item) return false;
    return POTION_ITEMS.has(stack.item.name) || stack.item.name === 'glass_bottle';
  }
  override getMaxStackSize(): number { return 1; }
}

/** IngredientSlot: any registered brewing ingredient. */
class IngredientSlot extends Slot {
  override mayPlace(stack: ItemStack): boolean {
    return !stack.isEmpty() && !!stack.item && BREWING_INGREDIENTS.has(stack.item.name);
  }
}

/** FuelSlot: only blaze powder. */
class FuelSlot extends Slot {
  override mayPlace(stack: ItemStack): boolean {
    return !stack.isEmpty() && stack.item?.name === 'blaze_powder';
  }
}

export class BrewingMenu extends AbstractContainerMenu {
  readonly container = new SimpleContainer(5);
  /** Remaining brew ticks (0..400); data slot 0. */
  brewingTicks = 0;
  /** Remaining fuel (0..20); data slot 1. */
  fuel = 0;
  /** Sound + stats hook wired by Game (position of the stand). */
  onBrew?: () => void;

  private readonly registry: ItemRegistry;
  private brewIngredient = '';

  constructor(containerId: number, playerInventory: PlayerInventory, registry: ItemRegistry) {
    super(MenuType.BREWING, containerId);
    this.registry = registry;
    this.addSlot(new PotionSlot(this.container, 0, 56, 51));
    this.addSlot(new PotionSlot(this.container, 1, 79, 58));
    this.addSlot(new PotionSlot(this.container, 2, 102, 51));
    this.addSlot(new IngredientSlot(this.container, 3, 79, 17));
    this.addSlot(new FuelSlot(this.container, 4, 17, 17));
    this.addStandardInventorySlots(playerInventory, 8, 84);
  }

  /** BrewingStandBlockEntity.serverTick, one 20 Hz step. */
  tick(): void {
    const ingredient = this.container.getItem(3);
    const ingredientName = ingredient.isEmpty() ? '' : (ingredient.item?.name ?? '');
    const canBrew = this.canBrew();
    if (this.fuel <= 0) {
      const fuelStack = this.container.getItem(4);
      if (!fuelStack.isEmpty() && fuelStack.item?.name === 'blaze_powder') {
        fuelStack.shrink(1);
        if (fuelStack.isEmpty()) this.container.setItem(4, ItemStack.EMPTY);
        this.fuel = FUEL_PER_POWDER;
      }
    }
    if (this.brewingTicks > 0) {
      if (!canBrew || ingredientName !== this.brewIngredient) {
        this.brewingTicks = 0;
        this.brewIngredient = '';
        return;
      }
      this.brewingTicks--;
      if (this.brewingTicks <= 0) {
        this.brewingTicks = 0;
        this.doBrew(ingredientName);
        this.brewIngredient = '';
        this.onBrew?.();
      }
      return;
    }
    if (this.fuel > 0 && canBrew) {
      this.fuel--;
      this.brewingTicks = BREW_TIME;
      this.brewIngredient = ingredientName;
    }
  }

  /** BrewingStandBlockEntity.canBrew / isBrewable. */
  private canBrew(): boolean {
    const ingredient = this.container.getItem(3);
    if (ingredient.isEmpty() || !ingredient.item) return false;
    if (!BREWING_INGREDIENTS.has(ingredient.item.name)) return false;
    for (let i = 0; i < 3; i++) {
      const stack = this.container.getItem(i);
      if (stack.isEmpty() || !stack.item || !POTION_ITEMS.has(stack.item.name)) continue;
      if (brewResult(potionId(stack), ingredient.item.name, stack.item.name as 'potion' | 'splash_potion' | 'lingering_potion')) return true;
    }
    return false;
  }

  /** BrewingStandBlockEntity.doBrew: mix every potion slot, consume one ingredient. */
  private doBrew(ingredientName: string): void {
    for (let i = 0; i < 3; i++) {
      const stack = this.container.getItem(i);
      if (stack.isEmpty() || !stack.item || !POTION_ITEMS.has(stack.item.name)) continue;
      const result = brewResult(potionId(stack), ingredientName, stack.item.name as 'potion' | 'splash_potion' | 'lingering_potion');
      if (!result) continue;
      const item = this.registry.byName(result.item);
      if (!item) continue;
      this.container.setItem(i, new ItemStack(item, 1, { potion: result.potion }));
    }
    const ingredient = this.container.getItem(3);
    ingredient.shrink(1);
    if (ingredient.isEmpty()) this.container.setItem(3, ItemStack.EMPTY);
  }

  /** GUI snapshot for BrewingScreen (progress 0..400, fuel 0..20). */
  brewInfo(): { progress: number; fuel: number } {
    return { progress: this.brewingTicks, fuel: this.fuel };
  }

  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return ItemStack.EMPTY;
    const stack = slot.getItem();
    const clicked = stack.copy();
    if (slotIndex < 5) {
      if (!this.moveItemStackTo(stack, 5, 41, true)) return ItemStack.EMPTY;
    } else if (stack.item && BREWING_INGREDIENTS.has(stack.item.name)) {
      if (!this.moveItemStackTo(stack, 3, 4, false)) return ItemStack.EMPTY;
    } else if (stack.item?.name === 'blaze_powder') {
      if (!this.moveItemStackTo(stack, 4, 5, false)) return ItemStack.EMPTY;
    } else if (stack.item && (POTION_ITEMS.has(stack.item.name) || stack.item.name === 'glass_bottle')) {
      if (!this.moveItemStackTo(stack, 0, 3, false)) return ItemStack.EMPTY;
    } else if (slotIndex >= 5 && slotIndex < 32) {
      if (!this.moveItemStackTo(stack, 32, 41, false)) return ItemStack.EMPTY;
    } else if (slotIndex >= 32 && slotIndex < 41
      && !this.moveItemStackTo(stack, 5, 32, false)) {
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
