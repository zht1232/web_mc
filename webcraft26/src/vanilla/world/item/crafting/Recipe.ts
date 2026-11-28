// Source: net.minecraft.world.item.crafting.Ingredient (26.2)
//         net.minecraft.world.item.crafting.CraftingInput / CraftingInput.Positioned
//         net.minecraft.world.item.crafting.ShapedRecipePattern
//         net.minecraft.world.item.crafting.ShapedRecipe / ShapelessRecipe
//         net.minecraft.world.item.crafting.AbstractCookingRecipe / StonecutterRecipe
//         net.minecraft.world.item.crafting.SmithingRecipe
//         net.minecraft.world.item.crafting.CraftingRecipe#getRemainingItems

import { ItemStack } from '../ItemStack.js';
import type { ItemRegistry } from '../Item.js';

function short(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Port of net.minecraft.world.item.crafting.Ingredient; `options` is already tag-expanded. */
export class Ingredient {
  readonly options: readonly string[];
  readonly raw: string;
  private readonly idSet: ReadonlySet<string>;

  constructor(raw: any) {
    this.raw = String(raw?.raw ?? '');
    const opts: string[] = Array.isArray(raw?.options) ? raw.options.map((o: string) => short(o)) : [];
    this.options = opts;
    this.idSet = new Set(opts);
  }

  test(stack: ItemStack): boolean {
    if (stack.isEmpty()) return false;
    return this.idSet.has(stack.item!.name);
  }

  /** Ingredient.testOptionalIngredient (a null ingredient requires an empty cell). */
  static testOptional(ingredient: Ingredient | null, stack: ItemStack): boolean {
    return ingredient === null ? stack.isEmpty() : ingredient.test(stack);
  }

  /** All item ids this ingredient accepts, for building the inverted recipe index. */
  ids(): readonly string[] { return this.options; }
}

/**
 * Port of net.minecraft.world.item.crafting.CraftingInput (immutable snapshot) and
 * its Positioned wrapper: ofPositioned trims empty rows/columns and reports left/top.
 */
export class CraftingInput {
  readonly width: number;
  readonly height: number;
  readonly items: readonly ItemStack[];
  readonly ingredientCount: number;

  constructor(width: number, height: number, items: readonly ItemStack[]) {
    this.width = width;
    this.height = height;
    this.items = items;
    let n = 0;
    for (let i = 0; i < items.length; i++) if (!items[i].isEmpty()) n++;
    this.ingredientCount = n;
  }

  getItem(index: number): ItemStack { return this.items[index] ?? ItemStack.EMPTY; }
  getItemXY(x: number, y: number): ItemStack { return this.items[x + y * this.width] ?? ItemStack.EMPTY; }
  size(): number { return this.items.length; }
  isEmpty(): boolean { return this.ingredientCount === 0; }
}

export interface PositionedCraftingInput {
  input: CraftingInput;
  left: number;
  top: number;
}

const EMPTY_POSITIONED: PositionedCraftingInput = {
  input: new CraftingInput(0, 0, []), left: 0, top: 0,
};

/** CraftingInput.ofPositioned: bounding-box trim of the non-empty cells. */
export function positionedOf(width: number, height: number, items: readonly ItemStack[]): PositionedCraftingInput {
  if (width === 0 || height === 0) return EMPTY_POSITIONED;
  let left = width - 1, right = 0, top = height - 1, bottom = 0;
  for (let y = 0; y < height; y++) {
    let rowEmpty = true;
    for (let x = 0; x < width; x++) {
      if (!items[x + y * width].isEmpty()) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        rowEmpty = false;
      }
    }
    if (!rowEmpty) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  const newWidth = right - left + 1;
  const newHeight = bottom - top + 1;
  if (newWidth <= 0 || newHeight <= 0) return EMPTY_POSITIONED;
  if (newWidth === width && newHeight === height) {
    return { input: new CraftingInput(width, height, items), left, top };
  }
  const trimmed: ItemStack[] = new Array(newWidth * newHeight);
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) trimmed[x + y * newWidth] = items[x + left + (y + top) * width];
  }
  return { input: new CraftingInput(newWidth, newHeight, trimmed), left, top };
}

export interface RecipeResult {
  item: string; // short name
  count: number;
}

export const RECIPE_TYPES = {
  CRAFTING_SHAPED: 'minecraft:crafting_shaped',
  CRAFTING_SHAPELESS: 'minecraft:crafting_shapeless',
  CRAFTING_IMBUE: 'minecraft:crafting_imbue',
  SMELTING: 'minecraft:smelting',
  BLASTING: 'minecraft:blasting',
  SMOKING: 'minecraft:smoking',
  CAMPFIRE_COOKING: 'minecraft:campfire_cooking',
  STONECUTTING: 'minecraft:stonecutting',
  SMITHING_TRANSFORM: 'minecraft:smithing_transform',
  SMITHING_TRIM: 'minecraft:smithing_trim',
} as const;

