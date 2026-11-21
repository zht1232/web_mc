// Source: net.minecraft.world.level.block.entity.FuelValues (26.2)
//         net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity#serverTick
//         net.minecraft.world.inventory.AbstractFurnaceMenu (26.2)
//         net.minecraft.world.inventory.FurnaceMenu

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';
import type { RecipeManager } from '../item/crafting/RecipeManager.js';
import type { CookingRecipe } from '../item/crafting/Recipe.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import type { MenuPlayer } from './AbstractContainerMenu.js';
import { AbstractContainerMenu } from './AbstractContainerMenu.js';
import { SimpleContainer, SimpleContainerData, type ContainerData } from './Container.js';
import { FurnaceFuelSlot, FurnaceResultSlot, Slot } from './Slot.js';
import { stripNamespace } from '../item/MiningTool.js';

const BURN_UNIT = 200;

/** Port of FuelValues.vanillaBurnTimes(registries, flags, 200). */
export class FuelValues {
  private readonly values = new Map<string, number>();

  constructor(itemTags: any) {
    const table: Record<string, string[]> = (itemTags && itemTags.item) ? itemTags.item : (itemTags ?? {});
    const addTag = (name: string, time: number) => {
      const arr = table[`minecraft:${name}`] ?? table[name];
      if (!Array.isArray(arr)) return;
      for (const v of arr) this.values.set(stripNamespace(v), time);
    };
    const addItem = (name: string, time: number) => this.values.set(name, time);

    addItem('lava_bucket', BURN_UNIT * 100);
    addItem('coal_block', BURN_UNIT * 8 * 10);
    addItem('blaze_rod', BURN_UNIT * 12);
    addItem('coal', BURN_UNIT * 8);
    addItem('charcoal', BURN_UNIT * 8);
    addTag('logs', BURN_UNIT * 3 / 2);
    addTag('bamboo_blocks', BURN_UNIT * 3 / 2);
    addTag('planks', BURN_UNIT * 3 / 2);
    addItem('bamboo_mosaic', BURN_UNIT * 3 / 2);
    addTag('wooden_stairs', BURN_UNIT * 3 / 2);
    addItem('bamboo_mosaic_stairs', BURN_UNIT * 3 / 2);
    addTag('wooden_slabs', BURN_UNIT * 3 / 4);
    addItem('bamboo_mosaic_slab', BURN_UNIT * 3 / 4);
    addTag('wooden_trapdoors', BURN_UNIT * 3 / 2);
    addTag('wooden_pressure_plates', BURN_UNIT * 3 / 2);
    addTag('wooden_shelves', BURN_UNIT * 3 / 2);
    addTag('wooden_fences', BURN_UNIT * 3 / 2);
    addTag('fence_gates', BURN_UNIT * 3 / 2);
    for (const n of ['note_block', 'bookshelf', 'chiseled_bookshelf', 'lectern', 'jukebox',
      'chest', 'trapped_chest', 'crafting_table', 'daylight_detector', 'ladder', 'loom', 'barrel',
      'cartography_table', 'fletching_table', 'smithing_table', 'composter']) addItem(n, BURN_UNIT * 3 / 2);
    addTag('banners', BURN_UNIT * 3 / 2);
    addItem('bow', BURN_UNIT * 3 / 2);
    addItem('fishing_rod', BURN_UNIT * 3 / 2);
    addTag('signs', BURN_UNIT);
    addTag('hanging_signs', BURN_UNIT * 4);
    for (const n of ['wooden_shovel', 'wooden_sword', 'wooden_spear', 'wooden_hoe',
      'wooden_axe', 'wooden_pickaxe']) addItem(n, BURN_UNIT);
    addTag('wooden_doors', BURN_UNIT);
    addTag('boats', BURN_UNIT * 6);
    addTag('wool', BURN_UNIT / 2);
    addTag('wooden_buttons', BURN_UNIT / 2);
    addItem('stick', BURN_UNIT / 2);
    addTag('saplings', BURN_UNIT / 2);
    addItem('bowl', BURN_UNIT / 2);
    addTag('wool_carpets', 1 + BURN_UNIT / 3);
    addItem('dried_kelp_block', 1 + BURN_UNIT * 20);
    addItem('crossbow', BURN_UNIT * 3 / 2);
    addItem('bamboo', BURN_UNIT / 4);
    addItem('dead_bush', BURN_UNIT / 2);
    addItem('short_dry_grass', BURN_UNIT / 2);
    addItem('tall_dry_grass', BURN_UNIT / 2);
    addItem('scaffolding', BURN_UNIT / 4);
    addItem('azalea', BURN_UNIT / 2);
    addItem('flowering_azalea', BURN_UNIT / 2);
    addItem('mangrove_roots', BURN_UNIT * 3 / 2);
    addItem('leaf_litter', BURN_UNIT / 2);
    // FuelValues.Builder.remove(ItemTags.NON_FLAMMABLE_WOOD)
    const nonFlam = table['minecraft:non_flammable_wood'] ?? table['non_flammable_wood'];
    if (Array.isArray(nonFlam)) for (const v of nonFlam) this.values.delete(stripNamespace(v));
  }

