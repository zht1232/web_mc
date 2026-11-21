// Port of net.minecraft.client.gui.screens.inventory.AbstractContainerScreen (26.2).
// Sources: AbstractContainerScreen.java (INVENTORY_LOCATION, imageWidth 176,
// imageHeight 166, leftPos/topPos, titleLabelX/Y, inventoryLabelX/Y,
// extractBackground, extractSlots, extractSlot, extractCarriedItem,
// extractTooltip, getHoveredSlot, isHovering, mouseClicked / mouseReleased /
// mouseDragged quick-craft, keyPressed hotbar swap, isInGameUi = true),
// AbstractContainerMenu.java / InventoryMenu.java (slot coordinates),
// net.minecraft.client.gui.screens.inventory.tooltip.TooltipRenderUtil.
//
// Slot coordinates are computed by ./SlotLayout.ts (pure port of the Java).
// All 3D / HUD data comes through ScreenDeps; Game.ts is never imported.

import type { GuiGraphics } from '../../GuiGraphics.js';
import type { ItemStack, ContainerAction, ContainerMenuLike, MouseAction, Rect } from '../../Types.js';
import { Screen } from '../Screen.js';
import { Button } from '../../components/Button.js';
import {
  CONTAINER_DEFAULT_IMAGE_WIDTH,
  CONTAINER_DEFAULT_IMAGE_HEIGHT,
  CONTAINER_TITLE_LABEL_X,
  CONTAINER_TITLE_LABEL_Y,
  CONTAINER_INVENTORY_LABEL_Y_OFFSET,
  LABEL_COLOR,
  SLOT_SIZE,
  INVENTORY_LOCATION,
  SLOT_HIGHLIGHT_BACK,
  SLOT_HIGHLIGHT_FRONT,
} from '../../GuiConstants.js';
import { containerOrigin, slotAt } from './SlotLayout.js';

export interface SlotDef {
  index: number;
  x: number;
  y: number;
}

/** In-memory fallback menu used when the main agent has not injected one. */
export class MemoryContainerMenu implements ContainerMenuLike {
  private readonly items: ItemStack[];
  private carried: ItemStack | null = null;
  private quickCraftType = 0;
  private readonly dragSlots = new Set<number>();

  constructor(slotCount = 46, seed?: (index: number) => ItemStack) {
    this.items = Array.from({ length: slotCount }, (_, i) =>
      seed ? seed(i) : { itemId: -1, count: 0 });
  }

  setItem(index: number, stack: ItemStack): void { this.items[index] = stack; }
  getSlotCount(): number { return this.items.length; }
  getItem(index: number): ItemStack { return this.items[index] ?? { itemId: -1, count: 0 }; }
  getCarried(): ItemStack | null { return this.carried; }
  setCarried(stack: ItemStack | null): void { this.carried = stack; }

