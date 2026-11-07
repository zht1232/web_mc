// Source: net.minecraft.world.item.Item (26.2)
//         net.minecraft.world.item.Items / BuiltInRegistries.ITEM
//         net.minecraft.core.component.DataComponents (MAX_STACK_SIZE, MAX_DAMAGE,
//           FOOD, TOOL, EQUIPPABLE, USE_COOLDOWN, DAMAGE, RARITY, ITEM_NAME)
//
// Component-based item definition reconstructed from public/mc/items.json
// (1537 items: maxStack/maxDamage/rarity/block/food/tool/equip) plus tags.json.

import type { ItemMeta, MinecraftData } from '../level/block/state/BlockState.js';
import { BlockTagIndex, createMiningTool, type MiningTool } from './MiningTool.js';
import { FoodProperties, FoodItem } from './FoodItem.js';
import { createArmor, type ArmorItem } from './ArmorItem.js';

export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC';

/** Vanilla Item.getCraftingRemainder (Item.Properties.craftRemainder). */
const CRAFT_REMAINDERS: Readonly<Record<string, string>> = {
  water_bucket: 'bucket', lava_bucket: 'bucket', milk_bucket: 'bucket',
  powder_snow_bucket: 'bucket', axolotl_bucket: 'bucket', tadpole_bucket: 'bucket',
  cod_bucket: 'bucket', salmon_bucket: 'bucket', pufferfish_bucket: 'bucket',
  tropical_fish_bucket: 'bucket',
  potion: 'glass_bottle', splash_potion: 'glass_bottle', lingering_potion: 'glass_bottle',
  experience_bottle: 'glass_bottle', dragon_breath: 'glass_bottle', honey_bottle: 'glass_bottle',
};

/** Port of net.minecraft.world.item.Item, component-based. */
export class Item {
  readonly id: number;
  readonly name: string;
  readonly namespacedId: string;
  readonly maxStack: number;
  readonly maxDamage: number;
  readonly rarity: Rarity;
  readonly block: string;
  readonly food: FoodProperties | null;
  readonly foodItem: FoodItem | null;
  readonly tool: MiningTool | null;
  readonly armor: ArmorItem | null;
  readonly equip: string;
  readonly craftingRemainder: string | null;

  constructor(id: number, meta: ItemMeta, tags: BlockTagIndex) {
    this.id = id;
    this.name = meta.name;
    this.namespacedId = `minecraft:${meta.name}`;
    this.maxStack = meta.maxStack > 0 ? meta.maxStack : 1;
    this.maxDamage = meta.maxDamage ?? 0;
    this.rarity = (meta.rarity as Rarity) ?? 'COMMON';
    this.block = meta.block ?? '';
    this.food = FoodProperties.parse(meta.food ?? '');
    this.foodItem = this.food ? new FoodItem(this.food) : null;
    this.tool = createMiningTool(meta.tool, tags);
    this.equip = meta.equip ?? '';
    this.armor = createArmor(meta.name, this.equip);
    this.craftingRemainder = CRAFT_REMAINDERS[meta.name] ?? null;
  }

  isBlockItem(): boolean { return this.block.length > 0; }
  isDamageable(): boolean { return this.maxDamage > 0; }
  isFood(): boolean { return this.food !== null; }
  isTool(): boolean { return this.tool !== null; }
  isArmor(): boolean { return this.armor !== null; }
}

/**
 * Registry built from MinecraftData.items (the ItemMeta[] loaded by
 * MinecraftData.load -> initMeta) or directly from items.json.
 * Two name maps (short + namespaced) give O(1) lookups; no linear scans.
 */
export class ItemRegistry {
  readonly items: Item[] = [];
  readonly tagIndex: BlockTagIndex;
  private readonly byShort = new Map<string, Item>();
  private readonly byFull = new Map<string, Item>();
  /** The air item (id of "air"), used for empty-slot semantics. */
  readonly air: Item;

  constructor(meta: readonly ItemMeta[], tags: unknown) {
    this.tagIndex = tags instanceof BlockTagIndex ? tags : new BlockTagIndex(tags);
    for (let i = 0; i < meta.length; i++) {
      const item = new Item(i, meta[i], this.tagIndex);
      this.items.push(item);
      this.byShort.set(item.name, item);
      this.byFull.set(item.namespacedId, item);
    }
    const air = this.byShort.get('air') ?? this.items[0] ?? new Item(0, {
      name: 'air', maxStack: 64, maxDamage: 0, rarity: 'COMMON', block: '', food: '', tool: [], equip: '',
    }, this.tagIndex);
    this.air = air;
  }

  static fromMinecraftData(mc: MinecraftData, tags?: unknown): ItemRegistry {
    return new ItemRegistry(mc.items, tags ?? {});
  }

  /** Accept either `{ items: [...] }` (data/items.json) or a bare array. */
  static fromJSON(json: any, tags?: unknown): ItemRegistry {
    const meta: ItemMeta[] = Array.isArray(json) ? json : (json && Array.isArray(json.items) ? json.items : []);
    return new ItemRegistry(meta, tags ?? {});
  }

  get(id: number): Item | undefined { return this.items[id]; }

  /** Resolve a short ("stone") or namespaced ("minecraft:stone") item name. */
  byName(name: string): Item | undefined {
    return this.byShort.get(name) ?? this.byFull.get(name)
      ?? this.byShort.get(name.startsWith('minecraft:') ? name.slice(10) : name);
  }

  idOf(name: string): number {
    const item = this.byName(name);
    return item ? item.id : -1;
  }

  size(): number { return this.items.length; }
}
