// Source: net.minecraft.world.inventory.ClickAction (26.2)
//         net.minecraft.world.inventory.ContainerInput (26.2)
//         net.minecraft.world.inventory.AbstractContainerMenu (quick-craft helpers)
//
// The "split" action in a browser port is ClickAction.SECONDARY (right button)
// applied to ContainerInput.PICKUP: it picks up half a stack / places one item.

import { ItemStack } from '../item/ItemStack.js';
import type { Slot, PlayerRef } from './Slot.js';

/** net.minecraft.world.inventory.ClickAction. */
export const ClickAction = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
} as const;
export type ClickAction = typeof ClickAction[keyof typeof ClickAction];

/** net.minecraft.world.inventory.ContainerInput. */
export const ContainerInput = {
  PICKUP: 0,          // left / right click: pickup, split, swap-with-carried
  QUICK_MOVE: 1,      // shift-click
  SWAP: 2,            // number keys / offhand swap
  CLONE: 3,           // creative middle-click clone
  THROW: 4,           // Q drop
  QUICK_CRAFT: 5,     // drag-paint
  PICKUP_ALL: 6,      // double-click collect
} as const;
export type ContainerInput = typeof ContainerInput[keyof typeof ContainerInput];

export const SLOT_CLICKED_OUTSIDE = -999;
export const QUICKCRAFT_TYPE_CHARITABLE = 0;
export const QUICKCRAFT_TYPE_GREEDY = 1;
export const QUICKCRAFT_TYPE_CLONE = 2;
export const QUICKCRAFT_HEADER_START = 0;
export const QUICKCRAFT_HEADER_CONTINUE = 1;
export const QUICKCRAFT_HEADER_END = 2;

export function getQuickcraftType(mask: number): number { return (mask >> 2) & 3; }
export function getQuickcraftHeader(mask: number): number { return mask & 3; }
export function getQuickcraftMask(header: number, type: number): number {
  return (header & 3) | ((type & 3) << 2);
}
export function isValidQuickcraftType(type: number, infiniteMaterials: boolean): boolean {
  return type === 0 || type === 1 || (type === 2 && infiniteMaterials);
}

/** AbstractContainerMenu.canItemQuickReplace. */
export function canItemQuickReplace(slot: Slot | null, stack: ItemStack, ignoreSize: boolean): boolean {
  const slotIsEmpty = slot === null || !slot.hasItem();
  if (!slotIsEmpty && ItemStack.isSameItemSameComponents(stack, slot.getItem())) {
    return slot.getItem().getCount() + (ignoreSize ? 0 : stack.getCount()) <= stack.getMaxStackSize();
  }
  return slotIsEmpty;
}

/** AbstractContainerMenu.getQuickCraftPlaceCount. */
export function getQuickCraftPlaceCount(slots: number, type: number, stack: ItemStack): number {
  switch (type) {
    case 0: return Math.floor(stack.getCount() / slots);
    case 1: return 1;
    case 2: return stack.getMaxStackSize();
    default: return stack.getCount();
  }
}

export type { PlayerRef };