  click(index: number, button: number, shift: boolean, action: ContainerAction): void {
    const empty = (s: ItemStack | null): boolean => !s || s.itemId < 0 || s.count <= 0;
    const slot = this.getItem(index);
    if (action === 'QUICK_CRAFT') {
      const phase = button & 3;
      if (phase === 0) { this.dragSlots.clear(); this.quickCraftType = button >> 2; }
      if (phase === 1 && index >= 0 && this.carried &&
        (empty(slot) || slot.itemId === this.carried.itemId)) this.dragSlots.add(index);
      if (phase === 2 && this.carried) {
        const count = this.quickCraftType === 2 ? 64 : this.quickCraftType === 1 ? 1
          : Math.floor(this.carried.count / this.dragSlots.size);
        for (const i of this.dragSlots) {
          const target = this.getItem(i);
          const amount = Math.min(count, 64 - target.count, this.quickCraftType === 2 ? 64 : this.carried.count);
          this.items[i] = { itemId: this.carried.itemId, count: target.count + amount };
          if (this.quickCraftType !== 2) this.carried.count -= amount;
        }
        if (this.carried.count <= 0) this.carried = null;
        this.dragSlots.clear();
      }
      return;
    }
    if (index === -999 && action === 'PICKUP') {
      if (this.carried && button === 1) this.carried.count--;
      if (button === 0 || empty(this.carried)) this.carried = null;
      return;
    }
    if (index < 0 || index >= this.items.length) return;
    if (action === 'PICKUP_ALL') {
      if (!this.carried) return;
      for (const target of this.items) {
        if (target.itemId !== this.carried.itemId) continue;
        const amount = Math.min(target.count, 64 - this.carried.count);
        this.carried.count += amount;
        target.count -= amount;
      }
      return;
    }
    if (action === 'THROW') {
      if (!this.carried) this.items[index] = { itemId: slot.itemId, count: button === 1 ? 0 : Math.max(0, slot.count - 1) };
      return;
    }
    if (action === 'CLONE') {
      if (!empty(slot)) this.carried = { itemId: slot.itemId, count: 64 };
      return;
    }
    if (action === 'SWAP') {
      if (index < 0 || index >= this.items.length) return;
      const other = button === 40 ? 45 : 36 + button;
      if (other < this.items.length) {
        const t = this.items[index]; this.items[index] = this.items[other]; this.items[other] = t;
      }
      return;
    }
    if (action === 'QUICK_MOVE' || shift) {
      if (empty(slot)) return;
      const from = index >= 36 && index < 45 ? 9 : 36;
      const to = index >= 36 && index < 45 ? 36 : Math.min(45, this.items.length);
      for (let i = from; i < to; i++) {
        const target = this.items[i];
        if (empty(target)) { this.items[i] = slot; this.items[index] = { itemId: -1, count: 0 }; return; }
        if (target.itemId === slot.itemId && target.count < 64) {
          const move = Math.min(64 - target.count, slot.count);
          target.count += move;
          slot.count -= move;
          this.items[index] = slot.count > 0 ? slot : { itemId: -1, count: 0 };
          if (slot.count <= 0) return;
        }
      }
      return;
    }
    if (action === 'SPLIT' || button === 1) {
      if (empty(this.carried) && !empty(slot)) {
        const take = Math.ceil(slot.count / 2);
        this.carried = { itemId: slot.itemId, count: take };
        this.items[index] = { itemId: slot.itemId, count: slot.count - take };
        if (this.items[index].count <= 0) this.items[index] = { itemId: -1, count: 0 };
      } else if (!empty(this.carried) && (empty(slot) || slot.itemId === this.carried!.itemId && slot.count < 64)) {
        this.items[index] = { itemId: this.carried!.itemId, count: slot.count + 1 };
        this.carried!.count -= 1;
        if (this.carried!.count <= 0) this.carried = null;
      }
      return;
    }
    // PICKUP (left click)
    if (empty(this.carried)) {
      if (!empty(slot)) { this.carried = { ...slot }; this.items[index] = { itemId: -1, count: 0 }; }
    } else if (empty(slot)) {
      this.items[index] = this.carried!;
      this.carried = null;
    } else if (slot.itemId === this.carried!.itemId) {
      const move = Math.min(64 - slot.count, this.carried!.count);
      slot.count += move;
      this.carried!.count -= move;
      this.items[index] = slot;
      if (this.carried!.count <= 0) this.carried = null;
    } else {
      const t = { ...slot };
      this.items[index] = this.carried!;
      this.carried = t;
    }
  }
}

export abstract class AbstractContainerScreen extends Screen {
  protected imageWidth = CONTAINER_DEFAULT_IMAGE_WIDTH;
  protected imageHeight = CONTAINER_DEFAULT_IMAGE_HEIGHT;
  protected backgroundTexture = INVENTORY_LOCATION;
  protected leftPos = 0;
  protected topPos = 0;
  protected titleLabelX = CONTAINER_TITLE_LABEL_X;
  protected titleLabelY = CONTAINER_TITLE_LABEL_Y;
  protected inventoryLabelX = CONTAINER_TITLE_LABEL_X;
  protected inventoryLabelY = CONTAINER_DEFAULT_IMAGE_HEIGHT - CONTAINER_INVENTORY_LABEL_Y_OFFSET;
  protected playerInventoryTitle = 'container.inventory';
  protected slots: SlotDef[] = [];
  protected menu: ContainerMenuLike;
  protected hoveredSlot = -1;
  private containerDragButton = -1;
  /** Slot the current press started on (used to place a stack on release). */
  protected pressedSlot = -1;
  private dragStartSlot = -1;
  private dragMoved = false;
  private doubleClick = false;
  private lastClickSlot = -1;
  private lastClickButton = -1;
  private lastClickTime = 0;
  private readonly quickCraftSlots = new Set<number>();
  /** True when the background sheet already contains the slot frames (vanilla sheets do). */
  protected textureBacked = false;

