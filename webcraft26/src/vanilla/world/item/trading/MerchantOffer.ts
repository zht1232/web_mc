// Source: net.minecraft.world.item.trading.MerchantOffer (26.2)
//
// One offer: base cost A, optional cost B, result stack, uses/demand and the
// special-price discount used by reputation. Cost counts follow
// MerchantOffer.getModifiedCostCount: base + demand surcharge + special price,
// clamped to [1, max stack size].
//
// Enchanted-book offers in 26.2 roll their enchantment through loot functions;
// this port rolls from the same non-treasure table as the enchanting table and
// uses a level-scaled emerald price.

import { ItemStack, type ItemComponents } from '../ItemStack.js';
import type { ItemRegistry } from '../Item.js';
import type { RandomSource } from '../../../core/Random.js';
import { rollOffer } from '../../inventory/EnchantingMenu.js';
import { TRADEABLE_POTIONS } from '../potion/Potions.js';

export interface CostSpec {
  id: string;
  count: number;
  /** Potion component required by a potion cost (wandering trader water bottle). */
  potion?: string;
}

export interface ResultSpec {
  id: string;
  count: number;
  potion?: string;
}

/** One raw trade row from data/villager_trades.json. */
export interface TradeSpec {
  wants: CostSpec;
  additional?: CostSpec;
  gives: ResultSpec;
  maxUses: number;
  xp: number;
  priceMultiplier: number;
  enchantRandomly?: boolean;
  /** set_random_potion(#minecraft:tradeable), e.g. the fletcher master tipped-arrow offer. */
  randomPotion?: boolean;
  doubleTradePrice?: boolean;
}

export interface MerchantOfferJSON {
  wantsId: string;
  wantsCount: number;
  wantsPotion?: string;
  additionalId?: string;
  additionalCount?: number;
  resultId: string;
  resultCount: number;
  resultComponents?: ItemComponents;
  uses: number;
  maxUses: number;
  xp: number;
  priceMultiplier: number;
  demand: number;
  specialPrice: number;
  enchantRandomly?: boolean;
  doubleTradePrice?: boolean;
}

const strip = (id: string): string => id.replace(/^minecraft:/, '');

export class MerchantOffer {
  readonly baseCostAId: string;
  readonly baseCostACount: number;
  readonly baseCostAPotion: string | undefined;
  readonly costB: CostSpec | null;
  result: ItemStack;
  readonly maxUses: number;
  readonly xp: number;
  readonly priceMultiplier: number;
  readonly rewardExp = true;
  readonly enchantRandomly: boolean;
  readonly randomPotion: boolean;
  readonly doubleTradePrice: boolean;
  uses = 0;
  demand = 0;
  specialPriceDiff = 0;

  constructor(
    spec: TradeSpec,
    private readonly registry: ItemRegistry,
    random: RandomSource,
    priceLevel = 1,
  ) {
    this.baseCostAId = strip(spec.wants.id);
    this.baseCostAPotion = spec.wants.potion ? strip(spec.wants.potion) : undefined;
    this.costB = spec.additional
      ? { id: strip(spec.additional.id), count: spec.additional.count, potion: spec.additional.potion }
      : null;
    this.maxUses = spec.maxUses;
    this.xp = spec.xp;
    this.priceMultiplier = spec.priceMultiplier;
    this.enchantRandomly = spec.enchantRandomly === true;
    this.randomPotion = spec.randomPotion === true;
    this.doubleTradePrice = spec.doubleTradePrice === true;

    let components: ItemComponents | undefined;
    if (this.enchantRandomly) {
      const roll = rollOffer('book', 8 + priceLevel * 3, random);
      components = roll ? { enchantments: { [roll.id]: roll.level } } : undefined;
    } else if (this.randomPotion) {
      // set_random_potion(#minecraft:tradeable): roll one of the tag entries.
      components = { potion: TRADEABLE_POTIONS[random.nextInt(TRADEABLE_POTIONS.length)] };
    } else if (spec.gives.potion) {
      components = { potion: strip(spec.gives.potion) };
    }
    const item = registry.byName(strip(spec.gives.id));
    this.result = item ? new ItemStack(item, spec.gives.count, components) : ItemStack.EMPTY;

    // Count 0 means "price derived from the rolled enchantment" in 26.2.
    let count = spec.wants.count;
    if (count <= 0) {
      count = 3 + priceLevel * 2 + random.nextInt(5) + (this.doubleTradePrice ? 3 : 0);
    }
    this.baseCostACount = Math.max(1, count);
  }