export function isCookingType(type: string): boolean {
  return type === RECIPE_TYPES.SMELTING || type === RECIPE_TYPES.BLASTING
    || type === RECIPE_TYPES.SMOKING || type === RECIPE_TYPES.CAMPFIRE_COOKING;
}

export interface RecipeLike {
  readonly id: string;
  readonly type: string;
  assemble(registry: ItemRegistry, input?: CraftingInput): ItemStack;
}

export function makeResult(registry: ItemRegistry, result: RecipeResult): ItemStack {
  return ItemStack.fromName(registry, result.item, result.count);
}

/** Port of net.minecraft.world.item.crafting.ShapedRecipe / ShapedRecipePattern. */
export class ShapedRecipe implements RecipeLike {
  readonly id: string;
  readonly type = RECIPE_TYPES.CRAFTING_SHAPED;
  readonly width: number;
  readonly height: number;
  readonly ingredients: readonly (Ingredient | null)[];
  readonly ingredientCount: number;
  readonly symmetrical: boolean;
  readonly result: RecipeResult;

  constructor(id: string, def: any) {
    this.id = id;
    const pattern: string[] = def.pattern ?? [];
    const key: Record<string, any> = def.key ?? {};
    this.width = pattern.length ? pattern[0].length : 0;
    this.height = pattern.length;
    const cells: (Ingredient | null)[] = new Array(this.width * this.height).fill(null);
    let count = 0;
    for (let y = 0; y < this.height; y++) {
      const row = pattern[y] ?? '';
      for (let x = 0; x < this.width; x++) {
        const ch = row[x] ?? ' ';
        if (ch !== ' ' && key[ch] !== undefined) {
          cells[x + y * this.width] = new Ingredient(key[ch]);
          count++;
        }
      }
    }
    this.ingredients = cells;
    this.ingredientCount = count;
    this.symmetrical = isSymmetrical(this.width, this.height, cells);
    this.result = { item: short(def.result?.item ?? 'air'), count: def.result?.count ?? 1 };
  }

  /** ShapedRecipePattern.matches(CraftingInput): count + size + normal/mirrored. */
  matches(input: CraftingInput): boolean {
    if (input.ingredientCount !== this.ingredientCount) return false;
    if (input.width !== this.width || input.height !== this.height) return false;
    if (!this.symmetrical && this.matchesFlipped(input, true)) return true;
    return this.matchesFlipped(input, false);
  }

  private matchesFlipped(input: CraftingInput, xFlip: boolean): boolean {
    const w = this.width, h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const expected = this.ingredients[(xFlip ? w - 1 - x : x) + y * w];
        if (!Ingredient.testOptional(expected, input.getItemXY(x, y))) return false;
      }
    }
    return true;
  }

  assemble(registry: ItemRegistry): ItemStack { return makeResult(registry, this.result); }
}

function isSymmetrical(w: number, h: number, cells: readonly (Ingredient | null)[]): boolean {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = cells[x + y * w];
      const b = cells[(w - 1 - x) + y * w];
      if (!sameIngredient(a, b)) return false;
    }
  }
  return true;
}

function sameIngredient(a: Ingredient | null, b: Ingredient | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.options.length !== b.options.length) return false;
  const sa = a.options, sb = b.options;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

// Reused scratch buffers: ShapelessRecipe.matches runs once per candidate recipe,
// so keep the matching inner loop allocation-free.
const SHAPELESS_STACKS: ItemStack[] = [];
const SHAPELESS_USED: boolean[] = [];

/** Port of net.minecraft.world.item.crafting.ShapelessRecipe (stacked-contents match). */
export class ShapelessRecipe implements RecipeLike {
  readonly id: string;
  readonly type = RECIPE_TYPES.CRAFTING_SHAPELESS;
  readonly ingredients: readonly Ingredient[];
  readonly result: RecipeResult;

  constructor(id: string, def: any) {
    this.id = id;
    this.ingredients = (def.ingredients ?? []).map((i: any) => new Ingredient(i));
    this.result = { item: short(def.result?.item ?? 'air'), count: def.result?.count ?? 1 };
  }