  constructor(
    env: ConstructorParameters<typeof Screen>[0],
    title: string,
    imageWidth = CONTAINER_DEFAULT_IMAGE_WIDTH,
    imageHeight = CONTAINER_DEFAULT_IMAGE_HEIGHT,
    backgroundTexture = INVENTORY_LOCATION,
  ) {
    super(env, title);
    this.imageWidth = imageWidth;
    this.imageHeight = imageHeight;
    this.backgroundTexture = backgroundTexture;
    this.playerInventoryTitle = env.t('container.inventory');
    this.setInGameUi(true);
    this.setPauseScreen(false);
    this.menu = env.deps.container ?? new MemoryContainerMenu(46);
  }

  /** Subclasses provide the slot list (coordinates relative to the GUI image). */
  protected abstract buildSlots(): SlotDef[];

  protected build(): void {
    this.relayout();
    if (this.env.deps.touchInput) {
      this.addRenderableWidget(new Button(this.width - 48, 4, 44, 20, this.t('gui.done'), () => {
        this.onClose();
        this.close();
      }));
    }
  }

  /**
   * Recomputes the origin + slot list. Used when a screen changes its panel size at runtime
   * (the creative Survival Inventory tab is 195x166 while the item tabs are 195x136).
   */
  protected relayout(): void {
    const o = containerOrigin(this.width, this.height, this.imageWidth, this.imageHeight);
    this.leftPos = o.leftPos;
    this.topPos = o.topPos;
    this.inventoryLabelY = this.imageHeight - CONTAINER_INVENTORY_LABEL_Y_OFFSET;
    this.slots = this.buildSlots();
    this.cancelDrag();
  }

  protected slotRects(): Rect[] {
    return this.slots.map((s) => ({ x: s.x, y: s.y, width: SLOT_SIZE, height: SLOT_SIZE }));
  }

  /** AbstractContainerScreen#getHoveredSlot / isHovering (1px fuzz). */
  getHoveredSlot(mx: number, my: number): number {
    const i = slotAt(this.slotRects(), mx, my, this.leftPos, this.topPos);
    return i >= 0 ? this.slots[i].index : -1;
  }

  /** AbstractContainerScreen#hasClickedOutside */
  hasClickedOutside(mx: number, my: number): boolean {
    return mx < this.leftPos || my < this.topPos ||
      mx >= this.leftPos + this.imageWidth || my >= this.topPos + this.imageHeight;
  }

  // ------------------------------------------------------------- rendering
  protected renderBackground(g: GuiGraphics, mx: number, my: number, _pt: number): void {
    g.renderTransparentBackground();
    this.hoveredSlot = this.getHoveredSlot(mx, my);

    g.pushPose();
    g.translate(this.leftPos, this.topPos);

    this.drawContainerBackground(g);

    this.drawLabels(g);
    this.drawSlotHighlight(g, SLOT_HIGHLIGHT_BACK);
    this.drawSlots(g);
    this.drawSlotHighlight(g, SLOT_HIGHLIGHT_FRONT);
    g.popPose();
  }

  /**
   * The vanilla container sheet already contains the panel bevel and every slot frame. Drawing
   * a second #C6C6C6 fill / outline / slot frame on top produced the light-grey grid lines the
   * player saw around every slot. Only use the procedural fallback when the texture is missing.
   */
  protected drawContainerBackground(g: GuiGraphics): void {
    const hasTexture = !!g.textures.get(this.backgroundTexture);
    if (!hasTexture) {
      g.fill(0, 0, this.imageWidth, this.imageHeight, 0xffc6c6c6);
      g.outline(0, 0, this.imageWidth, this.imageHeight, 0xff555555);
    } else {
      g.blit(this.backgroundTexture, 0, 0, this.imageWidth, this.imageHeight);
    }
    this.textureBacked = hasTexture;
  }

  protected drawLabels(g: GuiGraphics): void {
    g.drawString(this.title, this.titleLabelX, this.titleLabelY, LABEL_COLOR, false);
    g.drawString(this.playerInventoryTitle, this.inventoryLabelX, this.inventoryLabelY, LABEL_COLOR, false);
  }

  private drawSlotHighlight(g: GuiGraphics, sprite: string): void {
    if (this.hoveredSlot < 0 || !g.sprites.get(sprite)) return;
    const s = this.slots.find((v) => v.index === this.hoveredSlot);
    if (s) g.blitSprite(sprite, s.x - 4, s.y - 4, 24, 24);
  }

