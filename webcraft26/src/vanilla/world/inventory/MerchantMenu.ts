// Source: net.minecraft.world.inventory.MerchantMenu / MerchantContainer /
//         MerchantResultSlot (26.2)
//
// Three trade slots (payment A at 136,37, payment B at 162,37, result at 220,37)
// followed by the player inventory at 108,84. Selecting an offer moves matching
// items from the inventory into the payment slots; taking the result consumes
// them, awards villager XP and records the trade use.

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';
import type { Merchant } from '../item/trading/Merchant.js';
import type { MerchantOffer } from '../item/trading/MerchantOffer.js';
import { AbstractContainerMenu, type MenuPlayer } from './AbstractContainerMenu.js';
import { ContainerHelper, type Container } from './Container.js';
import { Slot } from './Slot.js';
import { MenuType } from './MenuType.js';
import type { PlayerInventory } from '../entity/player/Inventory.js';

const PAYMENT1_SLOT = 0;
const PAYMENT2_SLOT = 1;
const RESULT_SLOT = 2;
const INV_SLOT_START = 3;
const INV_SLOT_END = 30;
const USE_ROW_SLOT_START = 30;
const USE_ROW_SLOT_END = 39;

function recipeFor(offers: readonly MerchantOffer[], a: ItemStack, b: ItemStack, hint: number): MerchantOffer | null {
  if (hint > 0 && hint < offers.length && offers[hint].satisfiedBy(a, b)) return offers[hint];
  for (const offer of offers) if (offer.satisfiedBy(a, b)) return offer;
  return null;
}

/** MerchantContainer: the three trade slots plus the active offer. */
export class MerchantContainer implements Container {
  private readonly items: ItemStack[] = [ItemStack.EMPTY, ItemStack.EMPTY, ItemStack.EMPTY];
  activeOffer: MerchantOffer | null = null;
  selectionHint = 0;
  futureXp = 0;

  constructor(private readonly merchant: Merchant) {}

  getContainerSize(): number { return this.items.length; }
  isEmpty(): boolean { return this.items.every((stack) => stack.isEmpty()); }
  getItem(slot: number): ItemStack { return this.items[slot] ?? ItemStack.EMPTY; }
  getMaxStackSize(): number { return 64; }

  removeItem(slot: number, count: number): ItemStack {
    const stack = this.items[slot];
    if (slot === RESULT_SLOT && stack && !stack.isEmpty()) {
      return ContainerHelper.removeItem(this.items, slot, stack.getCount());
    }
    const removed = ContainerHelper.removeItem(this.items, slot, count);
    if (!removed.isEmpty() && this.isPaymentSlot(slot)) this.updateSellItem();
    return removed;
  }

  removeItemNoUpdate(slot: number): ItemStack {
    return ContainerHelper.takeItem(this.items, slot);
  }

  setItem(slot: number, stack: ItemStack): void {
    this.items[slot] = stack;
    stack.limitSize(this.getMaxStackSize());
    if (this.isPaymentSlot(slot)) this.updateSellItem();
  }

  setChanged(): void { this.updateSellItem(); }
  stillValid(_player: unknown): boolean { return this.merchant.stillValid(null); }
  clearContent(): void { this.items.fill(ItemStack.EMPTY); }

  private isPaymentSlot(slot: number): boolean {
    return slot === PAYMENT1_SLOT || slot === PAYMENT2_SLOT;
  }

  /** MerchantContainer.updateSellItem. */
  updateSellItem(): void {
    this.activeOffer = null;
    let buyA = this.items[PAYMENT1_SLOT];
    let buyB = this.items[PAYMENT2_SLOT];
    if (buyA.isEmpty()) {
      buyA = this.items[PAYMENT2_SLOT];
      buyB = ItemStack.EMPTY;
    }
    if (buyA.isEmpty()) {
      this.items[RESULT_SLOT] = ItemStack.EMPTY;
      this.futureXp = 0;
      return;
    }
    const offers = this.merchant.getOffers();
    if (offers.length === 0) {
      this.items[RESULT_SLOT] = ItemStack.EMPTY;
      this.futureXp = 0;
      return;
    }
    let offer = recipeFor(offers, buyA, buyB, this.selectionHint);
    if (!offer || offer.isOutOfStock()) {
      this.activeOffer = offer;
      offer = recipeFor(offers, buyB, buyA, this.selectionHint);
    }
    if (offer && !offer.isOutOfStock()) {
      this.activeOffer = offer;
      this.items[RESULT_SLOT] = offer.assemble();
      this.futureXp = offer.getXp();
    } else {
      this.items[RESULT_SLOT] = ItemStack.EMPTY;
      this.futureXp = 0;
    }
    this.merchant.notifyTradeUpdated(this.items[RESULT_SLOT]);
  }

