// Source: net.minecraft.world.item.crafting.RecipeManager (26.2)
//         net.minecraft.world.item.crafting.RecipeMap / RecipeCache
//
// Loads recipes.json (object keyed by recipe id, 1585 entries, `options` already
// tag-expanded). All lookups go through inverted indexes + a result cache; no call
// scans the full recipe list linearly.

import type { ItemRegistry } from '../Item.js';
import { ItemStack } from '../ItemStack.js';
import {
  Ingredient, positionedOf, isCookingType, RECIPE_TYPES, defaultCraftingReminder,
  ShapedRecipe, ShapelessRecipe, CookingRecipe, StonecuttingRecipe, SmithingRecipe,
  type AnyRecipe, type CraftingInput, type PositionedCraftingInput,
} from './Recipe.js';

/** Minimal view of a CraftingContainer (world/inventory/CraftingContainer.ts). */
export interface CraftingGrid {
  getWidth(): number;
  getHeight(): number;
  getItems(): readonly ItemStack[];
}

type CraftingRecipe = ShapedRecipe | ShapelessRecipe;

export class RecipeManager {
  readonly registry: ItemRegistry;
  readonly all: AnyRecipe[] = [];
  private readonly byId = new Map<string, AnyRecipe>();
  /** Inverted index: item id -> crafting recipes that use it in any cell. */
  private readonly craftingByItem = new Map<string, CraftingRecipe[]>();
  private readonly cookingByItem = new Map<string, CookingRecipe[]>();
  private readonly stonecuttingByItem = new Map<string, StonecuttingRecipe[]>();
  private readonly smithingByBase = new Map<string, SmithingRecipe[]>();
  private readonly craftingCache = new Map<string, CraftingRecipe | null>();

  constructor(json: any, registry: ItemRegistry) {
    this.registry = registry;
    const entries: Array<[string, any]> = json && typeof json === 'object' && !Array.isArray(json)
      ? Object.entries(json)
      : Array.isArray(json) ? json.map((r: any, i: number) => [String(r.id ?? i), r] as [string, any]) : [];

    for (const [id, def] of entries) {
      const type = String(def?.type ?? '');
      let recipe: AnyRecipe | null = null;
      if (type === RECIPE_TYPES.CRAFTING_SHAPED) recipe = new ShapedRecipe(id, def);
      else if (type === RECIPE_TYPES.CRAFTING_SHAPELESS) recipe = new ShapelessRecipe(id, def);
      else if (isCookingType(type)) recipe = new CookingRecipe(id, def);
      else if (type === RECIPE_TYPES.STONECUTTING) recipe = new StonecuttingRecipe(id, def);
      else if (type === RECIPE_TYPES.SMITHING_TRANSFORM || type === RECIPE_TYPES.SMITHING_TRIM) recipe = new SmithingRecipe(id, def);
      if (!recipe) continue; // crafting_special_* / transmute etc. are data-driven, handled elsewhere
      this.all.push(recipe);
      this.byId.set(id, recipe);
      this.index(recipe);
    }
  }

  private addToIndex<K>(map: Map<string, K[]>, key: string, value: K): void {
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push(value);
  }

  private index(recipe: AnyRecipe): void {
    if (recipe instanceof ShapedRecipe) {
      for (const cell of recipe.ingredients) {
        if (!cell) continue;
        for (const id of cell.ids()) this.addToIndex(this.craftingByItem, id, recipe);
      }
    } else if (recipe instanceof ShapelessRecipe) {
      for (const ing of recipe.ingredients) {
        for (const id of ing.ids()) this.addToIndex(this.craftingByItem, id, recipe);
      }
    } else if (recipe instanceof CookingRecipe) {
      for (const id of recipe.ingredient.ids()) this.addToIndex(this.cookingByItem, id, recipe);
    } else if (recipe instanceof StonecuttingRecipe) {
      for (const id of recipe.ingredient.ids()) this.addToIndex(this.stonecuttingByItem, id, recipe);
    } else if (recipe instanceof SmithingRecipe) {
      for (const id of recipe.base.ids()) this.addToIndex(this.smithingByBase, id, recipe);
    }
  }

  // ---- crafting -----------------------------------------------------------

  /** RecipeManager.getRecipeFor(CRAFTING, input, level). Returns the first match. */
  getRecipeFor(container: CraftingGrid, _level?: unknown): CraftingRecipe | null {
    const pos = positionedOf(container.getWidth(), container.getHeight(), container.getItems());
    return this.matchCraftingInput(pos);
  }

