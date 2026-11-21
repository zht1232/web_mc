// Source: net.minecraft.world.inventory.Slot (26.2)
//         net.minecraft.world.inventory.ResultSlot / ArmorSlot
//         net.minecraft.world.inventory.FurnaceResultSlot / FurnaceFuelSlot

import { ItemStack } from '../item/ItemStack.js';
import type { Container } from './Container.js';

/** Player is only ever passed through; keep menus decoupled from entity classes. */
export type PlayerRef = unknown;

export class Slot {
  readonly container: Container;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  /** Filled in by AbstractContainerMenu.addSlot. */
  index = -1;

  constructor(container: Container, slot: number, x: number, y: number) {
    this.container = container;
    this.slot = slot;
    this.x = x;
    this.y = y;
  }

  onQuickCraft(picked: ItemStack, original: ItemStack): void {
    const count = original.getCount() - picked.getCount();
    if (count > 0) this.onQuickCraftCount(picked, count);
  }
  protected onQuickCraftCount(_picked: ItemStack, _count: number): void {}
  protected onSwapCraft(_count: number): void {}
  protected checkTakeAchievements(_carried: ItemStack): void {}

  onTake(_player: PlayerRef, _carried: ItemStack): void { this.setChanged(); }
  mayPlace(_stack: ItemStack): boolean { return true; }
  getItem(): ItemStack { return this.container.getItem(this.slot); }
  hasItem(): boolean { return !this.getItem().isEmpty(); }

  setByPlayer(stack: ItemStack, _previous?: ItemStack): void { this.set(stack); }
  set(stack: ItemStack): void {
    this.container.setItem(this.slot, stack);
    this.setChanged();
  }
  setChanged(): void { this.container.setChanged(); }

  getMaxStackSize(stack?: ItemStack): number {
    return stack ? Math.min(this.container.getMaxStackSize(), stack.getMaxStackSize()) : this.container.getMaxStackSize();
  }
  getNoItemIcon(): string | null { return null; }

  remove(amount: number): ItemStack { return this.container.removeItem(this.slot, amount); }
  mayPickup(_player: PlayerRef): boolean { return true; }
  isActive(): boolean { return true; }
  isFake(): boolean { return false; }

  /** Slot.tryRemove -> Optional<ItemStack>; null means "no removal". */
  tryRemove(amount: number, maxAmount: number, _player: PlayerRef): ItemStack | null {
    if (!this.mayPickup(_player)) return null;
    if (!this.allowModification(_player) && maxAmount < this.getItem().getCount()) return null;
    const n = Math.min(amount, maxAmount);
    const result = this.remove(n);
    if (result.isEmpty()) return null;
    if (this.getItem().isEmpty()) this.setByPlayer(ItemStack.EMPTY, result);
    return result;
  }

  safeTake(amount: number, maxAmount: number, player: PlayerRef): ItemStack {
    const result = this.tryRemove(amount, maxAmount, player);
    if (result) this.onTake(player, result);
    return result ?? ItemStack.EMPTY;
  }

  safeClone(_player: PlayerRef): ItemStack {
    const item = this.getItem();
    return item.copyWithCount(item.getMaxStackSize());
  }

  /** Slot.safeInsert: returns the leftover carried stack. */
  safeInsert(inputStack: ItemStack, inputAmount = inputStack.getCount()): ItemStack {
    if (inputStack.isEmpty() || !this.mayPlace(inputStack)) return inputStack;
    const slotStack = this.getItem();
    const transferable = Math.min(
      Math.min(inputAmount, inputStack.getCount()),
      this.getMaxStackSize(inputStack) - slotStack.getCount(),
    );
    if (transferable <= 0) return inputStack;
    if (slotStack.isEmpty()) {
      this.setByPlayer(inputStack.split(transferable));
    } else if (ItemStack.isSameItemSameComponents(slotStack, inputStack)) {
      inputStack.shrink(transferable);
      slotStack.grow(transferable);
      this.setByPlayer(slotStack);
    }
    return inputStack;
  }

