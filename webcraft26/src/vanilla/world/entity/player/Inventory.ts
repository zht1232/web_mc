// Source: net.minecraft.world.entity.player.Inventory (26.2)
//         net.minecraft.world.entity.player.Player#hurtArmor / #getDestroySpeed
//         net.minecraft.world.ContainerHelper#clearOrCountMatchingItems
//
// 36 general slots (0..8 hotbar, 9..35 main) plus the equipment slots
// 36 FEET, 37 LEGS, 38 CHEST, 39 HEAD, 40 OFFHAND, 41 BODY, 42 SADDLE.

import type { MinecraftData } from '../../level/block/state/BlockState.js';
import { ItemStack } from '../../item/ItemStack.js';
import type { ItemRegistry } from '../../item/Item.js';
import { AbstractContainer, ContainerHelper, type Container } from '../../inventory/Container.js';

export const INVENTORY_SIZE = 36;
export const SELECTION_SIZE = 9;
export const SLOT_OFFHAND = 40;
export const SLOT_BODY_ARMOR = 41;
export const SLOT_SADDLE = 42;
export const NOT_FOUND_INDEX = -1;

export type EquipSlot = 'FEET' | 'LEGS' | 'CHEST' | 'HEAD' | 'OFFHAND' | 'BODY' | 'SADDLE';

/** Inventory.EQUIPMENT_SLOT_MAPPING (container slot -> equipment slot). */
export const EQUIPMENT_SLOT_MAPPING: Readonly<Record<number, EquipSlot>> = {
  36: 'FEET', 37: 'LEGS', 38: 'CHEST', 39: 'HEAD',
  40: 'OFFHAND', 41: 'BODY', 42: 'SADDLE',
};
export const ARMOR_SLOTS = [36, 37, 38, 39] as const;

export class PlayerInventory extends AbstractContainer {
  private readonly items: ItemStack[] = new Array(INVENTORY_SIZE).fill(ItemStack.EMPTY);
  private readonly equipment = new Map<number, ItemStack>();
  private selected = 0;
  private timesChanged = 0;
  readonly mc: MinecraftData;
  readonly registry: ItemRegistry;

  constructor(mc: MinecraftData, registry: ItemRegistry) {
    super();
    this.mc = mc;
    this.registry = registry;
    for (const k of Object.keys(EQUIPMENT_SLOT_MAPPING)) this.equipment.set(Number(k), ItemStack.EMPTY);
  }

  // ---- selection ----------------------------------------------------------

  getSelectedSlot(): number { return this.selected; }
  setSelectedSlot(slot: number): void {
    if (slot >= 0 && slot < SELECTION_SIZE) this.selected = slot;
  }
  getSelectedItem(): ItemStack { return this.items[this.selected]; }
  setSelectedItem(stack: ItemStack): ItemStack {
    const prev = this.items[this.selected];
    this.items[this.selected] = stack;
    return prev;
  }
  static isHotbarSlot(slot: number): boolean { return slot >= 0 && slot < SELECTION_SIZE; }
  getSuitableHotbarSlot(): number {
    for (let i = 0; i < SELECTION_SIZE; i++) {
      const index = (this.selected + i) % SELECTION_SIZE;
      if (this.items[index].isEmpty()) return index;
    }
    for (let i = 0; i < SELECTION_SIZE; i++) {
      const index = (this.selected + i) % SELECTION_SIZE;
      if (!this.items[index].isEnchanted()) return index;
    }
    return this.selected;
  }
  addAndPickItem(stack: ItemStack): void {
    this.selected = this.getSuitableHotbarSlot();
    if (!this.items[this.selected].isEmpty()) {
      const free = this.getFreeSlot();
      if (free !== -1) this.items[free] = this.items[this.selected];
    }
    this.items[this.selected] = stack;
  }

  // ---- Container ----------------------------------------------------------

  override getContainerSize(): number { return INVENTORY_SIZE + Object.keys(EQUIPMENT_SLOT_MAPPING).length; }
  override getMaxStackSize(): number { return 64; }
  getMaxStackSizeFor(stack: ItemStack): number { return Math.min(this.getMaxStackSize(), stack.getMaxStackSize()); }

