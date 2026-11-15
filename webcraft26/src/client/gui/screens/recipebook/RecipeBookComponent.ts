// Port of net.minecraft.client.gui.screens.recipebook.RecipeBookComponent (26.2).
// Sources: RecipeBookComponent.java (width 147, imageHeight 166, xOffset,
// renderBackground uses the recipe_book.png sheet, 5 tab buttons, search box,
// 4x3 recipe grid, page arrows), RecipeBookPage.java, RecipeButton.java.
//
// The old implementation was a placeholder: a flat grey panel, a black search bar,
// 12 plain grey squares and a hard-coded English "Recipe Book" caption. This version
// draws the real vanilla texture sheet and sprites.

import type { GuiGraphics } from '../../GuiGraphics.js';
import type { ScreenEnv } from '../../Types.js';
import { EditBox } from '../../components/EditBox.js';

export const RECIPE_BOOK_WIDTH = 147;
export const RECIPE_BOOK_HEIGHT = 166;
export const RECIPE_BUTTON_SIZE = 18;
export const RECIPE_GRID_COLS = 4;
export const RECIPE_GRID_ROWS = 3;

export interface RecipeEntry {
  resultItemId: number;
  label: string;
}

/** RecipeBookComponent#TAB_BUTTONS order (26.2): all, crafting, furnace, blast, smoker. */
const TAB_ICONS = [
  'recipe_book/filter_disabled',
  'recipe_book/crafting_overlay',
  'recipe_book/furnace_overlay',
  'recipe_book/furnace_overlay',
  'recipe_book/furnace_overlay',
] as const;

export class RecipeBookComponent {
  private visible = false;
  private search: EditBox;
  private recipes: RecipeEntry[] = [];
  private page = 0;
  private tab = 0;

  constructor(private readonly env: ScreenEnv) {
    this.search = new EditBox(0, 0, 106, 12, '')
      .setBordered(false)
      .setMaxLength(50);
    const fromDeps = (env.deps as unknown as { recipes?: RecipeEntry[] }).recipes;
    if (Array.isArray(fromDeps)) this.recipes = fromDeps;
  }

  isVisible(): boolean { return this.visible; }
  toggle(): void { this.visible = !this.visible; }
  open(): void { this.visible = true; }
  close(): void { this.visible = false; }

  setRecipes(items: readonly RecipeEntry[]): void { this.recipes = items.slice(); this.page = 0; }

  getX(_screenWidth: number, _imageWidth: number, leftPos: number): number {
    return Math.max(0, leftPos - RECIPE_BOOK_WIDTH - 4);
  }

  render(g: GuiGraphics, x: number, y: number, mx: number, my: number): void {
    if (!this.visible) return;

    // RecipeBookComponent#renderBackground: the 147x166 panel from the 256x256 sheet.
    // The shipped texture is a 256x256 RGBA sheet with the panel in the top-left.
    g.blitScaled('gui/recipe_book', x, y, RECIPE_BOOK_WIDTH, RECIPE_BOOK_HEIGHT,
      0, 0, RECIPE_BOOK_WIDTH, RECIPE_BOOK_HEIGHT, 256, 256);

    // Title row + the 5 filter tabs (RecipeBookTabButton). Tabs sit on the top edge.
    const hint = this.env.t('gui.recipebook.search_hint');
    this.search.setHint(hint && hint !== 'gui.recipebook.search_hint' ? hint : '搜索…');
    this.search.setPosition(x + 25, y + 13);
    this.search.render(g, mx, my, 0);

    for (let i = 0; i < 5; i++) {
      const tx = x + 9 + i * 26;
      const ty = y - 12;
      const selected = i === this.tab;
      g.blitSprite(selected ? 'recipe_book/tab_selected' : 'recipe_book/tab', tx, ty, 26, 32);
      g.blitSprite(TAB_ICONS[i], tx + 5, ty + 8, 16, 16);
    }

    // RecipeBookPage: 4x3 grid of 18px slot sprites.
    const perPage = RECIPE_GRID_COLS * RECIPE_GRID_ROWS;
    const start = this.page * perPage;
    for (let i = 0; i < perPage; i++) {
      const recipe = this.recipes[start + i];
      const col = i % RECIPE_GRID_COLS;
      const row = Math.floor(i / RECIPE_GRID_COLS);
      const rx = x + 11 + col * 25;
      const ry = y + 34 + row * 25;
      g.blitSprite(recipe ? 'recipe_book/slot_craftable' : 'recipe_book/slot_uncraftable', rx, ry, 18, 18);
      if (recipe) g.renderItem(recipe.resultItemId, rx + 1, ry + 1, 16);
    }

    // Page arrows + "n/m" caption (RecipeBookComponent#render).
    const pages = Math.max(1, Math.ceil(this.recipes.length / perPage));
    const canBack = this.page > 0;
    const canFwd = this.page + 1 < pages;
    g.blitSprite(canBack ? 'recipe_book/page_backward_highlighted' : 'recipe_book/page_backward', x + 36, y + 137, 12, 17);
    const pageText = String(this.env.t('gui.recipebook.page'))
      .replace('%s', String(this.page + 1)).replace('%s', String(pages));
    g.drawCenteredString(pageText, x + 73, y + 141, 0xff404040, false);
    g.blitSprite(canFwd ? 'recipe_book/page_forward_highlighted' : 'recipe_book/page_forward', x + 96, y + 137, 12, 17);
  }

  mouseClicked(mx: number, my: number, button: number, x: number, y: number): boolean {
    if (!this.visible) return false;
    if (this.search.mouseClicked(mx, my, button)) return true;
    // tab strip
    for (let i = 0; i < 5; i++) {
      const tx = x + 9 + i * 26;
      if (mx >= tx && mx < tx + 26 && my >= y - 12 && my < y + 20) {
        this.tab = i; this.page = 0; return true;
      }
    }
    const perPage = RECIPE_GRID_COLS * RECIPE_GRID_ROWS;
    if (my >= y + 137 && my < y + 154) {
      if (mx >= x + 36 && mx < x + 48 && this.page > 0) { this.page--; return true; }
      if (mx >= x + 96 && mx < x + 108 && (this.page + 1) * perPage < this.recipes.length) { this.page++; return true; }
    }
    for (let i = 0; i < perPage; i++) {
      const rx = x + 11 + (i % RECIPE_GRID_COLS) * 25;
      const ry = y + 34 + Math.floor(i / RECIPE_GRID_COLS) * 25;
      if (mx >= rx && mx < rx + 18 && my >= ry && my < ry + 18) {
        const recipe = this.recipes[this.page * perPage + i];
        if (recipe) this.env.toast(recipe.label);
        return true;
      }
    }
    return false;
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    return this.visible && this.search.keyPressed(code, char, mods);
  }

  charTyped(ch: string, mods: number): boolean {
    return this.visible && this.search.charTyped(ch, mods);
  }

  tick(): void { if (this.visible) this.search.tick(); }
}
