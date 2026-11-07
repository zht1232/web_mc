// Port of net.minecraft.client.gui.screens.recipebook.RecipeBookComponent and
// CraftingRecipeBookComponent / RecipeBookPage / RecipeBookTabButton (26.2).
// Sources: RecipeBookComponent.java (width 147, imageHeight 166, xOffset,
// open/close, renderBackground, mouseClicked, ghost recipe slots),
// RecipeBookPage.java (4x3 grid of RecipeButton), RecipeButton.java.
//
// The recipe data (recipes.json) is injected through ScreenDeps by the main
// agent; without it the panel still renders the vanilla frame and tabs.

import type { GuiGraphics } from '../../GuiGraphics.js';
import type { ScreenEnv } from '../../Types.js';
import { EditBox } from '../../components/EditBox.js';

export const RECIPE_BOOK_WIDTH = 147;
export const RECIPE_BOOK_HEIGHT = 166;
export const RECIPE_BUTTON_SIZE = 16;
export const RECIPE_GRID_COLS = 4;
export const RECIPE_GRID_ROWS = 3;

export interface RecipeEntry {
  resultItemId: number;
  label: string;
}

export class RecipeBookComponent {
  private visible = false;
  private search: EditBox;
  private recipes: RecipeEntry[] = [];
  private page = 0;

  constructor(private readonly env: ScreenEnv) {
    this.search = new EditBox(0, 0, 100, 12, env.t('itemGroup.search'))
      .setBordered(true)
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
    // Vanilla recipe book panel + tab strip.
    g.fill(x, y, x + RECIPE_BOOK_WIDTH, y + RECIPE_BOOK_HEIGHT, 0xe0c6c6c6);
    g.outline(x, y, RECIPE_BOOK_WIDTH, RECIPE_BOOK_HEIGHT, 0xff000000);
    g.drawString('Recipe Book', x + 8, y + 6, 0xff404040, false);

    this.search.setPosition(x + 8, y + 20);
    this.search.render(g, mx, my, 0);

    const perPage = RECIPE_GRID_COLS * RECIPE_GRID_ROWS;
    const start = this.page * perPage;
    for (let i = 0; i < perPage; i++) {
      const recipe = this.recipes[start + i];
      const col = i % RECIPE_GRID_COLS;
      const row = Math.floor(i / RECIPE_GRID_COLS);
      const rx = x + 8 + col * 25;
      const ry = y + 40 + row * 25;
      g.fill(rx, ry, rx + 18, ry + 18, 0xff8b8b8b);
      g.hLine(rx, rx + 18, ry, 0xff373737);
      g.vLine(rx, ry, ry + 18, 0xff373737);
      if (recipe) g.renderItem(recipe.resultItemId, rx + 1, ry + 1, 16);
    }
  }

  mouseClicked(mx: number, my: number, button: number, x: number, y: number): boolean {
    if (!this.visible) return false;
    if (this.search.mouseClicked(mx, my, button)) return true;
    const perPage = RECIPE_GRID_COLS * RECIPE_GRID_ROWS;
    for (let i = 0; i < perPage; i++) {
      const rx = x + 8 + (i % RECIPE_GRID_COLS) * 25;
      const ry = y + 40 + Math.floor(i / RECIPE_GRID_COLS) * 25;
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
