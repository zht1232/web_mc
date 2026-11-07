// Source: net.minecraft.world.item.ItemStack (26.2)
//         net.minecraft.core.component.DataComponents / PatchedDataComponentMap
//
// Kept as a flat, NBT-friendly structure: { id, count, components }. `components`
// mirrors the data-component patch (damage, custom_name, enchantments, unbreakable).
// The `item` field is a live reference into ItemRegistry (runtime-only, not serialized).

import type { Item } from './Item.js';
import type { ItemRegistry } from './Item.js';
import type { MinecraftData } from '../level/block/state/BlockState.js';
import { stripNamespace } from './MiningTool.js';

export interface ItemComponents {
  damage?: number;
  customName?: string;
  /** Enchantment id (short, e.g. "silk_touch") -> level. */
  enchantments?: Record<string, number>;
  unbreakable?: boolean;
}

export interface ItemStackNBT {
  id: string;
  count: number;
  components?: ItemComponents;
}

export class ItemStack {
  item: Item | null;
  count: number;
  components: ItemComponents;
  /** Vanilla ItemStack.popTime, used by Inventory.add to animate picked-up stacks. */
  popTime = 0;

  constructor(item: Item | null, count = 1, components?: ItemComponents) {
    this.item = item;
    this.count = count;
    this.components = components ? { ...components } : {};
    if (this.components.enchantments) this.components.enchantments = { ...this.components.enchantments };
  }

  static readonly EMPTY: ItemStack = new ItemStack(null, 0);

  static fromName(registry: ItemRegistry, name: string, count = 1): ItemStack {
    const item = registry.byName(name);
    return item ? new ItemStack(item, count) : ItemStack.EMPTY;
  }

  // ---- core state ---------------------------------------------------------

  isEmpty(): boolean { return this.item === null || this.count <= 0; }
  getItem(): Item | null { return this.item; }
  getCount(): number { return this.isEmpty() ? 0 : this.count; }
  setCount(count: number): void { this.count = count; }
  grow(amount: number): void { this.setCount(this.getCount() + amount); }
  shrink(amount: number): void { this.grow(-amount); }
  getPopTime(): number { return this.popTime; }
  setPopTime(t: number): void { this.popTime = t; }

  copy(): ItemStack {
    if (this.isEmpty()) return ItemStack.EMPTY;
    const c = new ItemStack(this.item, this.count, this.components);
    c.popTime = this.popTime;
    return c;
  }

  copyWithCount(count: number): ItemStack {
    if (this.isEmpty()) return ItemStack.EMPTY;
    const c = this.copy();
    c.setCount(count);
    return c;
  }

  /** ItemStack.split: returns `amount`, shrinking this stack. */
  split(amount: number): ItemStack {
    const real = Math.min(amount, this.getCount());
    const result = this.copyWithCount(real);
    this.shrink(real);
    return result;
  }

  copyAndClear(): ItemStack {
    if (this.isEmpty()) return ItemStack.EMPTY;
    const result = this.copy();
    this.setCount(0);
    return result;
  }

  limitSize(maxStackSize: number): void {
    if (!this.isEmpty() && this.getCount() > maxStackSize) this.setCount(maxStackSize);
  }

  // ---- component helpers --------------------------------------------------

  getMaxStackSize(): number { return this.item ? this.item.maxStack : 1; }
  isDamageableItem(): boolean {
    // A fresh item carries the DAMAGE component with its default (0); only
    // MAX_DAMAGE and UNBREAKABLE decide whether it can be damaged at all.
    return this.item !== null && this.item.maxDamage > 0 && !this.components.unbreakable;
  }
  getMaxDamage(): number { return this.item ? this.item.maxDamage : 0; }
  getDamageValue(): number {
    const d = this.components.damage ?? 0;
    return Math.max(0, Math.min(d, this.getMaxDamage()));
  }
  setDamageValue(value: number): void {
    this.components.damage = Math.max(0, Math.min(value, this.getMaxDamage()));
  }
  isDamaged(): boolean { return this.isDamageableItem() && this.getDamageValue() > 0; }
  isBroken(): boolean { return this.isDamageableItem() && this.getDamageValue() >= this.getMaxDamage(); }
  isStackable(): boolean {
    return this.getMaxStackSize() > 1 && (!this.isDamageableItem() || !this.isDamaged());
  }

