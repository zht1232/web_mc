// Source: net.minecraft.world.inventory.AbstractContainerMenu (26.2)
//         net.minecraft.world.inventory.ContainerInput / ClickAction
//
// Port of doClick() covering PICKUP / QUICK_MOVE / SWAP / CLONE / THROW /
// QUICK_CRAFT / PICKUP_ALL, plus moveItemStackTo and the quick-craft helpers.
// Network synchronisation, crash reports and item-override hooks are omitted.

import { ItemStack } from '../item/ItemStack.js';
import type { Container, ContainerData } from './Container.js';
import { DataSlot } from './Container.js';
import { Slot } from './Slot.js';
import {
  ClickAction, ContainerInput, SLOT_CLICKED_OUTSIDE,
  QUICKCRAFT_HEADER_START, QUICKCRAFT_HEADER_CONTINUE, QUICKCRAFT_HEADER_END,
  getQuickcraftType, getQuickcraftHeader, isValidQuickcraftType,
  canItemQuickReplace, getQuickCraftPlaceCount,
} from './ClickAction.js';

/** The small part of Player that container clicks actually use. */
export interface InventoryAccess {
  getItem(slot: number): ItemStack;
  setItem(slot: number, stack: ItemStack): void;
  add(stack: ItemStack): boolean;
}
export interface MenuPlayer {
  readonly inventory: InventoryAccess;
  readonly infiniteMaterials: boolean;
  drop(stack: ItemStack): void;
  canDropItems(): boolean;
}

export abstract class AbstractContainerMenu {
  readonly slots: Slot[] = [];
  private readonly lastSlots: ItemStack[] = [];
  private readonly dataSlots: DataSlot[] = [];
  private carried: ItemStack = ItemStack.EMPTY;
  private stateId = 0;
  readonly containerId: number;
  readonly menuType: string;

  private quickcraftType = -1;
  private quickcraftStatus = 0;
  private readonly quickcraftSlots = new Set<Slot>();

  constructor(menuType: string, containerId: number) {
    this.menuType = menuType;
    this.containerId = containerId;
  }

  // ---- slot construction --------------------------------------------------

  protected addSlot(slot: Slot): Slot {
    slot.index = this.slots.length;
    this.slots.push(slot);
    this.lastSlots.push(ItemStack.EMPTY);
    return slot;
  }
  protected addDataSlot(slot: DataSlot): DataSlot { this.dataSlots.push(slot); return slot; }
  protected addDataSlots(data: ContainerData): void {
    for (let i = 0; i < data.getCount(); i++) this.addDataSlot(DataSlot.forContainer(data, i));
  }