  /** Convenience for callers that already hold a positioned input. */
  getRecipeForInput(input: CraftingInput): CraftingRecipe | null {
    return this.matchCraftingInput({ input, left: 0, top: 0 });
  }

  private cacheKey(input: CraftingInput): string {
    let key = `${input.width}x${input.height}|`;
    for (let i = 0; i < input.items.length; i++) {
      const s = input.items[i];
      key += s.isEmpty() ? '_' : s.item!.name;
      key += ',';
    }
    return key;
  }

  private matchCraftingInput(pos: PositionedCraftingInput): CraftingRecipe | null {
    const input = pos.input;
    if (input.isEmpty()) return null;
    const key = this.cacheKey(input);
    const cached = this.craftingCache.get(key);
    if (cached !== undefined) return cached;

    // Pick the most discriminating grid item; a matching recipe must be indexed
    // under every non-empty grid item, so any one of them is a complete candidate set.
    let best: CraftingRecipe[] | undefined;
    for (let i = 0; i < input.items.length; i++) {
      const s = input.items[i];
      if (s.isEmpty()) continue;
      const cand = this.craftingByItem.get(s.item!.name);
      if (!cand) { this.craftingCache.set(key, null); return null; }
      if (best === undefined || cand.length < best.length) best = cand;
    }
    if (!best) { this.craftingCache.set(key, null); return null; }

    let result: CraftingRecipe | null = null;
    for (let i = 0; i < best.length; i++) {
      const r = best[i];
      if (r instanceof ShapedRecipe) {
        if (r.matches(input)) { result = r; break; }
      } else if (r.matches(input)) { result = r; break; }
    }
    if (this.craftingCache.size > 4096) this.craftingCache.clear();
    this.craftingCache.set(key, result);
    return result;
  }

  /** CraftingRecipe.getRemainingItems: bucket/bottle container returns. */
  getRemainingItems(input: CraftingInput, _level?: unknown): ItemStack[] {
    return defaultCraftingReminder(input, this.registry);
  }

  // ---- single-ingredient recipe types -------------------------------------

  /** Returns the first cooking recipe for a stack, optionally of one type. */
  getCookingRecipe(ingredient: ItemStack, type?: string): CookingRecipe | null {
    if (ingredient.isEmpty()) return null;
    const cand = this.cookingByItem.get(ingredient.item!.name);
    if (!cand) return null;
    for (let i = 0; i < cand.length; i++) {
      if (type !== undefined && cand[i].type !== type) continue;
      if (cand[i].matches(ingredient)) return cand[i];
    }
    return null;
  }

  getSmeltingRecipe(ingredient: ItemStack): CookingRecipe | null {
    return this.getCookingRecipe(ingredient, RECIPE_TYPES.SMELTING);
  }

  getStonecuttingRecipe(ingredient: ItemStack): StonecuttingRecipe | null {
    if (ingredient.isEmpty()) return null;
    const cand = this.stonecuttingByItem.get(ingredient.item!.name);
    if (!cand) return null;
    for (let i = 0; i < cand.length; i++) if (cand[i].matches(ingredient)) return cand[i];
    return null;
  }

  getSmithingRecipe(template: ItemStack, base: ItemStack, addition: ItemStack): SmithingRecipe | null {
    if (base.isEmpty()) return null;
    const cand = this.smithingByBase.get(base.item!.name);
    if (!cand) return null;
    for (let i = 0; i < cand.length; i++) if (cand[i].matches(template, base, addition)) return cand[i];
    return null;
  }

  // ---- accessors ----------------------------------------------------------

  getRecipeById(id: string): AnyRecipe | undefined { return this.byId.get(id); }
  recipeCount(): number { return this.all.length; }
  cookingRecipesFor(item: ItemStack): readonly CookingRecipe[] {
    if (item.isEmpty()) return [];
    return this.cookingByItem.get(item.item!.name) ?? [];
  }
  stonecuttingRecipesFor(item: ItemStack): readonly StonecuttingRecipe[] {
    if (item.isEmpty()) return [];
    return this.stonecuttingByItem.get(item.item!.name) ?? [];
  }
  craftingIndexSize(): number { return this.craftingByItem.size; }
  cacheSize(): number { return this.craftingCache.size; }
}

export { Ingredient };