  setSelectionHint(hint: number): void {
    this.selectionHint = hint;
    this.updateSellItem();
  }
}

/** MerchantResultSlot: taking the result consumes the payments and logs the trade. */
class MerchantResultSlot extends Slot {
  constructor(
    private readonly menu: MerchantMenu,
    container: Container,
    slot: number,
    x: number,
    y: number,
  ) {
    super(container, slot, x, y);
  }

  override mayPlace(_stack: ItemStack): boolean { return false; }

  override onTake(_player: unknown, _carried: ItemStack): void {
    this.menu.completeTrade();
    super.onTake(_player, _carried);
  }
}

export class MerchantMenu extends AbstractContainerMenu {
  private readonly tradeContainer: MerchantContainer;
  private merchantLevel = 1;
  private showProgress = true;
  /** Set by the game layer: trade sound + Stats.TRADED_WITH_VILLAGER. */
  onTrade: ((offer: MerchantOffer) => void) | null = null;

  constructor(
    containerId: number,
    inventory: PlayerInventory,
    private readonly player: MenuPlayer | null,
    private readonly merchant: Merchant,
    private readonly registry: ItemRegistry,
  ) {
    super(MenuType.MERCHANT, containerId);
    this.tradeContainer = new MerchantContainer(merchant);
    this.addSlot(new Slot(this.tradeContainer, PAYMENT1_SLOT, 136, 37));
    this.addSlot(new Slot(this.tradeContainer, PAYMENT2_SLOT, 162, 37));
    this.addSlot(new MerchantResultSlot(this, this.tradeContainer, RESULT_SLOT, 220, 37));
    this.addStandardInventorySlots(inventory, 108, 84);
    this.merchantLevel = 1;
  }

  getMerchant(): Merchant { return this.merchant; }
  getRegistry(): ItemRegistry { return this.registry; }
  getTradeContainer(): MerchantContainer { return this.tradeContainer; }
  getOffers(): readonly MerchantOffer[] { return this.merchant.getOffers(); }
  getTraderXp(): number { return this.merchant.getVillagerXp(); }
  getFutureTraderXp(): number { return this.tradeContainer.futureXp; }
  getTraderLevel(): number {
    const live = (this.merchant as { professionLevel?: number }).professionLevel;
    return typeof live === 'number' ? live : this.merchantLevel;
  }
  setMerchantLevel(level: number): void { this.merchantLevel = level; }
  showProgressBar(): boolean { return this.showProgress; }
  setShowProgressBar(value: boolean): void { this.showProgress = value; }
  canRestock(): boolean { return this.merchant.canRestock(); }

  override slotsChanged(container: unknown): void {
    this.tradeContainer.updateSellItem();
    super.slotsChanged(container);
  }

  setSelectionHint(hint: number): void { this.tradeContainer.setSelectionHint(hint); }

  /** MerchantMenu.notifyTrade: consume the payments and add villager XP. */
  completeTrade(): void {
    const offer = this.tradeContainer.activeOffer;
    if (!offer) return;
    const buyA = this.tradeContainer.getItem(PAYMENT1_SLOT);
    const buyB = this.tradeContainer.getItem(PAYMENT2_SLOT);
    if (offer.take(buyA, buyB) || offer.take(buyB, buyA)) {
      this.merchant.notifyTrade(offer);
      this.onTrade?.(offer);
      this.tradeContainer.setItem(PAYMENT1_SLOT, buyA);
      this.tradeContainer.setItem(PAYMENT2_SLOT, buyB);
    }
    this.merchant.overrideXp(this.merchant.getVillagerXp() + offer.getXp());
  }