  /** ItemStack.hurtAndBreak -> applyDamage: break removes one item from the stack. */
  hurtAndBreak(amount: number): void {
    if (!this.isDamageableItem() || amount <= 0) return;
    this.setDamageValue(this.getDamageValue() + amount);
    if (this.isBroken()) this.shrink(1);
  }

  getEnchantmentLevel(id: string): number {
    const e = this.components.enchantments;
    if (!e) return 0;
    const short = stripNamespace(id);
    return e[short] ?? e[id] ?? 0;
  }

  hasSilkTouch(): boolean { return this.getEnchantmentLevel('silk_touch') > 0; }
  getFortuneLevel(): number { return this.getEnchantmentLevel('fortune'); }
  /** Attributes.MINING_EFFICIENCY bonus contributed by Efficiency. */
  getEfficiency(): number {
    const lvl = this.getEnchantmentLevel('efficiency');
    return lvl > 0 ? lvl * lvl + 1 : 0;
  }
  isEnchanted(): boolean {
    const e = this.components.enchantments;
    return e !== undefined && Object.keys(e).length > 0;
  }
  hasCustomName(): boolean { return this.components.customName !== undefined; }

  // ---- equality (ItemStack.isSameItem / matches / isSameItemSameComponents) --

  is(itemName: string): boolean {
    if (this.isEmpty()) return itemName === 'air' || itemName === 'minecraft:air';
    const s = stripNamespace(itemName);
    return this.item!.name === s || this.item!.namespacedId === itemName;
  }

  static isSameItem(a: ItemStack, b: ItemStack): boolean {
    if (a.item === null || b.item === null) return a.item === b.item;
    return a.item.id === b.item.id;
  }

  static isSameItemSameComponents(a: ItemStack, b: ItemStack): boolean {
    if (!ItemStack.isSameItem(a, b)) return false;
    if (a.isEmpty() && b.isEmpty()) return true;
    return ItemStack.componentsEqual(a.components, b.components);
  }

  static matches(a: ItemStack, b: ItemStack): boolean {
    if (a === b) return true;
    return a.getCount() === b.getCount() && ItemStack.isSameItemSameComponents(a, b);
  }

  private static componentsEqual(a: ItemComponents, b: ItemComponents): boolean {
    if ((a.damage ?? 0) !== (b.damage ?? 0)) return false;
    if ((a.customName ?? '') !== (b.customName ?? '')) return false;
    if ((a.unbreakable ?? false) !== (b.unbreakable ?? false)) return false;
    const ea = a.enchantments ?? {};
    const eb = b.enchantments ?? {};
    const ka = Object.keys(ea), kb = Object.keys(eb);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if ((ea[k] ?? 0) !== (eb[k] ?? 0)) return false;
    return true;
  }

  // ---- mining (ItemStack.getDestroySpeed / isCorrectToolForDrops) ----------

  /** Delegates to Item.getDestroySpeed -> Tool.getMiningSpeed. */
  getDestroySpeed(state: number, mc: MinecraftData): number {
    if (this.isEmpty() || !this.item!.tool) return 1;
    const blockName = mc.blockOf(state).name;
    return this.item!.tool.getMiningSpeed(blockName);
  }

  /** Delegates to Item.isCorrectToolForDrops -> Tool.isCorrectForDrops. */
  isCorrectToolForDrops(state: number, mc: MinecraftData): boolean {
    if (this.isEmpty() || !this.item!.tool) return false;
    const blockName = mc.blockOf(state).name;
    return this.item!.tool.isCorrectForDrops(blockName);
  }

  // ---- NBT-friendly serialization ----------------------------------------

  toNBT(): ItemStackNBT {
    const out: ItemStackNBT = {
      id: this.item ? this.item.namespacedId : 'minecraft:air',
      count: this.getCount(),
    };
    if (this.components.damage !== undefined || this.components.customName !== undefined
      || this.components.enchantments !== undefined || this.components.unbreakable !== undefined) {
      out.components = { ...this.components };
    }
    return out;
  }

  static fromNBT(nbt: ItemStackNBT, registry: ItemRegistry): ItemStack {
    const item = registry.byName(stripNamespace(nbt.id)) ?? registry.byName(nbt.id);
    if (!item || item.name === 'air' || nbt.count <= 0) return ItemStack.EMPTY;
    return new ItemStack(item, nbt.count, nbt.components);
  }
}
