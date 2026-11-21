// Source: net.minecraft.world.inventory.EnchantmentMenu (26.2)
//         + net.minecraft.world.item.enchantment.EnchantmentHelper.getEnchantmentCost
//         + net.minecraft.world.item.Item.getEnchantmentValue
//
// Client-side enchanting table: two container slots (item, lapis), three offers
// rolled from the bookshelf power. Applying an offer consumes lapis + XP levels
// and merges the enchantment into the item's data components.

import { ItemStack } from '../item/ItemStack.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';
import type { RandomSource } from '../../core/Random.js';
import { AbstractContainerMenu, type MenuPlayer } from './AbstractContainerMenu.js';
import { SimpleContainer } from './Container.js';
import { Slot } from './Slot.js';
import { MenuType } from './MenuType.js';

type Category =
  | 'sword' | 'axe' | 'pickaxe' | 'shovel' | 'hoe'
  | 'helmet' | 'chestplate' | 'leggings' | 'boots'
  | 'bow' | 'fishing_rod' | 'book';

interface EnchantDef {
  id: string;
  max: number;
  weight: number;
  cats: readonly Category[];
}

const ARMOR: readonly Category[] = ['helmet', 'chestplate', 'leggings', 'boots'];
const TOOLS: readonly Category[] = ['pickaxe', 'shovel', 'axe', 'hoe'];
const EVERYTHING: readonly Category[] = [...ARMOR, 'sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'bow', 'fishing_rod'];

/** The 26.2 non-treasure enchantments that can come from an enchanting table. */
export const ENCHANTMENTS: readonly EnchantDef[] = [
  { id: 'protection', max: 4, weight: 10, cats: ARMOR },
  { id: 'fire_protection', max: 4, weight: 5, cats: ARMOR },
  { id: 'feather_falling', max: 4, weight: 5, cats: ['boots'] },
  { id: 'blast_protection', max: 4, weight: 2, cats: ARMOR },
  { id: 'projectile_protection', max: 4, weight: 5, cats: ARMOR },
  { id: 'respiration', max: 3, weight: 2, cats: ['helmet'] },
  { id: 'aqua_affinity', max: 1, weight: 2, cats: ['helmet'] },
  { id: 'thorns', max: 3, weight: 1, cats: ARMOR },
  { id: 'depth_strider', max: 3, weight: 2, cats: ['boots'] },
  { id: 'frost_walker', max: 2, weight: 2, cats: ['boots'] },
  { id: 'binding_curse', max: 1, weight: 1, cats: ARMOR },
  { id: 'soul_speed', max: 3, weight: 1, cats: ['boots'] },
  { id: 'swift_sneak', max: 3, weight: 2, cats: ['leggings'] },
  { id: 'sharpness', max: 5, weight: 10, cats: ['sword', 'axe'] },
  { id: 'smite', max: 5, weight: 5, cats: ['sword', 'axe'] },
  { id: 'bane_of_arthropods', max: 5, weight: 5, cats: ['sword', 'axe'] },
  { id: 'knockback', max: 2, weight: 5, cats: ['sword'] },
  { id: 'fire_aspect', max: 2, weight: 2, cats: ['sword'] },
  { id: 'looting', max: 3, weight: 2, cats: ['sword'] },
  { id: 'sweeping_edge', max: 3, weight: 2, cats: ['sword'] },
  { id: 'efficiency', max: 5, weight: 10, cats: TOOLS },
  { id: 'silk_touch', max: 1, weight: 1, cats: TOOLS },
  { id: 'unbreaking', max: 3, weight: 5, cats: EVERYTHING },
  { id: 'fortune', max: 3, weight: 2, cats: TOOLS },
  { id: 'power', max: 5, weight: 10, cats: ['bow'] },
  { id: 'punch', max: 2, weight: 2, cats: ['bow'] },
  { id: 'flame', max: 1, weight: 2, cats: ['bow'] },
  { id: 'infinity', max: 1, weight: 1, cats: ['bow'] },
  { id: 'luck_of_the_sea', max: 3, weight: 2, cats: ['fishing_rod'] },
  { id: 'lure', max: 3, weight: 2, cats: ['fishing_rod'] },
  { id: 'mending', max: 1, weight: 2, cats: EVERYTHING },
  { id: 'vanishing_curse', max: 1, weight: 1, cats: EVERYTHING },
];

/** Item.getEnchantmentValue (material-based approximation). */
export function enchantability(name: string): number {
  if (!itemCategory(name)) return 0;
  if (name === 'book') return 1;
  if (name === 'bow' || name === 'fishing_rod') return 1;
  switch (name.split('_')[0]) {
    case 'wooden': return 15;
    case 'stone': return 5;
    case 'iron': return 14;
    case 'golden': return 22;
    case 'diamond': return 10;
    case 'netherite': return 15;
    case 'leather': return 15;
    case 'chainmail': return 12;
    case 'turtle': return 9;
    default: return 1;
  }
}

export function itemCategory(name: string): Category | null {
  if (name === 'book') return 'book';
  if (name === 'bow') return 'bow';
  if (name === 'fishing_rod') return 'fishing_rod';
  if (name === 'turtle_helmet' || name.endsWith('_helmet')) return 'helmet';
  if (name.endsWith('_chestplate')) return 'chestplate';
  if (name.endsWith('_leggings')) return 'leggings';
  if (name.endsWith('_boots')) return 'boots';
  if (name.endsWith('_sword')) return 'sword';
  if (name.endsWith('_axe')) return 'axe';
  if (name.endsWith('_pickaxe')) return 'pickaxe';
  if (name.endsWith('_shovel')) return 'shovel';
  if (name.endsWith('_hoe')) return 'hoe';
  return null;
}

/** EnchantmentHelper.getEnchantmentCost for slots 0..2. */
export function enchantmentCosts(power: number, itemName: string, rng: RandomSource): number[] {
  if (enchantability(itemName) <= 0) return [0, 0, 0];
  const p = Math.max(0, Math.min(15, power));
  const j = rng.nextInt(8) + 1 + (p >> 1) + rng.nextInt(p + 1);
  return [
    Math.max(1, Math.floor(j / 3)),
    Math.max(1, Math.floor(j * 2 / 3)),
    Math.max(1, j),
  ];
}

export interface EnchantOffer { id: string; level: number }

/** Picks one applicable enchantment (weighted) and a level scaled by the offer cost. */
export function rollOffer(category: Category, cost: number, rng: RandomSource): EnchantOffer | null {
  const pool = category === 'book'
    ? ENCHANTMENTS
    : ENCHANTMENTS.filter((e) => e.cats.includes(category));
  if (pool.length === 0) return null;
  let total = 0;
  for (const e of pool) total += e.weight;
  let roll = rng.nextInt(Math.max(1, total));
  let def = pool[0];
  for (const e of pool) {
    if (roll < e.weight) { def = e; break; }
    roll -= e.weight;
  }
  const level = Math.max(1, Math.min(def.max, 1 + Math.floor(cost / 10) + (rng.nextFloat() < 0.4 ? 1 : 0)));
  return { id: def.id, level };
}

/** Item slot: only items with a positive enchantability. */
class EnchantItemSlot extends Slot {
  override mayPlace(stack: ItemStack): boolean {
    return !!stack.item && enchantability(stack.item.name) > 0;
  }
}

/** Lapis slot: ItemTags.LAPIS_ORES? EnchantmentMenu only accepts lapis_lazuli. */
class LapisSlot extends Slot {
  override mayPlace(stack: ItemStack): boolean {
    return !!stack.item && stack.item.name === 'lapis_lazuli';
  }
}

export class EnchantingMenu extends AbstractContainerMenu {
  readonly power: number;
  readonly costs: number[] = [0, 0, 0];
  readonly offers: (EnchantOffer | null)[] = [null, null, null];
  /** Game wires this to SurvivalState.removeExperienceLevels. */
  onSpendLevels?: (levels: number) => boolean;
  /** Game wires this to the sound + Stats.ENCHANT_ITEM. */
  onEnchanted?: (itemName: string, enchantId: string, level: number) => void;

  private readonly container = new SimpleContainer(2);
  private readonly itemSlot: Slot;
  private readonly lapisSlot: Slot;
  private readonly rng: RandomSource;
  private lastItemKey = '';

  constructor(containerId: number, playerInventory: PlayerInventory, power: number, rng: RandomSource) {
    super(MenuType.ENCHANTING, containerId);
    this.power = Math.max(0, Math.min(15, power));
    this.rng = rng;
    this.itemSlot = this.addSlot(new EnchantItemSlot(this.container, 0, 15, 47));
    this.lapisSlot = this.addSlot(new LapisSlot(this.container, 1, 35, 47));
    this.addStandardInventorySlots(playerInventory, 8, 84);
    this.recomputeOffers();
  }

  /** SimpleContainer has no menu listener; re-roll when the item stack identity changes. */
  private refresh(): void {
    const stack = this.itemSlot.getItem();
    const key = stack.isEmpty() ? '' : `${stack.item?.name ?? ''}:${stack.getCount()}`;
    if (key !== this.lastItemKey) this.recomputeOffers();
  }

  /** EnchantmentMenu.slotsChanged: reroll costs + offers from the current item. */
  recomputeOffers(): void {
    const stack = this.itemSlot.getItem();
    const name = stack.isEmpty() ? '' : (stack.item?.name ?? '');
    this.lastItemKey = stack.isEmpty() ? '' : `${name}:${stack.getCount()}`;
    const costs = enchantmentCosts(this.power, name, this.rng);
    const category = name ? itemCategory(name) : null;
    for (let i = 0; i < 3; i++) {
      const offer = category && costs[i] > 0 ? rollOffer(category, costs[i], this.rng) : null;
      this.costs[i] = offer ? costs[i] : 0;
      this.offers[i] = offer;
    }
  }

  /** GUI snapshot: costs + affordability (ContainerMenuLike.enchantInfo). */
  info(playerLevels: number): { costs: number[]; canEnchant: boolean[] } {
    this.refresh();
    return {
      costs: [...this.costs],
      canEnchant: [0, 1, 2].map((i) => this.canEnchant(i, playerLevels)),
    };
  }

  /** Whether the player can pay for offer `i` (levels + lapis). */
  canEnchant(i: number, playerLevels: number): boolean {
    if (i < 0 || i > 2 || !this.offers[i] || this.costs[i] <= 0) return false;
    if (playerLevels < this.costs[i]) return false;
    return this.lapisSlot.getItem().getCount() >= i + 1;
  }

  /** EnchantmentMenu.clickMenuButton: consume lapis + levels and merge the enchantment. */
  enchant(i: number, playerLevels: number): boolean {
    this.refresh();
    if (!this.canEnchant(i, playerLevels)) return false;
    const offer = this.offers[i];
    const stack = this.itemSlot.getItem();
    if (!offer || stack.isEmpty() || !stack.item) return false;
    if (!this.onSpendLevels?.(this.costs[i])) return false;
    const lapis = this.lapisSlot.getItem();
    lapis.setCount(lapis.getCount() - (i + 1));
    if (lapis.getCount() <= 0) this.lapisSlot.setByPlayer(ItemStack.EMPTY);
    const enchants = { ...(stack.components.enchantments ?? {}) };
    enchants[offer.id] = Math.max(enchants[offer.id] ?? 0, offer.level);
    stack.components.enchantments = enchants;
    this.onEnchanted?.(stack.item.name, offer.id, offer.level);
    this.recomputeOffers();
    return true;
  }

  override quickMoveStack(player: MenuPlayer | null, slotIndex: number): ItemStack {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return ItemStack.EMPTY;
    const stack = slot.getItem();
    const clicked = stack.copy();
    if (slotIndex < 2) {
      if (!this.moveItemStackTo(stack, 2, this.slots.length, true)) return ItemStack.EMPTY;
    } else if (!this.moveItemStackTo(stack, 0, 2, false)) {
      return ItemStack.EMPTY;
    }
    if (stack.isEmpty()) slot.setByPlayer(ItemStack.EMPTY);
    else slot.setChanged();
    slot.onTake(player, stack);
    return clicked;
  }

  override stillValid(_player: MenuPlayer | null): boolean { return true; }
}