  protected addInventoryHotbarSlots(inventory: Container, left: number, top: number): void {
    for (let x = 0; x < 9; x++) this.addSlot(new Slot(inventory, x, left + x * 18, top));
  }
  protected addInventoryExtendedSlots(inventory: Container, left: number, top: number): void {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 9; x++) {
        this.addSlot(new Slot(inventory, x + (y + 1) * 9, left + x * 18, top + y * 18));
      }
    }
  }
  /** addStandardInventorySlots: 27 main slots then the 9 hotbar slots. */
  protected addStandardInventorySlots(inventory: Container, left: number, top: number): void {
    this.addInventoryExtendedSlots(inventory, left, top);
    this.addInventoryHotbarSlots(inventory, left, top + 58);
  }

  // ---- accessors ----------------------------------------------------------

  getSlot(index: number): Slot { return this.slots[index]; }
  getItems(): ItemStack[] {
    const out: ItemStack[] = new Array(this.slots.length);
    for (let i = 0; i < this.slots.length; i++) out[i] = this.slots[i].getItem();
    return out;
  }
  getCarried(): ItemStack { return this.carried; }
  setCarried(stack: ItemStack): void { this.carried = stack; }
  getStateId(): number { return this.stateId; }
  incrementStateId(): number { this.stateId = (this.stateId + 1) & 32767; return this.stateId; }
  getDataSlot(index: number): number { return this.dataSlots[index].get(); }
  setData(index: number, value: number): void { this.dataSlots[index].set(value); }

  isValidSlotIndex(index: number): boolean {
    return index === -1 || index === SLOT_CLICKED_OUTSIDE || index < this.slots.length;
  }

  /** AbstractContainerMenu.slotsChanged -> broadcastChanges + subclass hook. */
  slotsChanged(container: unknown): void {
    this.onSlotsChanged(container);
    this.broadcastChanges();
  }
  protected onSlotsChanged(_container: unknown): void {}

  /** Simplified broadcastChanges: refresh lastSlots and data-slot snapshots. */
  broadcastChanges(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const current = this.slots[i].getItem();
      if (!ItemStack.matches(this.lastSlots[i], current)) this.lastSlots[i] = current.copy();
    }
    for (let i = 0; i < this.dataSlots.length; i++) this.dataSlots[i].checkAndClearUpdateFlag();
  }

  initializeContents(stateId: number, items: readonly ItemStack[], carried: ItemStack): void {
    for (let i = 0; i < items.length && i < this.slots.length; i++) this.slots[i].set(items[i]);
    this.carried = carried;
    this.stateId = stateId;
  }

  /** AbstractContainerMenu.removed: place the carried stack back in the inventory. */
  removed(player: MenuPlayer | null): void {
    if (player && !this.carried.isEmpty()) {
      player.inventory.add(this.carried);
      this.setCarried(ItemStack.EMPTY);
    }
  }

  // ---- abstract API -------------------------------------------------------

  abstract quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack;
  abstract stillValid(player: MenuPlayer | null): boolean;
  canTakeItemForPickAll(_carried: ItemStack, _target: Slot): boolean { return true; }
  canDragTo(_slot: Slot): boolean { return true; }

  // ---- clicking -----------------------------------------------------------

  clicked(slotIndex: number, buttonNum: number, input: ContainerInput, player: MenuPlayer | null): void {
    this.doClick(slotIndex, buttonNum, input, player);
  }

  private doClick(slotIndex: number, buttonNum: number, input: ContainerInput, player: MenuPlayer | null): void {
    const inventory = player ? player.inventory : null;

    if (input === ContainerInput.QUICK_CRAFT) {
      const expectedStatus = this.quickcraftStatus;
      this.quickcraftStatus = getQuickcraftHeader(buttonNum);
      if ((expectedStatus !== 1 || this.quickcraftStatus !== 2) && expectedStatus !== this.quickcraftStatus) {
        this.resetQuickCraft();
      } else if (this.getCarried().isEmpty()) {
        this.resetQuickCraft();
      } else if (this.quickcraftStatus === QUICKCRAFT_HEADER_START) {
        this.quickcraftType = getQuickcraftType(buttonNum);
        if (isValidQuickcraftType(this.quickcraftType, !!player?.infiniteMaterials)) {
          this.quickcraftStatus = 1;
          this.quickcraftSlots.clear();
        } else {
          this.resetQuickCraft();
        }
      } else if (this.quickcraftStatus === QUICKCRAFT_HEADER_CONTINUE) {
        const slot = this.slots[slotIndex];
        const carriedItemStack = this.getCarried();
        if (slot && canItemQuickReplace(slot, carriedItemStack, true)
          && slot.mayPlace(carriedItemStack)
          && (this.quickcraftType === 2 || carriedItemStack.getCount() > this.quickcraftSlots.size)
          && this.canDragTo(slot)) {
          this.quickcraftSlots.add(slot);
        }
      } else if (this.quickcraftStatus === QUICKCRAFT_HEADER_END) {
        this.finishQuickCraft(player);
      } else {
        this.resetQuickCraft();
      }
    } else if (this.quickcraftStatus !== 0) {
      this.resetQuickCraft();
    } else if ((input === ContainerInput.PICKUP || input === ContainerInput.QUICK_MOVE) && (buttonNum === 0 || buttonNum === 1)) {
      const action: ClickAction = buttonNum === 0 ? ClickAction.PRIMARY : ClickAction.SECONDARY;
      if (slotIndex === SLOT_CLICKED_OUTSIDE) {
        if (!this.getCarried().isEmpty()) {
          if (action === ClickAction.PRIMARY) {
            if (player) player.drop(this.getCarried());
            this.setCarried(ItemStack.EMPTY);
          } else if (player) {
            player.drop(this.getCarried().split(1));
          }
        }
      } else if (input === ContainerInput.QUICK_MOVE) {
        if (slotIndex < 0 || slotIndex >= this.slots.length) return;
        const slot = this.slots[slotIndex];
        if (!slot.mayPickup(player)) return;
        let clicked = this.quickMoveStack(player, slotIndex);
        while (!clicked.isEmpty() && ItemStack.isSameItem(slot.getItem(), clicked)) {
          clicked = this.quickMoveStack(player, slotIndex);
        }
      } else {
        if (slotIndex < 0 || slotIndex >= this.slots.length) return;
        this.doPickup(slotIndex, action, player);
      }
    } else if (input === ContainerInput.SWAP && (buttonNum >= 0 && buttonNum < 9 || buttonNum === 40)) {
      if (!inventory) return;
      this.doSwap(slotIndex, buttonNum, player, inventory);
    } else if (input === ContainerInput.CLONE && player?.infiniteMaterials && this.getCarried().isEmpty() && slotIndex >= 0) {
      const slot = this.slots[slotIndex];
      if (slot && slot.hasItem()) this.setCarried(slot.safeClone(player));
    } else if (input === ContainerInput.THROW && this.getCarried().isEmpty() && slotIndex >= 0 && player?.canDropItems()) {
      const slot = this.slots[slotIndex];
      const amount = buttonNum === 0 ? 1 : slot.getItem().getCount();
      const dropped = slot.safeTake(amount, Number.MAX_SAFE_INTEGER, player);
      player.drop(dropped);
      if (buttonNum === 1) {
        while (!dropped.isEmpty() && ItemStack.isSameItem(slot.getItem(), dropped)) {
          if (!player.canDropItems()) break;
          const more = slot.safeTake(amount, Number.MAX_SAFE_INTEGER, player);
          if (more.isEmpty()) break;
          player.drop(more);
        }
      }
    } else if (input === ContainerInput.PICKUP_ALL && slotIndex >= 0) {
      this.doPickupAll(slotIndex, buttonNum, player);
    }
  }

  /** PICKUP branch of AbstractContainerMenu.doClick. */
  private doPickup(slotIndex: number, action: ClickAction, player: MenuPlayer | null): void {
    const slot = this.slots[slotIndex];
    const clicked = slot.getItem();
    const carried = this.getCarried();
    if (clicked.isEmpty()) {
      if (!carried.isEmpty()) {
        const amount = action === ClickAction.PRIMARY ? carried.getCount() : 1;
        this.setCarried(slot.safeInsert(carried, amount));
      }
    } else if (slot.mayPickup(player)) {
      if (carried.isEmpty()) {
        const amount = action === ClickAction.PRIMARY ? clicked.getCount() : Math.floor((clicked.getCount() + 1) / 2);
        const newCarried = slot.tryRemove(amount, Number.MAX_SAFE_INTEGER, player);
        if (newCarried) {
          this.setCarried(newCarried);
          slot.onTake(player, newCarried);
        }
      } else if (slot.mayPlace(carried)) {
        if (ItemStack.isSameItemSameComponents(clicked, carried)) {
          const amount = action === ClickAction.PRIMARY ? carried.getCount() : 1;
          this.setCarried(slot.safeInsert(carried, amount));
        } else if (carried.getCount() <= slot.getMaxStackSize(carried)) {
          this.setCarried(clicked);
          slot.setByPlayer(carried);
        }
      } else if (ItemStack.isSameItemSameComponents(clicked, carried)) {
        const newCarried = slot.tryRemove(clicked.getCount(), carried.getMaxStackSize() - carried.getCount(), player);
        if (newCarried) {
          carried.grow(newCarried.getCount());
          slot.onTake(player, newCarried);
        }
      }
    }
    slot.setChanged();
  }

  /** SWAP branch (number keys / offhand). */
  private doSwap(slotIndex: number, buttonNum: number, player: MenuPlayer | null, inventory: InventoryAccess): void {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;
    const source = inventory.getItem(buttonNum);
    const target = this.slots[slotIndex];
    const targetItemStack = target.getItem();
    if (source.isEmpty() && targetItemStack.isEmpty()) return;
    if (source.isEmpty()) {
      if (target.mayPickup(player)) {
        inventory.setItem(buttonNum, targetItemStack);
        target.setByPlayer(ItemStack.EMPTY);
        target.onTake(player, targetItemStack);
      }
    } else if (targetItemStack.isEmpty()) {
      if (target.mayPlace(source)) {
        const maxStackSize = target.getMaxStackSize(source);
        if (source.getCount() > maxStackSize) target.setByPlayer(source.split(maxStackSize));
        else { inventory.setItem(buttonNum, ItemStack.EMPTY); target.setByPlayer(source); }
      }
    } else if (target.mayPickup(player) && target.mayPlace(source)) {
      const maxStackSize = target.getMaxStackSize(source);
      if (source.getCount() > maxStackSize) {
        target.setByPlayer(source.split(maxStackSize));
        target.onTake(player, targetItemStack);
        if (!inventory.add(targetItemStack) && player) player.drop(targetItemStack);
      } else {
        inventory.setItem(buttonNum, targetItemStack);
        target.setByPlayer(source);
        target.onTake(player, targetItemStack);
      }
    }
  }

  /** PICKUP_ALL branch (double-click collect). */
  private doPickupAll(slotIndex: number, buttonNum: number, player: MenuPlayer | null): void {
    const slot = this.slots[slotIndex];
    const carried = this.getCarried();
    if (slotIndex >= this.slots.length || carried.isEmpty()) return;
    if (slot.hasItem() && slot.mayPickup(player)) return;
    const start = buttonNum === 0 ? 0 : this.slots.length - 1;
    const step = buttonNum === 0 ? 1 : -1;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = start; i >= 0 && i < this.slots.length && carried.getCount() < carried.getMaxStackSize(); i += step) {
        const target = this.slots[i];
        if (target.hasItem() && canItemQuickReplace(target, carried, true)
          && target.mayPickup(player) && this.canTakeItemForPickAll(carried, target)) {
          const itemStack = target.getItem();
          if (pass !== 0 || itemStack.getCount() !== itemStack.getMaxStackSize()) {
            const removed = target.safeTake(itemStack.getCount(), carried.getMaxStackSize() - carried.getCount(), player);
            carried.grow(removed.getCount());
          }
        }
      }
    }
  }

  private finishQuickCraft(player: MenuPlayer | null): void {
    if (this.quickcraftSlots.size !== 0) {
      if (this.quickcraftSlots.size === 1) {
        const slot = this.quickcraftSlots.values().next().value as Slot;
        this.resetQuickCraft();
        this.doClick(slot.index, this.quickcraftType, ContainerInput.PICKUP, player);
        return;
      }
      const source = this.getCarried().copy();
      if (source.isEmpty()) { this.resetQuickCraft(); return; }
      let remaining = this.getCarried().getCount();
      const size = this.quickcraftSlots.size;
      for (const slot of this.quickcraftSlots) {
        const carriedItemStack = this.getCarried();
        if (slot && canItemQuickReplace(slot, carriedItemStack, true)
          && slot.mayPlace(carriedItemStack)
          && (this.quickcraftType === 2 || carriedItemStack.getCount() >= size)
          && this.canDragTo(slot)) {
          const carry = slot.hasItem() ? slot.getItem().getCount() : 0;
          const maxSize = Math.min(source.getMaxStackSize(), slot.getMaxStackSize(source));
          const newCount = Math.min(getQuickCraftPlaceCount(size, this.quickcraftType, source) + carry, maxSize);
          remaining -= newCount - carry;
          slot.setByPlayer(source.copyWithCount(newCount));
        }
      }
      source.setCount(Math.max(0, remaining));
      this.setCarried(source);
    }
    this.resetQuickCraft();
  }

  resetQuickCraft(): void {
    this.quickcraftStatus = 0;
    this.quickcraftSlots.clear();
  }

  // ---- transfer -----------------------------------------------------------

  /** AbstractContainerMenu.moveItemStackTo. */
  protected moveItemStackTo(stack: ItemStack, startSlot: number, endSlot: number, backwards: boolean): boolean {
    let anythingChanged = false;
    let destSlot = backwards ? endSlot - 1 : startSlot;

    if (stack.isStackable()) {
      while (!stack.isEmpty() && (backwards ? destSlot >= startSlot : destSlot < endSlot)) {
        const slot = this.slots[destSlot];
        if (slot) {
          const target = slot.getItem();
          if (!target.isEmpty() && ItemStack.isSameItemSameComponents(stack, target)) {
            const totalStack = target.getCount() + stack.getCount();
            const maxStackSize = slot.getMaxStackSize(target);
            if (totalStack <= maxStackSize) {
              stack.setCount(0);
              target.setCount(totalStack);
              slot.setChanged();
              anythingChanged = true;
            } else if (target.getCount() < maxStackSize) {
              stack.shrink(maxStackSize - target.getCount());
              target.setCount(maxStackSize);
              slot.setChanged();
              anythingChanged = true;
            }
          }
        }
        if (backwards) destSlot--; else destSlot++;
      }
    }

    if (!stack.isEmpty()) {
      destSlot = backwards ? endSlot - 1 : startSlot;
      while (backwards ? destSlot >= startSlot : destSlot < endSlot) {
        const slot = this.slots[destSlot];
        if (slot) {
          const target = slot.getItem();
          if (target.isEmpty() && slot.mayPlace(stack)) {
            const maxStackSize = slot.getMaxStackSize(stack);
            slot.setByPlayer(stack.split(Math.min(stack.getCount(), maxStackSize)));
            slot.setChanged();
            anythingChanged = true;
            break;
          }
        }
        if (backwards) destSlot--; else destSlot++;
      }
    }
    return anythingChanged;
  }
}