  /** MerchantMenu.tryMoveItems: move the selected offer's costs into the payment slots. */
  tryMoveItems(index: number): void {
    const offers = this.merchant.getOffers();
    if (index < 0 || index >= offers.length) return;
    const oldA = this.tradeContainer.getItem(PAYMENT1_SLOT);
    if (!oldA.isEmpty()) {
      if (!this.moveItemStackTo(oldA, INV_SLOT_START, USE_ROW_SLOT_END, true)) return;
      this.tradeContainer.setItem(PAYMENT1_SLOT, oldA);
    }
    const oldB = this.tradeContainer.getItem(PAYMENT2_SLOT);
    if (!oldB.isEmpty()) {
      if (!this.moveItemStackTo(oldB, INV_SLOT_START, USE_ROW_SLOT_END, true)) return;
      this.tradeContainer.setItem(PAYMENT2_SLOT, oldB);
    }
    if (this.tradeContainer.getItem(PAYMENT1_SLOT).isEmpty()
      && this.tradeContainer.getItem(PAYMENT2_SLOT).isEmpty()) {
      const offer = offers[index];
      this.moveFromInventoryToPaymentSlot(PAYMENT1_SLOT, offer.getCostA());
      const costB = offer.getCostB();
      if (!costB.isEmpty()) this.moveFromInventoryToPaymentSlot(PAYMENT2_SLOT, costB);
    }
  }

  private moveFromInventoryToPaymentSlot(paymentSlot: number, cost: ItemStack): void {
    const wanted = cost.item?.name ?? '';
    if (!wanted) return;
    for (let i = INV_SLOT_START; i < USE_ROW_SLOT_END; i++) {
      const slot = this.slots[i];
      const inventoryItem = slot.getItem();
      if (inventoryItem.isEmpty() || inventoryItem.item?.name !== wanted) continue;
      const current = this.tradeContainer.getItem(paymentSlot);
      if (!current.isEmpty() && current.item?.name !== wanted) continue;
      const max = inventoryItem.getMaxStackSize();
      const move = Math.min(max - current.getCount(), inventoryItem.getCount());
      if (move <= 0) continue;
      const next = inventoryItem.copyWithCount(current.getCount() + move);
      inventoryItem.shrink(move);
      this.tradeContainer.setItem(paymentSlot, next);
      if (next.getCount() >= max) break;
    }
  }

  override stillValid(player: MenuPlayer | null): boolean {
    return this.merchant.stillValid(player);
  }

  override canTakeItemForPickAll(): boolean {
    return false;
  }

  override quickMoveStack(_player: MenuPlayer | null, slotIndex: number): ItemStack {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.hasItem()) return ItemStack.EMPTY;
    const stack = slot.getItem();
    const clicked = stack.copy();
    if (slotIndex === RESULT_SLOT) {
      if (!this.moveItemStackTo(stack, INV_SLOT_START, USE_ROW_SLOT_END, true)) return ItemStack.EMPTY;
      slot.onQuickCraft(stack, clicked);
    } else if (slotIndex !== PAYMENT1_SLOT && slotIndex !== PAYMENT2_SLOT) {
      if (slotIndex >= INV_SLOT_START && slotIndex < INV_SLOT_END) {
        if (!this.moveItemStackTo(stack, USE_ROW_SLOT_START, USE_ROW_SLOT_END, false)) return ItemStack.EMPTY;
      } else if (slotIndex >= USE_ROW_SLOT_START && slotIndex < USE_ROW_SLOT_END
        && !this.moveItemStackTo(stack, INV_SLOT_START, INV_SLOT_END, false)) {
        return ItemStack.EMPTY;
      }
    } else if (!this.moveItemStackTo(stack, INV_SLOT_START, USE_ROW_SLOT_END, false)) {
      return ItemStack.EMPTY;
    }
    if (stack.isEmpty()) slot.setByPlayer(ItemStack.EMPTY);
    else slot.setChanged();
    if (stack.getCount() === clicked.getCount()) return ItemStack.EMPTY;
    slot.onTake(_player, stack);
    return clicked;
  }

  override removed(player: MenuPlayer | null): void {
    super.removed(player);
    this.merchant.setTradingPlayer(null);
    if (!player) return;
    for (const slot of [PAYMENT1_SLOT, PAYMENT2_SLOT]) {
      const stack = this.tradeContainer.removeItemNoUpdate(slot);
      if (stack.isEmpty()) continue;
      player.inventory.add(stack);
      if (!stack.isEmpty()) player.drop(stack);
    }
  }
}