  /** ShapelessRecipe.matches: exact ingredient count + greedy one-to-one match. */
  matches(input: CraftingInput): boolean {
    const n = this.ingredients.length;
    if (input.ingredientCount !== n) return false;
    if (n === 0) return input.isEmpty();
    if (SHAPELESS_STACKS.length < n) SHAPELESS_STACKS.length = n;
    let count = 0;
    for (let i = 0; i < input.items.length && count < n; i++) {
      if (!input.items[i].isEmpty()) SHAPELESS_STACKS[count++] = input.items[i];
    }
    if (count !== n) return false;
    for (let i = 0; i < n; i++) SHAPELESS_USED[i] = false;
    for (let i = 0; i < n; i++) {
      let found = false;
      for (let j = 0; j < n; j++) {
        if (SHAPELESS_USED[j]) continue;
        if (this.ingredients[i].test(SHAPELESS_STACKS[j])) { SHAPELESS_USED[j] = true; found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  assemble(registry: ItemRegistry): ItemStack { return makeResult(registry, this.result); }
}

/**
 * Port of net.minecraft.world.item.crafting.ImbueRecipe: a full 3x3 grid with a
 * potion in the centre cell and eight arrows around it yields eight tipped
 * arrows carrying the potion contents of that central stack.
 */
export class ImbueRecipe implements RecipeLike {
  readonly id: string;
  readonly type = RECIPE_TYPES.CRAFTING_IMBUE;
  readonly source: Ingredient;
  readonly material: Ingredient;
  readonly result: RecipeResult;

  constructor(id: string, def: any) {
    this.id = id;
    this.source = new Ingredient(def.source);
    this.material = new Ingredient(def.material);
    this.result = { item: short(def.result?.item ?? 'air'), count: def.result?.count ?? 1 };
  }

  /** ImbueRecipe.matches: 3x3, all nine cells occupied, source in the centre. */
  matches(input: CraftingInput): boolean {
    if (input.width !== 3 || input.height !== 3 || input.ingredientCount !== 9) return false;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const stack = input.getItemXY(x, y);
        if (stack.isEmpty()) return false;
        const ingredient = x === 1 && y === 1 ? this.source : this.material;
        if (!ingredient.test(stack)) return false;
      }
    }
    return true;
  }

  /** ImbueRecipe.assemble: copy POTION_CONTENTS from the central source stack. */
  assemble(registry: ItemRegistry, input?: CraftingInput): ItemStack {
    const result = makeResult(registry, this.result);
    const source = input?.getItemXY(1, 1);
    if (source && !source.isEmpty() && source.components.potion) {
      result.components.potion = source.components.potion;
    }
    return result;
  }
}

/** Port of net.minecraft.world.item.crafting.AbstractCookingRecipe subclasses. */
export class CookingRecipe implements RecipeLike {
  readonly id: string;
  readonly type: string;
  readonly ingredient: Ingredient;
  readonly result: RecipeResult;
  readonly experience: number;
  readonly cookingTime: number;

  constructor(id: string, def: any) {
    this.id = id;
    this.type = def.type;
    this.ingredient = new Ingredient(def.ingredient);
    this.result = { item: short(def.result?.item ?? 'air'), count: def.result?.count ?? 1 };
    this.experience = Number(def.experience ?? 0);
    // recipes.json is normalized: every cooking recipe carries cookingTime.
    this.cookingTime = Number(def.cookingTime ?? 200);
  }

  matches(stack: ItemStack): boolean { return this.ingredient.test(stack); }
  assemble(registry: ItemRegistry): ItemStack { return makeResult(registry, this.result); }
}

/** Port of net.minecraft.world.item.crafting.StonecutterRecipe (SingleItemRecipe). */
export class StonecuttingRecipe implements RecipeLike {
  readonly id: string;
  readonly type = RECIPE_TYPES.STONECUTTING;
  readonly ingredient: Ingredient;
  readonly result: RecipeResult;

  constructor(id: string, def: any) {
    this.id = id;
    this.ingredient = new Ingredient(def.ingredient);
    this.result = { item: short(def.result?.item ?? 'air'), count: def.result?.count ?? 1 };
  }

  matches(stack: ItemStack): boolean { return this.ingredient.test(stack); }
  assemble(registry: ItemRegistry): ItemStack { return makeResult(registry, this.result); }
}

/** Port of net.minecraft.world.item.crafting.SmithingTransformRecipe. */
export class SmithingRecipe implements RecipeLike {
  readonly id: string;
  readonly type: string;
  readonly template: Ingredient;
  readonly base: Ingredient;
  readonly addition: Ingredient;
  readonly result: RecipeResult;

  constructor(id: string, def: any) {
    this.id = id;
    this.type = def.type;
    this.template = new Ingredient(def.template);
    this.base = new Ingredient(def.base);
    this.addition = new Ingredient(def.addition);
    this.result = { item: short(def.result?.item ?? 'air'), count: def.result?.count ?? 1 };
  }

  matches(template: ItemStack, base: ItemStack, addition: ItemStack): boolean {
    return this.template.test(template) && this.base.test(base) && this.addition.test(addition);
  }
  assemble(registry: ItemRegistry): ItemStack { return makeResult(registry, this.result); }
}

export type AnyRecipe = ShapedRecipe | ShapelessRecipe | ImbueRecipe | CookingRecipe | StonecuttingRecipe | SmithingRecipe;

/** CraftingRecipe.defaultCraftingReminder: one container remainder per occupied cell. */
export function defaultCraftingReminder(input: CraftingInput, registry: ItemRegistry): ItemStack[] {
  const out: ItemStack[] = new Array(input.size());
  for (let i = 0; i < input.size(); i++) {
    const stack = input.getItem(i);
    const remainder = stack.isEmpty() ? null : stack.item!.craftingRemainder;
    out[i] = remainder ? ItemStack.fromName(registry, remainder, 1) : ItemStack.EMPTY;
  }
  return out;
}