  isFuel(stack: ItemStack): boolean {
    return !stack.isEmpty() && this.values.has(stack.item!.name);
  }
  burnDuration(stack: ItemStack): number {
    return stack.isEmpty() ? 0 : (this.values.get(stack.item!.name) ?? 0);
  }
}

export const FURNACE_INGREDIENT_SLOT = 0;
export const FURNACE_FUEL_SLOT = 1;
export const FURNACE_RESULT_SLOT = 2;
export const FURNACE_INV_START = 3;
export const FURNACE_INV_END = 30;
export const FURNACE_HOTBAR_START = 30;
export const FURNACE_HOTBAR_END = 39;

/** Port of AbstractFurnaceMenu + AbstractFurnaceBlockEntity.serverTick. */
export abstract class AbstractFurnaceMenu extends AbstractContainerMenu {
  readonly container: SimpleContainer;
  readonly data: ContainerData;
  protected readonly fuelValues: FuelValues;
  protected readonly recipeManager: RecipeManager;
  protected readonly registry: ItemRegistry;
  /** Recipe type filter ("minecraft:smelting" for FurnaceMenu). */
  protected readonly recipeType: string;

  private litTimeRemaining = 0;
  private litTotalTime = 0;
  private cookingTimer = 0;
  private cookingTotalTime = 0;
  private lastIngredientName = '';
  /** Accumulated (recipeId -> times crafted) for experience payout. */
  private readonly recipesUsed = new Map<string, { count: number; experience: number }>();
  private storedExperience = 0;

  /** Set by SurvivalState to route smelting XP into the player. */
  onExperience?: (points: number) => void;
  /** Stats.ITEM_CRAFTED hook wired by the game layer. */
  onCrafted?: (itemName: string, count: number) => void;

  constructor(
    menuType: string,
    recipeType: string,
    containerId: number,
    playerInventory: PlayerInventory,
    recipeManager: RecipeManager,
    registry: ItemRegistry,
    itemTags: unknown,
  ) {
    super(menuType, containerId);
    this.recipeType = recipeType;
    this.recipeManager = recipeManager;
    this.registry = registry;
    this.fuelValues = new FuelValues(itemTags);
    this.container = new SimpleContainer(3);
    this.data = new SimpleContainerData(4);

    this.addSlot(new Slot(this.container, 0, 56, 17));
    this.addSlot(new FurnaceFuelSlot(this.container, 1, 56, 53, (s) => this.fuelValues.isFuel(s)));
    const result = new FurnaceResultSlot(this.container, 2, 116, 35, () => this.popExperience());
    result.onCrafted = (name, count) => this.onCrafted?.(name, count);
    this.addSlot(result);
    this.addStandardInventorySlots(playerInventory, 8, 84);
    this.addDataSlots(this.data);
  }

  private popExperience(): void {
    const points = this.awardUsedRecipesAndPopExperience();
    if (points > 0 && this.onExperience) this.onExperience(points);
  }

  // ---- furnace state ------------------------------------------------------

  getLitProgress(): number {
    const duration = this.litTotalTime === 0 ? 200 : this.litTotalTime;
    return Math.max(0, Math.min(this.litTimeRemaining / duration, 1));
  }
  getBurnProgress(): number {
    return this.cookingTotalTime !== 0 && this.cookingTimer !== 0
      ? Math.max(0, Math.min(this.cookingTimer / this.cookingTotalTime, 1)) : 0;
  }
  isLit(): boolean { return this.litTimeRemaining > 0; }
  getLitTimeRemaining(): number { return this.litTimeRemaining; }
  getLitTotalTime(): number { return this.litTotalTime; }
  getCookingTimer(): number { return this.cookingTimer; }
  getCookingTotalTime(): number { return this.cookingTotalTime; }
  isFuel(stack: ItemStack): boolean { return this.fuelValues.isFuel(stack); }
  canSmelt(stack: ItemStack): boolean {
    return this.recipeManager.getCookingRecipe(stack, this.recipeType) !== null;
  }