  override getItem(slot: number): ItemStack {
    if (slot < INVENTORY_SIZE) return this.items[slot] ?? ItemStack.EMPTY;
    return this.equipment.get(slot) ?? ItemStack.EMPTY;
  }
  override setItem(slot: number, stack: ItemStack): void {
    if (slot < INVENTORY_SIZE) this.items[slot] = stack;
    else if (EQUIPMENT_SLOT_MAPPING[slot]) this.equipment.set(slot, stack);
  }
  override removeItemNoUpdate(slot: number): ItemStack {
    if (slot < INVENTORY_SIZE) {
      const prev = this.items[slot] ?? ItemStack.EMPTY;
      this.items[slot] = ItemStack.EMPTY;
      return prev;
    }
    if (EQUIPMENT_SLOT_MAPPING[slot]) {
      const prev = this.equipment.get(slot) ?? ItemStack.EMPTY;
      this.equipment.set(slot, ItemStack.EMPTY);
      return prev;
    }
    return ItemStack.EMPTY;
  }
  override removeItem(slot: number, count: number): ItemStack {
    if (slot < INVENTORY_SIZE) return ContainerHelper.removeItem(this.items, slot, count);
    const stack = this.equipment.get(slot);
    if (stack && !stack.isEmpty()) return stack.split(count);
    return ItemStack.EMPTY;
  }
  override setChanged(): void { this.timesChanged++; }
  getTimesChanged(): number { return this.timesChanged; }
  override stillValid(_player: unknown): boolean { return true; }

  // ---- adding items (Inventory.add) ---------------------------------------

  private hasRemainingSpaceForItem(slotItem: ItemStack, newItem: ItemStack): boolean {
    return !slotItem.isEmpty()
      && ItemStack.isSameItemSameComponents(slotItem, newItem)
      && slotItem.isStackable()
      && slotItem.getCount() < this.getMaxStackSizeFor(slotItem);
  }