  allowModification(player: PlayerRef): boolean {
    return this.mayPickup(player) && this.mayPlace(this.getItem());
  }
  getContainerSlot(): number { return this.slot; }
  isHighlightable(): boolean { return true; }
}

/** Result of a crafting grid: cannot be placed into; tracks removal count. */
export class ResultSlot extends Slot {
  protected removeCount = 0;
  /** Set by the owning AbstractCraftingMenu to consume inputs on take. */
  onTakeRecipe?: (player: PlayerRef, carried: ItemStack) => void;
  /** Set by the owning menu: Stats.ITEM_CRAFTED (item short name + taken count). */
  onCrafted?: (itemName: string, count: number) => void;
  private lastRemovedItem: string | null = null;

  override mayPlace(_stack: ItemStack): boolean { return false; }
  override remove(amount: number): ItemStack {
    const stack = this.getItem();
    if (stack.item) this.lastRemovedItem = stack.item.name;
    if (this.hasItem()) this.removeCount += Math.min(amount, this.getItem().getCount());
    return super.remove(amount);
  }
  protected override onQuickCraftCount(_picked: ItemStack, count: number): void { this.removeCount += count; }
  protected override onSwapCraft(count: number): void { this.removeCount += count; }
  override onTake(player: PlayerRef, carried: ItemStack): void {
    if (this.onTakeRecipe) this.onTakeRecipe(player, carried);
    if (this.onCrafted && this.lastRemovedItem && this.removeCount > 0) {
      this.onCrafted(this.lastRemovedItem, this.removeCount);
    }
    this.removeCount = 0;
    this.lastRemovedItem = null;
    super.onTake(player, carried);
  }
  override isFake(): boolean { return true; }
}

/** Armor slot: accepts exactly one item whose equip matches the slot. */
export class ArmorSlot extends Slot {
  constructor(container: Container, slot: number, x: number, y: number, private readonly equip: string) {
    super(container, slot, x, y);
  }
  override getMaxStackSize(): number { return 1; }
  override mayPlace(stack: ItemStack): boolean {
    return !stack.isEmpty() && stack.item !== null && stack.item.equip === this.equip;
  }
  override mayPickup(_player: PlayerRef): boolean { return true; }
  override getNoItemIcon(): string { return `container/slot/${this.equip.toLowerCase()}`; }
}

/** Furnace result slot: cannot place; grants stored experience on take. */
export class FurnaceResultSlot extends Slot {
  /** Set by the owning AbstractFurnaceMenu: Stats.ITEM_CRAFTED on take. */
  onCrafted?: (itemName: string, count: number) => void;
  private lastRemovedItem: string | null = null;
  private takenCount = 0;

  constructor(
    container: Container, slot: number, x: number, y: number,
    private readonly experienceTaker: (player: PlayerRef) => void,
  ) { super(container, slot, x, y); }
  override mayPlace(_stack: ItemStack): boolean { return false; }
  override remove(amount: number): ItemStack {
    const stack = this.getItem();
    if (stack.item) this.lastRemovedItem = stack.item.name;
    if (this.hasItem()) this.takenCount += Math.min(amount, this.getItem().getCount());
    return super.remove(amount);
  }
  override onTake(player: PlayerRef, carried: ItemStack): void {
    this.experienceTaker(player);
    if (this.onCrafted && this.lastRemovedItem && this.takenCount > 0) {
      this.onCrafted(this.lastRemovedItem, this.takenCount);
    }
    this.takenCount = 0;
    this.lastRemovedItem = null;
    super.onTake(player, carried);
  }
}

/** Furnace fuel slot: only fuel items (or empty buckets) may be placed. */
export class FurnaceFuelSlot extends Slot {
  constructor(
    container: Container, slot: number, x: number, y: number,
    private readonly isFuel: (stack: ItemStack) => boolean,
  ) { super(container, slot, x, y); }
  override mayPlace(stack: ItemStack): boolean { return this.isFuel(stack) || stack.is('bucket'); }
}
