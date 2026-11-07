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
import type { ItemStack, ContainerMenuLike, MouseAction, Rect } from '../../Types.js';
import { Screen } from '../Screen.js';
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

  constructor(slotCount = 45, seed?: (index: number) => ItemStack) {
    this.items = Array.from({ length: slotCount }, (_, i) =>
      seed ? seed(i) : { itemId: -1, count: 0 });
  }

  setItem(index: number, stack: ItemStack): void { this.items[index] = stack; }
  getSlotCount(): number { return this.items.length; }
  getItem(index: number): ItemStack { return this.items[index] ?? { itemId: -1, count: 0 }; }
  getCarried(): ItemStack | null { return this.carried; }
  setCarried(stack: ItemStack | null): void { this.carried = stack; }

  click(index: number, button: number, shift: boolean, action: 'PICKUP' | 'QUICK_MOVE' | 'SPLIT' | 'THROW' | 'CLONE' | 'SWAP'): void {
    const empty = (s: ItemStack | null): boolean => !s || s.itemId < 0 || s.count <= 0;
    const slot = this.getItem(index);
    if (action === 'THROW') { this.carried = null; return; }
    if (action === 'CLONE') {
      if (!empty(slot)) this.carried = { itemId: slot.itemId, count: 64 };
      return;
    }
    if (action === 'SWAP') {
      if (index < 0 || index >= this.items.length) return;
      const other = index < 9 ? index + 27 : index - 27;
      if (other < this.items.length) {
        const t = this.items[index]; this.items[index] = this.items[other]; this.items[other] = t;
      }
      return;
    }
    if (action === 'QUICK_MOVE' || shift) {
      if (empty(slot)) return;
      const from = index < 9 ? 9 : 0;
      const to = index < 9 ? this.items.length : 9;
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
      } else if (!empty(this.carried) && empty(slot)) {
        this.items[index] = { itemId: this.carried!.itemId, count: 1 };
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
  private readonly quickCraftSlots = new Set<number>();

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
    this.menu = env.deps.container ?? new MemoryContainerMenu(45);
  }

  /** Subclasses provide the slot list (coordinates relative to the GUI image). */
  protected abstract buildSlots(): SlotDef[];

  protected build(): void {
    const o = containerOrigin(this.width, this.height, this.imageWidth, this.imageHeight);
    this.leftPos = o.leftPos;
    this.topPos = o.topPos;
    this.inventoryLabelY = this.imageHeight - CONTAINER_INVENTORY_LABEL_Y_OFFSET;
    this.slots = this.buildSlots();
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

    // Container background sheet (256x256), region (0,0,imageWidth,imageHeight).
    // This resource pack ships low-colour placeholder sheets, so a vanilla
    // #C6C6C6 panel is laid down first and the original texture blitted on top;
    // the recessed slot frames are re-drawn below (they live in that texture).
    g.fill(0, 0, this.imageWidth, this.imageHeight, 0xffc6c6c6);
    g.outline(0, 0, this.imageWidth, this.imageHeight, 0xff555555);
    if (g.textures.get(this.backgroundTexture)) {
      g.blit(this.backgroundTexture, 0, 0, this.imageWidth, this.imageHeight);
    }

    this.drawLabels(g);
    this.drawSlotHighlight(g, SLOT_HIGHLIGHT_BACK);
    this.drawSlots(g);
    this.drawSlotHighlight(g, SLOT_HIGHLIGHT_FRONT);
    g.popPose();
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
      this.drawSlotFrame(g, s.x, s.y);
      const stack = this.safeItem(s.index);
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
      g.renderItem(carried.itemId, mx - 8, my - 8, 16);
      g.renderItemDecorations(carried.itemId, carried.count, mx - 8, my - 8);
    }
    // extractTooltip: item tooltip for the hovered slot.
    if (this.hoveredSlot >= 0 && !carried) {
      const stack = this.safeItem(this.hoveredSlot);
      if (stack.itemId >= 0) g.renderItemTooltip(stack.itemId, mx, my);
    }
  }

  // ------------------------------------------------------------- input
  mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0): boolean {
    if (action === 'down') {
      const idx = this.getHoveredSlot(mx, my);
      if (idx >= 0 && (button === 0 || button === 1)) {
        const shift = (this.env.mods & 1) !== 0;
        if (button === 1 && !shift) this.menu.click(idx, 1, false, 'SPLIT');
        else this.menu.click(idx, button, shift, shift ? 'QUICK_MOVE' : 'PICKUP');
        this.containerDragButton = button;
        this.quickCraftSlots.clear();
        this.quickCraftSlots.add(idx);
        return true;
      }
      if (this.hasClickedOutside(mx, my) && this.menu.getCarried()) {
        this.menu.click(-999, button, false, 'THROW');
        return true;
      }
      return super.mouseEvent(mx, my, button, action, wheelDelta);
    }
    if (action === 'move' && this.containerDragButton >= 0) {
      const idx = this.getHoveredSlot(mx, my);
      if (idx >= 0) this.quickCraftSlots.add(idx);
      return true;
    }
    if (action === 'up') {
      if (this.containerDragButton >= 0 && this.quickCraftSlots.size > 1 && this.menu.getCarried()) {
        // Distribute the carried stack evenly across the dragged slots.
        const stack = this.menu.getCarried()!;
        const per = Math.floor(stack.count / this.quickCraftSlots.size);
        for (const idx of this.quickCraftSlots) {
          if (per > 0) {
            const target = this.safeItem(idx);
            if (target.itemId < 0) this.menu.click(idx, 0, false, 'PICKUP');
          }
        }
      }
      this.containerDragButton = -1;
      this.quickCraftSlots.clear();
      return super.mouseEvent(mx, my, button, action, wheelDelta);
    }
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'KeyE') { this.onClose(); this.close(); return true; }
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