  /** AbstractContainerScreen#extractSlot: frame, item icon, decorations. */
  protected drawSlots(g: GuiGraphics): void {
    for (const s of this.slots) {
      if (!this.textureBacked) this.drawSlotFrame(g, s.x, s.y);
      let stack = this.safeItem(s.index);
      const carried = this.menu.getCarried();
      if (carried && this.quickCraftSlots.size > 1 && this.quickCraftSlots.has(s.index)) {
        stack = { itemId: carried.itemId, count: this.quickCraftCount(s.index, carried) };
      }
      if (!(stack.itemId >= 0 && stack.count > 0)) {
        // Slot.getNoItemIcon: the greyed armor / shield outline of an empty slot
        const icon = this.emptySlotSprite(s.index);
        if (icon && g.sprites.get(icon)) g.blitSprite(icon, s.x, s.y, 16, 16);
      }
      if (stack.itemId >= 0 && stack.count > 0) {
        g.renderItem(stack.itemId, s.x, s.y, 16);
        g.renderItemDecorations(stack.itemId, stack.count, s.x, s.y);
      }
    }
    // Ghost preview of the dragged stack over quick-craft slots.
    if (this.containerDragButton >= 0 && this.quickCraftSlots.size > 1 && this.menu.getCarried()) {
      for (const idx of this.quickCraftSlots) {
        const s = this.slots.find((v) => v.index === idx);
        if (s) g.fill(s.x, s.y, s.x + 16, s.y + 16, -2130706433);
      }
    }
  }

  /** Sprite drawn in an empty slot (armor / offhand outlines); none by default. */
  protected emptySlotSprite(_menuSlot: number): string | undefined { return undefined; }

  /** Vanilla slot frame colours (dark top/left, white bottom/right, #8B8B8B fill). */
  protected drawSlotFrame(g: GuiGraphics, x: number, y: number): void {
    g.hLine(x - 1, x + 16, y - 1, 0xff373737);
    g.vLine(x - 1, y - 1, y + 16, 0xff373737);
    g.hLine(x - 1, x + 16, y + 16, 0xffffffff);
    g.vLine(x + 16, y - 1, y + 16, 0xffffffff);
    g.fill(x, y, x + 16, y + 16, 0xff8b8b8b);
  }

  private safeItem(index: number): ItemStack {
    if (index < 0 || index >= this.menu.getSlotCount()) return { itemId: -1, count: 0 };
    return this.menu.getItem(index);
  }

  protected renderForeground(g: GuiGraphics, mx: number, my: number, _pt: number): void {
    // extractCarriedItem: floating stack following the cursor at (mouse-8).
    const carried = this.menu.getCarried();
    if (carried && carried.itemId >= 0) {
      let count = carried.count;
      if (this.quickCraftSlots.size > 1 && this.containerDragButton !== 2) {
        for (const index of this.quickCraftSlots) {
          count -= this.quickCraftCount(index, carried) - this.safeItem(index).count;
        }
      }
      g.renderItem(carried.itemId, mx - 8, my - 8, 16);
      g.renderItemDecorations(carried.itemId, Math.max(0, count), mx - 8, my - 8);
    }
    // extractTooltip: item tooltip for the hovered slot.
    if (this.hoveredSlot >= 0 && !carried) {
      const stack = this.safeItem(this.hoveredSlot);
      if (stack.itemId >= 0) g.renderItemTooltip(stack.itemId, mx, my);
    }
  }

  // ------------------------------------------------------------- input
  private cancelDrag(): void {
    this.containerDragButton = -1;
    this.pressedSlot = -1;
    this.quickCraftSlots.clear();
    this.doubleClick = false;
  }

  private addQuickCraftSlot(index: number): void {
    const carried = this.menu.getCarried();
    if (!carried || index < 0 || this.quickCraftSlots.has(index)) return;
    if (this.containerDragButton !== 2 && carried.count <= this.quickCraftSlots.size) return;
    const target = this.safeItem(index);
    const max = this.menu.getMaxStackSize?.(index, carried) ?? 64;
    if (target.count > 0 && (target.itemId !== carried.itemId || target.count >= max)) return;
    if (this.menu.canPlaceItem?.(index, carried) === false) return;
    this.quickCraftSlots.add(index);
  }

  private quickCraftCount(index: number, carried: ItemStack): number {
    const max = this.menu.getMaxStackSize?.(index, carried) ?? 64;
    const amount = this.containerDragButton === 2 ? max : this.containerDragButton === 1
      ? 1 : Math.floor(carried.count / this.quickCraftSlots.size);
    return Math.min(max, this.safeItem(index).count + amount);
  }

  mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0): boolean {
    const idx = this.getHoveredSlot(mx, my);
    this.hoveredSlot = idx;
    if (action === 'cancel') {
      this.cancelDrag();
      this.lastClickSlot = -1;
      return super.mouseEvent(mx, my, button, action, wheelDelta);
    }
    if (action === 'down') {
      if (super.mouseEvent(mx, my, button, action, wheelDelta)) return true;
      if (button < 0 || button > 2) return false;
      const outside = this.hasClickedOutside(mx, my);
      if (idx < 0 && !outside) return false;
      const shift = (this.env.mods & 1) !== 0;
      const now = performance.now();
      this.cancelDrag();
      this.pressedSlot = idx;
      this.doubleClick = button === 0 && !shift && idx >= 0 && idx === this.lastClickSlot
        && button === this.lastClickButton && now - this.lastClickTime < 250;
      this.lastClickSlot = idx;
      this.lastClickButton = button;
      this.lastClickTime = now;
      // Shift-click always quick-moves the slot, even while carrying a stack. Without this
      // the carried stack was dropped into the slot first (a PICKUP swap), which is what made
      // shift-click shuffle items around instead of transferring them.
      if (shift && idx >= 0) {
        this.menu.click(idx, button, true, 'QUICK_MOVE');
        return true;
      }
      if (!this.menu.getCarried()) {
        if (idx >= 0) this.menu.click(idx, button, false,
          button === 2 ? 'CLONE' : 'PICKUP');
      } else if (button !== 2 || this.env.deps.options.gamemode === 'creative') {
        this.containerDragButton = button;
        this.addQuickCraftSlot(idx);
      }
      return true;
    }
    if (action === 'move' && this.containerDragButton >= 0) {
      this.addQuickCraftSlot(idx);
      return true;
    }
    // Press on one slot, release on another: vanilla turns that into a one-slot quick-craft,
    // which ends with the carried stack placed in the slot under the cursor. Without this the
    // stack stayed glued to the pointer until the next click ("放下物品后指针上还悬浮物品").
    if (action === 'up' && this.containerDragButton < 0 && this.pressedSlot >= 0
        && idx !== this.pressedSlot && this.menu.getCarried()) {
      const target = idx >= 0 ? idx : this.hasClickedOutside(mx, my) ? -999 : -1;
      if (target !== -1) this.menu.click(target, button, false, 'PICKUP');
      this.pressedSlot = -1;
      return true;
    }
    if (action === 'up') this.pressedSlot = -1;
    if (action === 'up' && this.containerDragButton >= 0) {
      if (button !== this.containerDragButton) { this.cancelDrag(); return true; }
      // Double-click with a carried stack collects every matching stack from the inventory
      // (PICKUP_ALL); the old condition required the clicked slot to be empty.
      if (this.doubleClick && idx >= 0 && button === 0 && this.menu.getCarried()) {
        this.menu.click(idx, button, false, 'PICKUP_ALL');
      } else if (this.quickCraftSlots.size > 1) {
        this.menu.click(-999, button << 2, false, 'QUICK_CRAFT');
        for (const slot of this.quickCraftSlots) this.menu.click(slot, (button << 2) | 1, false, 'QUICK_CRAFT');
        this.menu.click(-999, (button << 2) | 2, false, 'QUICK_CRAFT');
        this.lastClickSlot = -1;
      } else if (button !== 2) {
        const target = idx >= 0 ? idx : this.hasClickedOutside(mx, my) ? -999 : -1;
        if (target !== -1) this.menu.click(target, button, false, 'PICKUP');
      }
      this.cancelDrag();
      super.mouseEvent(mx, my, button, action, wheelDelta);
      return true;
    }
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'KeyE') { this.onClose(); this.close(); return true; }
    if (this.hoveredSlot >= 0 && !this.menu.getCarried()) {
      if (code === 'KeyQ') {
        this.menu.click(this.hoveredSlot, (mods & 2) !== 0 ? 1 : 0, false, 'THROW');
        return true;
      }
      if (code === 'KeyF') {
        this.menu.click(this.hoveredSlot, 40, false, 'SWAP');
        return true;
      }
    }
    if (/^Digit[1-9]$/.test(code)) {
      const hotbar = Number(code.slice(5)) - 1;
      if (this.hoveredSlot >= 0) {
        // SWAP with hotbar slot (menu decides the exact mapping).
        this.menu.click(this.hoveredSlot, hotbar, false, 'SWAP');
        return true;
      }
    }
    return super.keyPressed(code, char, mods);
  }
}
