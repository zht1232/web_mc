// Port of net.minecraft.client.gui.screens.inventory.InventoryScreen (26.2).
// Sources: InventoryScreen.java (titleLabelX = 97, getRecipeBookButtonPosition
// (leftPos + 104, height / 2 - 22), extractBackground with INVENTORY_LOCATION,
// extractEntityInInventoryFollowsMouse(xo+26, yo+8, xo+75, yo+78, 30, ...)),
// InventoryMenu.java (46 slots: result, 2x2 craft, 4 armor, 27 main, 9 hotbar,
// offhand), AbstractRecipeBookScreen.java (recipe book button).
//
// The player model preview is drawn as a 2D billboard because the browser HUD
// has no 3D entity renderer on the GUI canvas; the box and follow-mouse angle
// still use the exact vanilla coordinates.

import type { GuiGraphics } from '../../GuiGraphics.js';
import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { inventoryMenuSlotXY, MENU_OFFHAND_SLOT } from './SlotLayout.js';
import { INVENTORY_TITLE_LABEL_X } from '../../GuiConstants.js';
import { Button } from '../../components/Button.js';
import { RecipeBookComponent, RECIPE_BOOK_WIDTH } from '../recipebook/RecipeBookComponent.js';

export class InventoryScreen extends AbstractContainerScreen {
  private readonly recipeBook: RecipeBookComponent;
  private xMouse = 0;
  private yMouse = 0;

  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.crafting');
    this.titleLabelX = INVENTORY_TITLE_LABEL_X;
    this.recipeBook = new RecipeBookComponent(env);
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [];
    for (let menuSlot = 0; menuSlot <= MENU_OFFHAND_SLOT; menuSlot++) {
      const r = inventoryMenuSlotXY(menuSlot, 0, 0);
      out.push({ index: menuSlot, x: r.x, y: r.y });
    }
    return out;
  }

  protected build(): void {
    super.build();
    // AbstractRecipeBookScreen#getRecipeBookButtonPosition
    const bx = this.leftPos + 104;
    const by = Math.floor(this.height / 2) - 22;
    const b = new Button(bx, by, 20, 18, 'R', () => {
      this.recipeBook.toggle();
      this.env.toast(this.recipeBook.isVisible() ? 'Recipe Book' : '');
    });
    this.addRenderableWidget(b);
  }

  protected renderBackground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    super.renderBackground(g, mx, my, pt);
    this.xMouse = mx;
    this.yMouse = my;

    g.pushPose();
    g.translate(this.leftPos, this.topPos);
    this.drawEntityPreview(g, 26, 8, 75, 78);
    g.popPose();

    // Recipe book panel sits to the left of the inventory GUI.
    const rx = this.recipeBook.getX(this.width, this.imageWidth, this.leftPos);
    this.recipeBook.render(g, rx, this.topPos, mx, my);
  }

  /** 2D approximation of vanilla's mouse-following player model. */
  private drawEntityPreview(g: GuiGraphics, x0: number, y0: number, x1: number, y1: number): void {
    const cx = Math.floor((x0 + x1) / 2);
    const lean = Math.max(-3, Math.min(3, Math.round((cx - (this.xMouse - this.leftPos)) / 20)));
    const x = cx + lean;
    const y = y0 + 8;
    g.fill(x - 8, y, x + 8, y + 16, 0xffb57b53);        // head
    g.fill(x - 8, y + 16, x + 8, y + 40, 0xff26a0b5);   // body
    g.fill(x - 16, y + 16, x - 8, y + 40, 0xff1e7f90);  // left arm
    g.fill(x + 8, y + 16, x + 16, y + 40, 0xff1e7f90);  // right arm
    g.fill(x - 8, y + 40, x, y + 62, 0xff37378f);       // left leg
    g.fill(x, y + 40, x + 8, y + 62, 0xff2f2f78);       // right leg
    g.fill(x - 5, y + 5, x - 3, y + 7, 0xff2b2b2b);     // eyes
    g.fill(x + 3, y + 5, x + 5, y + 7, 0xff2b2b2b);
    g.outline(x - 8, y, 16, 16, 0xff000000);
    void this.yMouse;
    void RECIPE_BOOK_WIDTH;
  }

  mouseEvent(mx: number, my: number, button: number, action: 'down' | 'up' | 'move' | 'wheel', wheelDelta = 0): boolean {
    const rx = this.recipeBook.getX(this.width, this.imageWidth, this.leftPos);
    if (action === 'down' && this.recipeBook.mouseClicked(mx, my, button, rx, this.topPos)) return true;
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (this.recipeBook.keyPressed(code, char, mods)) return true;
    return super.keyPressed(code, char, mods);
  }

  charTyped(ch: string, mods: number): boolean {
    if (this.recipeBook.charTyped(ch, mods)) return true;
    return super.charTyped(ch, mods);
  }

  tick(): void {
    super.tick();
    this.recipeBook.tick();
  }
}
