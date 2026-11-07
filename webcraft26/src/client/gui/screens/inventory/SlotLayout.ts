// Pure port of the survival-inventory slot coordinates.
// Sources:
//   net.minecraft.world.inventory.AbstractContainerMenu#addInventoryExtendedSlots /
//   #addStandardInventorySlots / #addInventoryHotbarSlots (26.2)
//   net.minecraft.world.inventory.InventoryMenu (addResultSlot(154,28),
//   addCraftingGridSlots(98,18), ArmorSlot(..., 39 - i, 8, 8 + i*18),
//   addStandardInventorySlots(inventory, 8, 84), offhand Slot(40, 77, 62))
//   net.minecraft.client.gui.screens.inventory.AbstractContainerScreen
//   (leftPos = (width - imageWidth)/2, topPos = (height - imageHeight)/2)
//
// No DOM: safe to import from Node/tsx.

import type { Rect } from '../../Types.js';
import {
  SLOT_SIZE,
  SLOT_GRID,
  PLAYER_INV_LEFT,
  PLAYER_INV_TOP,
  PLAYER_INV_HOTBAR_TOP,
  PLAYER_INV_COLS,
  PLAYER_INV_ROWS,
  HOTBAR_SLOT_START,
  HOTBAR_SLOT_END,
  MAIN_INV_SLOT_START,
  MAIN_INV_SLOT_END,
  ARMOR_SLOT_START,
  OFFHAND_SLOT,
  CRAFT_RESULT_X,
  CRAFT_RESULT_Y,
  CRAFT_GRID_X,
  CRAFT_GRID_Y,
  ARMOR_SLOT_X,
  ARMOR_SLOT_Y,
  OFFHAND_SLOT_X,
  OFFHAND_SLOT_Y,
  CONTAINER_DEFAULT_IMAGE_WIDTH,
  CONTAINER_DEFAULT_IMAGE_HEIGHT,
} from '../../GuiConstants.js';

/** Literal Java constants, exported for test assertions against the source. */
export const JAVA_SLOT_CONSTANTS = {
  LEFT: 8,
  TOP: 84,
  HOTBAR_TOP_OFFSET: 58,
  GRID: 18,
  SLOT_SIZE: 16,
  CRAFT_RESULT_X: 154,
  CRAFT_RESULT_Y: 28,
  CRAFT_GRID_X: 98,
  CRAFT_GRID_Y: 18,
  ARMOR_X: 8,
  ARMOR_Y: 8,
  OFFHAND_X: 77,
  OFFHAND_Y: 62,
  IMAGE_WIDTH: 176,
  IMAGE_HEIGHT: 166,
} as const;

export function isHotbarSlot(inventorySlot: number): boolean {
  return inventorySlot >= HOTBAR_SLOT_START && inventorySlot < HOTBAR_SLOT_END;
}

export function isMainInventorySlot(inventorySlot: number): boolean {
  return inventorySlot >= MAIN_INV_SLOT_START && inventorySlot < MAIN_INV_SLOT_END;
}

export function isArmorSlot(inventorySlot: number): boolean {
  return inventorySlot >= ARMOR_SLOT_START && inventorySlot < OFFHAND_SLOT;
}

function rect(x: number, y: number): Rect {
  return { x, y, width: SLOT_SIZE, height: SLOT_SIZE };
}

/**
 * Screen-space (relative to leftPos/topPos) rectangle of a PLAYER INVENTORY
 * container slot index (0..8 hotbar, 9..35 main, 36..39 armor, 40 offhand).
 *
 * Mirrors:
 *   addInventoryExtendedSlots: new Slot(inv, x + (y+1)*9, left + x*18, top + y*18)
 *   addInventoryHotbarSlots : new Slot(inv, i, left + i*18, top + 58)
 */
export function survivalInventorySlotXY(
  inventorySlot: number,
  left = PLAYER_INV_LEFT,
  top = PLAYER_INV_TOP,
): Rect {
  if (isHotbarSlot(inventorySlot)) {
    return rect(left + inventorySlot * SLOT_GRID, top + (PLAYER_INV_HOTBAR_TOP - PLAYER_INV_TOP));
  }
  if (isMainInventorySlot(inventorySlot)) {
    const n = inventorySlot - MAIN_INV_SLOT_START;
    const row = Math.floor(n / PLAYER_INV_COLS);
    const col = n % PLAYER_INV_COLS;
    return rect(left + col * SLOT_GRID, top + row * SLOT_GRID);
  }
  if (isArmorSlot(inventorySlot)) {
    // InventoryMenu: ArmorSlot(..., 39 - i, 8, 8 + i * 18) for i = 0..3
    const i = 39 - inventorySlot;
    return rect(ARMOR_SLOT_X, ARMOR_SLOT_Y + i * SLOT_GRID);
  }
  if (inventorySlot === OFFHAND_SLOT) {
    return rect(OFFHAND_SLOT_X, OFFHAND_SLOT_Y);
  }
  return rect(-1, -1);
}

