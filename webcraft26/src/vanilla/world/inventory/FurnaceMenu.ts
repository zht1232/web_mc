// Source: net.minecraft.world.inventory.FurnaceMenu (26.2)

import type { ItemRegistry } from '../item/Item.js';
import type { RecipeManager } from '../item/crafting/RecipeManager.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import { AbstractFurnaceMenu } from './AbstractFurnaceMenu.js';
import { MenuType } from './MenuType.js';
import { RECIPE_TYPES } from '../item/crafting/Recipe.js';

export class FurnaceMenu extends AbstractFurnaceMenu {
  constructor(
    containerId: number,
    playerInventory: PlayerInventory,
    recipeManager: RecipeManager,
    registry: ItemRegistry,
    itemTags: unknown,
  ) {
    super(MenuType.FURNACE, RECIPE_TYPES.SMELTING, containerId, playerInventory, recipeManager, registry, itemTags);
  }
}
