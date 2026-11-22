// Source: net.minecraft.world.item.trading.Merchant
//
// The merchant side of an open trade screen. Implemented by Villager; the menu
// only talks to this interface (offers, xp, trade notifications).

import type { ItemStack } from '../ItemStack.js';
import type { MerchantOffer } from './MerchantOffer.js';

export interface Merchant {
  getOffers(): MerchantOffer[];
  overrideOffers(offers: MerchantOffer[]): void;
  getVillagerXp(): number;
  overrideXp(xp: number): void;
  notifyTrade(offer: MerchantOffer): void;
  notifyTradeUpdated(stack: ItemStack): void;
  isClientSide(): boolean;
  getTradingPlayer(): unknown;
  setTradingPlayer(player: unknown): void;
  getNotifyTradeSound(): string;
  stillValid(player: unknown): boolean;
  canRestock(): boolean;
  /** Villager position, used by the game layer for trade sounds. */
  getX(): number;
  getY(): number;
  getZ(): number;
}
