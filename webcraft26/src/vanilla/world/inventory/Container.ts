// Source: net.minecraft.world.Container / SimpleContainer (26.2)
//         net.minecraft.world.inventory.ContainerData / SimpleContainerData / DataSlot
//
// Minimal container abstraction shared by PlayerInventory, CraftingContainer,
// ResultContainer, SimpleContainer (furnace/chest) and the menu slot wrappers.

import { ItemStack } from '../item/ItemStack.js';

export interface Container {
  getContainerSize(): number;
  isEmpty(): boolean;
  getItem(slot: number): ItemStack;
  removeItem(slot: number, count: number): ItemStack;
  removeItemNoUpdate(slot: number): ItemStack;
  setItem(slot: number, stack: ItemStack): void;
  setChanged(): void;
  stillValid(player: unknown): boolean;
  getMaxStackSize(): number;
  clearContent(): void;
}

/** Port of net.minecraft.world.ContainerHelper helpers used by containers. */
export class ContainerHelper {
  static removeItem(items: ItemStack[], slot: number, count: number): ItemStack {
    if (slot >= 0 && slot < items.length && !items[slot].isEmpty() && count > 0) {
      return items[slot].split(count);
    }
    return ItemStack.EMPTY;
  }
  static takeItem(items: ItemStack[], slot: number): ItemStack {
    if (slot >= 0 && slot < items.length) {
      const prev = items[slot];
      items[slot] = ItemStack.EMPTY;
      return prev;
    }
    return ItemStack.EMPTY;
  }
  /** ContainerHelper.clearOrCountMatchingItems (single-stack variant). */
  static clearOrCountMatchingItems(
    stack: ItemStack,
    predicate: (s: ItemStack) => boolean,
    amountToRemove: number,
    countingOnly: boolean,
  ): number {
    if (stack.isEmpty() || !predicate(stack)) return 0;
    if (countingOnly) return stack.getCount();
    const removed = amountToRemove < 0 ? stack.getCount() : Math.min(amountToRemove, stack.getCount());
    stack.shrink(removed);
    return removed;
  }
}

export abstract class AbstractContainer implements Container {
  abstract getContainerSize(): number;
  abstract getItem(slot: number): ItemStack;
  abstract setItem(slot: number, stack: ItemStack): void;
  abstract removeItem(slot: number, count: number): ItemStack;
  abstract removeItemNoUpdate(slot: number): ItemStack;

  isEmpty(): boolean {
    const n = this.getContainerSize();
    for (let i = 0; i < n; i++) if (!this.getItem(i).isEmpty()) return false;
    return true;
  }
  setChanged(): void {}
  stillValid(_player: unknown): boolean { return true; }
  getMaxStackSize(): number { return 64; }
  clearContent(): void {
    const n = this.getContainerSize();
    for (let i = 0; i < n; i++) this.setItem(i, ItemStack.EMPTY);
  }
}

/** Port of net.minecraft.world.SimpleContainer. */
export class SimpleContainer extends AbstractContainer {
  private readonly items: ItemStack[];

  constructor(size: number) {
    super();
    this.items = new Array(size).fill(ItemStack.EMPTY);
  }

  getContainerSize(): number { return this.items.length; }
  getItem(slot: number): ItemStack {
    return slot >= 0 && slot < this.items.length ? this.items[slot] : ItemStack.EMPTY;
  }
  setItem(slot: number, stack: ItemStack): void {
    if (slot >= 0 && slot < this.items.length) this.items[slot] = stack;
  }
  removeItem(slot: number, count: number): ItemStack {
    const r = ContainerHelper.removeItem(this.items, slot, count);
    if (!r.isEmpty()) this.setChanged();
    return r;
  }
  removeItemNoUpdate(slot: number): ItemStack {
    return ContainerHelper.takeItem(this.items, slot);
  }
}

/** Port of net.minecraft.world.inventory.ContainerData / SimpleContainerData. */
export interface ContainerData {
  getCount(): number;
  get(index: number): number;
  set(index: number, value: number): void;
}

export class SimpleContainerData implements ContainerData {
  private readonly values: number[];
  constructor(size: number) { this.values = new Array(size).fill(0); }
  getCount(): number { return this.values.length; }
  get(index: number): number { return this.values[index] ?? 0; }
  set(index: number, value: number): void { this.values[index] = value; }
}

/** Port of net.minecraft.world.inventory.DataSlot. */
export class DataSlot {
  private value: number;
  constructor(private readonly data: ContainerData, private readonly index: number) {
    this.value = data.get(index);
  }
  get(): number { return this.data.get(this.index); }
  set(value: number): void {
    this.data.set(this.index, value);
    this.value = value;
  }
  checkAndClearUpdateFlag(): boolean {
    const cur = this.data.get(this.index);
    const changed = cur !== this.value;
    this.value = cur;
    return changed;
  }
  static forContainer(data: ContainerData, index: number): DataSlot { return new DataSlot(data, index); }
}