  /** AbstractFurnaceBlockEntity.serverTick, one 20 Hz step. */
  tick(): void {
    // setItem(slot 0) in the block entity resets cook time for a new ingredient.
    const ingredient = this.container.getItem(0);
    const ingName = ingredient.isEmpty() ? '' : ingredient.item!.name;
    if (ingName !== this.lastIngredientName || this.cookingTotalTime === 0) {
      const r = this.recipeManager.getCookingRecipe(ingredient, this.recipeType);
      this.cookingTotalTime = r ? r.cookingTime : 200;
      this.cookingTimer = 0;
      this.lastIngredientName = ingName;
    }

    let wasLit = false;
    let isLit = false;
    if (this.litTimeRemaining > 0) {
      wasLit = true;
      this.litTimeRemaining--;
      isLit = this.litTimeRemaining > 0;
    }
    const fuel = this.container.getItem(1);
    const hasIngredient = !ingredient.isEmpty();
    const hasFuel = !fuel.isEmpty();

    if (isLit || (hasFuel && hasIngredient)) {
      if (hasIngredient) {
        const recipe = this.recipeManager.getCookingRecipe(ingredient, this.recipeType);
        if (recipe) {
          const burnResult = recipe.assemble(this.registry);
          if (!burnResult.isEmpty() && this.canBurn(burnResult)) {
            if (!isLit) {
              const newLitTime = this.fuelValues.burnDuration(fuel);
              this.litTimeRemaining = newLitTime;
              this.litTotalTime = newLitTime;
              if (newLitTime > 0) { this.consumeFuel(fuel); isLit = true; }
            }
            if (isLit) {
              this.cookingTimer++;
              if (this.cookingTimer === this.cookingTotalTime) {
                this.cookingTimer = 0;
                this.cookingTotalTime = recipe.cookingTime;
                this.burn(ingredient, burnResult);
                this.setRecipeUsed(recipe);
              }
            } else {
              this.cookingTimer = 0;
            }
          } else {
            this.cookingTimer = 0;
          }
        } else {
          this.cookingTimer = 0;
        }
      } else {
        this.cookingTimer = 0;
      }
    } else if (this.cookingTimer > 0) {
      this.cookingTimer = Math.max(0, Math.min(this.cookingTimer - 2, this.cookingTotalTime));
    }
    void wasLit; // kept for parity with the block-entity LIT flag transition
    this.syncData();
  }

  private canBurn(burnResult: ItemStack): boolean {
    const resultStack = this.container.getItem(2);
    if (resultStack.isEmpty()) return true;
    if (!ItemStack.isSameItemSameComponents(resultStack, burnResult)) return false;
    const max = Math.min(this.container.getMaxStackSize(), burnResult.getMaxStackSize());
    return resultStack.getCount() + burnResult.getCount() <= max;
  }

  private consumeFuel(fuel: ItemStack): void {
    const remainder = fuel.item ? fuel.item.craftingRemainder : null;
    fuel.shrink(1);
    if (fuel.isEmpty()) {
      this.container.setItem(1, remainder ? ItemStack.fromName(this.registry, remainder, 1) : ItemStack.EMPTY);
    }
  }

  private burn(ingredient: ItemStack, result: ItemStack): void {
    const resultStack = this.container.getItem(2);
    if (resultStack.isEmpty()) this.container.setItem(2, result.copy());
    else resultStack.grow(result.getCount());
    if (ingredient.is('wet_sponge')) {
      const fuel = this.container.getItem(1);
      if (!fuel.isEmpty() && fuel.is('bucket')) this.container.setItem(1, ItemStack.fromName(this.registry, 'water_bucket', 1));
    }
    ingredient.shrink(1);
  }

  private setRecipeUsed(recipe: CookingRecipe): void {
    const entry = this.recipesUsed.get(recipe.id);
    if (entry) entry.count++;
    else this.recipesUsed.set(recipe.id, { count: 1, experience: recipe.experience });
  }

  /** AbstractFurnaceBlockEntity.createExperience, deterministic (no random fraction rounding here). */
  awardUsedRecipesAndPopExperience(): number {
    let total = 0;
    for (const e of this.recipesUsed.values()) total += Math.floor(e.count * e.experience);
    this.storedExperience += total;
    this.recipesUsed.clear();
    return total;
  }
  getStoredExperience(): number { return this.storedExperience; }

  private syncData(): void {
    this.data.set(0, this.litTimeRemaining);
    this.data.set(1, this.litTotalTime);
    this.data.set(2, this.cookingTimer);
    this.data.set(3, this.cookingTotalTime);
  }

  // ---- menu behaviour -----------------------------------------------------

  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    let clicked = ItemStack.EMPTY;
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return clicked;
    const stack = slot.getItem();
    clicked = stack.copy();
    if (slotIndex === FURNACE_RESULT_SLOT) {
      if (!this.moveItemStackTo(stack, FURNACE_INV_START, FURNACE_HOTBAR_END, true)) return ItemStack.EMPTY;
      slot.onQuickCraft(stack, clicked);
    } else if (slotIndex !== FURNACE_FUEL_SLOT && slotIndex !== FURNACE_INGREDIENT_SLOT) {
      if (this.canSmelt(stack)) {
        if (!this.moveItemStackTo(stack, 0, 1, false)) return ItemStack.EMPTY;
      } else if (this.isFuel(stack)) {
        if (!this.moveItemStackTo(stack, 1, 2, false)) return ItemStack.EMPTY;
      } else if (slotIndex >= FURNACE_INV_START && slotIndex < FURNACE_INV_END) {
        if (!this.moveItemStackTo(stack, FURNACE_HOTBAR_START, FURNACE_HOTBAR_END, false)) return ItemStack.EMPTY;
      } else if (slotIndex >= FURNACE_HOTBAR_START && slotIndex < FURNACE_HOTBAR_END
        && !this.moveItemStackTo(stack, FURNACE_INV_START, FURNACE_INV_END, false)) {
        return ItemStack.EMPTY;
      }
    } else if (!this.moveItemStackTo(stack, FURNACE_INV_START, FURNACE_HOTBAR_END, false)) {
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