  getFreeSlot(): number {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].isEmpty()) return i;
    return NOT_FOUND_INDEX;
  }

  getSlotWithRemainingSpace(newItem: ItemStack): number {
    if (this.hasRemainingSpaceForItem(this.getItem(this.selected), newItem)) return this.selected;
    if (this.hasRemainingSpaceForItem(this.getItem(SLOT_OFFHAND), newItem)) return SLOT_OFFHAND;
    for (let i = 0; i < this.items.length; i++) {
      if (this.hasRemainingSpaceForItem(this.items[i], newItem)) return i;
    }
    return NOT_FOUND_INDEX;
  }

  private addResourceAuto(stack: ItemStack): number {
    let slot = this.getSlotWithRemainingSpace(stack);
    if (slot === NOT_FOUND_INDEX) slot = this.getFreeSlot();
    return slot === NOT_FOUND_INDEX ? stack.getCount() : this.addResource(slot, stack);
  }

  private addResource(slot: number, stack: ItemStack): number {
    let count = stack.getCount();
    let inSlot = this.getItem(slot);
    if (inSlot.isEmpty()) {
      inSlot = stack.copyWithCount(0);
      this.setItem(slot, inSlot);
    }
    const maxToAdd = this.getMaxStackSizeFor(inSlot) - inSlot.getCount();
    const toAdd = Math.min(count, maxToAdd);
    if (toAdd === 0) return count;
    count -= toAdd;
    inSlot.grow(toAdd);
    inSlot.setPopTime(5);
    return count;
  }

  /** Inventory.add(-1, stack): returns true if at least one item was stored. */
  add(stack: ItemStack): boolean { return this.addTo(-1, stack); }
  addTo(slot: number, stack: ItemStack): boolean {
    if (stack.isEmpty()) return false;
    if (stack.isDamaged()) {
      let target = slot;
      if (target === -1) target = this.getFreeSlot();
      if (target >= 0) {
        this.setItem(target, stack.copyAndClear());
        this.getItem(target).setPopTime(5);
        return true;
      }
      return false;
    }
    let lastSize: number;
    do {
      lastSize = stack.getCount();
      if (slot === -1) stack.setCount(this.addResourceAuto(stack));
      else stack.setCount(this.addResource(slot, stack));
    } while (!stack.isEmpty() && stack.getCount() < lastSize);
    return stack.getCount() < lastSize;
  }

  placeItemBackInInventory(stack: ItemStack): void {
    while (!stack.isEmpty()) {
      let slot = this.getSlotWithRemainingSpace(stack);
      if (slot === NOT_FOUND_INDEX) slot = this.getFreeSlot();
      if (slot === NOT_FOUND_INDEX) return; // no space: caller drops it
      const space = stack.getMaxStackSize() - this.getItem(slot).getCount();
      this.addTo(slot, stack.split(space));
    }
  }

  // ---- queries ------------------------------------------------------------

  findSlotMatchingItem(stack: ItemStack): number {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].isEmpty() && ItemStack.isSameItemSameComponents(stack, this.items[i])) return i;
    }
    return NOT_FOUND_INDEX;
  }

  /** Inventory.clearOrCountMatchingItems (self + optional craft slots). */
  clearOrCountMatchingItems(
    predicate: (s: ItemStack) => boolean,
    amountToRemove: number,
    craftSlots?: Container,
  ): number {
    let count = 0;
    const countingOnly = amountToRemove === 0;
    count += this.clearContainerMatching(this, predicate, amountToRemove - count, countingOnly);
    if (craftSlots) count += this.clearContainerMatching(craftSlots, predicate, amountToRemove - count, countingOnly);
    return count;
  }

  private clearContainerMatching(
    container: Container, predicate: (s: ItemStack) => boolean, amount: number, countingOnly: boolean,
  ): number {
    let count = 0;
    for (let i = 0; i < container.getContainerSize(); i++) {
      const stack = container.getItem(i);
      const removed = ContainerHelper.clearOrCountMatchingItems(stack, predicate, amount - count, countingOnly);
      if (removed > 0 && !countingOnly && stack.isEmpty()) container.setItem(i, ItemStack.EMPTY);
      count += removed;
    }
    return count;
  }

  contains(predicate: (s: ItemStack) => boolean): boolean {
    for (let i = 0; i < this.getContainerSize(); i++) if (predicate(this.getItem(i))) return true;
    return false;
  }
  containsItem(stack: ItemStack): boolean {
    for (let i = 0; i < this.getContainerSize(); i++) {
      const s = this.getItem(i);
      if (!s.isEmpty() && ItemStack.isSameItemSameComponents(s, stack)) return true;
    }
    return false;
  }

  // ---- gameplay -----------------------------------------------------------

  /** Player.getDestroySpeed (item part): the selected stack's mining speed. */
  getDestroySpeed(state: number): number {
    return this.getSelectedItem().getDestroySpeed(state, this.mc);
  }

  /** Player.hurtArmor -> LivingEntity.doHurtEquipment(FEET, LEGS, CHEST, HEAD). */
  hurtArmor(damage: number): void {
    if (damage <= 0) return;
    const durabilityDamage = Math.max(1, Math.floor(damage / 4));
    for (const slot of ARMOR_SLOTS) {
      const stack = this.getItem(slot);
      if (stack.isDamageableItem()) stack.hurtAndBreak(durabilityDamage);
    }
  }

  /** Sum of equipped armor defense / toughness (CombatRules inputs). */
  getArmorValue(): number {
    let total = 0;
    for (const slot of ARMOR_SLOTS) {
      const a = this.getItem(slot).item?.armor;
      if (a) total += a.defense;
    }
    return total;
  }
  getArmorToughness(): number {
    let total = 0;
    for (const slot of ARMOR_SLOTS) {
      const a = this.getItem(slot).item?.armor;
      if (a) total += a.toughness;
    }
    return total;
  }

  /** Inventory.tick: decay pop-time animation; per-item inventoryTick is a no-op here. */
  tick(): void {
    for (let i = 0; i < this.getContainerSize(); i++) {
      const stack = this.getItem(i);
      if (!stack.isEmpty() && stack.getPopTime() > 0) stack.setPopTime(stack.getPopTime() - 1);
    }
  }

  removeFromSelected(all: boolean): ItemStack {
    const selected = this.getSelectedItem();
    return selected.isEmpty() ? ItemStack.EMPTY : this.removeItem(this.selected, all ? selected.getCount() : 1);
  }

  dropAll(): ItemStack[] {
    const dropped: ItemStack[] = [];
    for (let i = 0; i < this.getContainerSize(); i++) {
      const stack = this.getItem(i);
      if (!stack.isEmpty()) { dropped.push(stack); this.setItem(i, ItemStack.EMPTY); }
    }
    return dropped;
  }

  /** Replace this inventory's contents with another (Inventory.replaceWith). */
  replaceWith(other: PlayerInventory): void {
    for (let i = 0; i < this.getContainerSize(); i++) this.setItem(i, other.getItem(i));
    this.selected = other.getSelectedSlot();
  }
}