/** All 41 player-inventory container slots, in container-index order. */
export function playerInventorySlotRects(left = PLAYER_INV_LEFT, top = PLAYER_INV_TOP): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i <= OFFHAND_SLOT; i++) out.push(survivalInventorySlotXY(i, left, top));
  return out;
}

// ---------------------------------------------------------------------------
// InventoryMenu -> screen slot layout (MENU slot indices, not container indices)
// ---------------------------------------------------------------------------

export const MENU_RESULT_SLOT = 0;
export const MENU_CRAFT_SLOT_START = 1;   // 1..4 (2x2)
export const MENU_ARMOR_SLOT_START = 5;   // 5..8
export const MENU_MAIN_SLOT_START = 9;    // 9..35  -> inv 9..35
export const MENU_HOTBAR_SLOT_START = 36; // 36..44 -> inv 0..8
export const MENU_OFFHAND_SLOT = 45;      // -> inv 40

/** Map an InventoryMenu slot index to the player-inventory container index (-1 for non-inv). */
export function menuSlotToInventoryIndex(menuSlot: number): number {
  if (menuSlot >= MENU_MAIN_SLOT_START && menuSlot <= 35) return menuSlot;
  if (menuSlot >= MENU_HOTBAR_SLOT_START && menuSlot <= 44) return menuSlot - MENU_HOTBAR_SLOT_START;
  if (menuSlot >= MENU_ARMOR_SLOT_START && menuSlot <= 8) return 39 - (menuSlot - MENU_ARMOR_SLOT_START);
  if (menuSlot === MENU_OFFHAND_SLOT) return OFFHAND_SLOT;
  return -1;
}

/** Screen rectangle of an InventoryMenu slot index, relative to leftPos/topPos. */
export function inventoryMenuSlotXY(menuSlot: number, left = 0, top = 0): Rect {
  const inv = menuSlotToInventoryIndex(menuSlot);
  if (inv >= 0) {
    const r = survivalInventorySlotXY(inv, left + PLAYER_INV_LEFT, top + PLAYER_INV_TOP);
    return r;
  }
  if (menuSlot === MENU_RESULT_SLOT) return rect(left + CRAFT_RESULT_X, top + CRAFT_RESULT_Y);
  if (menuSlot >= MENU_CRAFT_SLOT_START && menuSlot <= 4) {
    const n = menuSlot - MENU_CRAFT_SLOT_START;
    return rect(left + CRAFT_GRID_X + (n % 2) * SLOT_GRID, top + CRAFT_GRID_Y + Math.floor(n / 2) * SLOT_GRID);
  }
  return rect(-1, -1);
}

/** All 46 InventoryMenu slots in menu-index order. */
export function inventoryMenuSlotRects(left = 0, top = 0): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i <= MENU_OFFHAND_SLOT; i++) out.push(inventoryMenuSlotXY(i, left, top));
  return out;
}

// ---------------------------------------------------------------------------
// AbstractContainerScreen origin
// ---------------------------------------------------------------------------

export function containerOrigin(
  screenWidth: number,
  screenHeight: number,
  imageWidth = CONTAINER_DEFAULT_IMAGE_WIDTH,
  imageHeight = CONTAINER_DEFAULT_IMAGE_HEIGHT,
): { leftPos: number; topPos: number } {
  return {
    leftPos: Math.floor((screenWidth - imageWidth) / 2),
    topPos: Math.floor((screenHeight - imageHeight) / 2),
  };
}

/**
 * Mirrors AbstractContainerScreen#isHovering: xm -= leftPos; ym -= topPos;
 * return xm >= left-1 && xm < left+w+1 && ym >= top-1 && ym < top+h+1.
 */
export function isSlotHovered(slot: Rect, mouseX: number, mouseY: number, leftPos: number, topPos: number): boolean {
  const xm = mouseX - leftPos;
  const ym = mouseY - topPos;
  return xm >= slot.x - 1 && xm < slot.x + slot.width + 1 && ym >= slot.y - 1 && ym < slot.y + slot.height + 1;
}

/** Returns the index of the first slot whose 16x16 (+1px fuzz) rectangle contains the point. */
export function slotAt(slots: readonly Rect[], mouseX: number, mouseY: number, leftPos: number, topPos: number): number {
  for (let i = 0; i < slots.length; i++) {
    if (isSlotHovered(slots[i], mouseX, mouseY, leftPos, topPos)) return i;
  }
  return -1;
}

/**
 * Player-inventory slots for a generic container (Crafting/Furnace/Chest screen).
 * Vanilla places them at (8, 84) inside the GUI image; the absolute origin is
 * obtained with containerOrigin(screenWidth, screenHeight, imageWidth, imageHeight).
 */
export function containerPlayerSlots(): { slots: Rect[]; inventoryLabelY: number } {
  return {
    slots: playerInventorySlotRects(),
    inventoryLabelY: CONTAINER_DEFAULT_IMAGE_HEIGHT - 94,
  };
}