  static fromJSON(json: MerchantOfferJSON, registry: ItemRegistry): MerchantOffer {
    const item = registry.byName(strip(json.resultId));
    const spec: TradeSpec = {
      wants: { id: json.wantsId, count: json.wantsCount, potion: json.wantsPotion },
      additional: json.additionalId ? { id: json.additionalId, count: json.additionalCount ?? 1 } : undefined,
      gives: { id: json.resultId, count: json.resultCount },
      maxUses: json.maxUses,
      xp: json.xp,
      priceMultiplier: json.priceMultiplier,
      enchantRandomly: json.enchantRandomly,
      doubleTradePrice: json.doubleTradePrice,
    };
    const offer = new MerchantOffer(spec, registry, { nextInt: () => 0, nextFloat: () => 0 } as unknown as RandomSource);
    // Rebuild the saved result (components included) instead of the freshly rolled one.
    offer.result = item ? new ItemStack(item, json.resultCount, json.resultComponents) : ItemStack.EMPTY;
    offer.uses = json.uses;
    offer.demand = json.demand;
    offer.specialPriceDiff = json.specialPrice;
    return offer;
  }

  toJSON(): MerchantOfferJSON {
    return {
      wantsId: this.baseCostAId,
      wantsCount: this.baseCostACount,
      wantsPotion: this.baseCostAPotion,
      additionalId: this.costB?.id,
      additionalCount: this.costB?.count,
      resultId: this.result.item ? strip(this.result.item.name) : 'air',
      resultCount: this.result.getCount(),
      resultComponents: Object.keys(this.result.components).length > 0 ? this.result.components : undefined,
      uses: this.uses,
      maxUses: this.maxUses,
      xp: this.xp,
      priceMultiplier: this.priceMultiplier,
      demand: this.demand,
      specialPrice: this.specialPriceDiff,
      enchantRandomly: this.enchantRandomly || undefined,
      doubleTradePrice: this.doubleTradePrice || undefined,
    };
  }

  /** MerchantOffer.getCostA with the demand/special-price adjustment. */
  getCostA(): ItemStack {
    const item = this.registry.byName(this.baseCostAId);
    if (!item) return ItemStack.EMPTY;
    const components = this.baseCostAPotion ? { potion: this.baseCostAPotion } : undefined;
    return new ItemStack(item, this.getModifiedCostCount(item.maxStack), components);
  }

  private getModifiedCostCount(maxStack: number): number {
    const base = this.baseCostACount;
    const demandDiff = Math.max(0, Math.floor(base * this.demand * this.priceMultiplier));
    return Math.max(1, Math.min(base + demandDiff + this.specialPriceDiff, maxStack));
  }

  getBaseCostA(): ItemStack {
    const item = this.registry.byName(this.baseCostAId);
    if (!item) return ItemStack.EMPTY;
    const components = this.baseCostAPotion ? { potion: this.baseCostAPotion } : undefined;
    return new ItemStack(item, this.baseCostACount, components);
  }

  getCostB(): ItemStack {
    if (!this.costB) return ItemStack.EMPTY;
    const item = this.registry.byName(this.costB.id);
    if (!item) return ItemStack.EMPTY;
    const components = this.costB.potion ? { potion: this.costB.potion } : undefined;
    return new ItemStack(item, this.costB.count, components);
  }

  getResult(): ItemStack { return this.result; }
  assemble(): ItemStack { return this.result.copy(); }
  getUses(): number { return this.uses; }
  getMaxUses(): number { return this.maxUses; }
  getXp(): number { return this.xp; }
  getDemand(): number { return this.demand; }
  getSpecialPriceDiff(): number { return this.specialPriceDiff; }
  setSpecialPriceDiff(value: number): void { this.specialPriceDiff = value; }
  addToSpecialPriceDiff(add: number): void { this.specialPriceDiff += add; }
  resetSpecialPriceDiff(): void { this.specialPriceDiff = 0; }
  resetUses(): void { this.uses = 0; }
  increaseUses(): void { this.uses++; }
  isOutOfStock(): boolean { return this.uses >= this.maxUses; }
  setToOutOfStock(): void { this.uses = this.maxUses; }
  needsRestock(): boolean { return this.uses > 0; }

  updateDemand(): void {
    this.demand = this.demand + this.uses - (this.maxUses - this.uses);
  }

  private matches(stack: ItemStack, id: string, potion?: string): boolean {
    if (!stack.item || !(stack.item.name === id || strip(stack.item.namespacedId) === id)) return false;
    return potion ? stack.components.potion === potion : true;
  }

  satisfiedBy(buyA: ItemStack, buyB: ItemStack): boolean {
    if (!this.matches(buyA, this.baseCostAId, this.baseCostAPotion)
      || buyA.getCount() < this.getCostA().getCount()) return false;
    if (!this.costB) return buyB.isEmpty();
    return this.matches(buyB, this.costB.id, this.costB.potion)
      && buyB.getCount() >= this.costB.count;
  }

  take(buyA: ItemStack, buyB: ItemStack): boolean {
    if (!this.satisfiedBy(buyA, buyB)) return false;
    buyA.shrink(this.getCostA().getCount());
    const costB = this.getCostB();
    if (!costB.isEmpty()) buyB.shrink(costB.getCount());
    return true;
  }
}
