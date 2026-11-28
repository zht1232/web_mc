// Source: net.minecraft.world.entity.npc.wanderingtrader.WanderingTrader (26.2)
//
// Rare visitor that trades from the three WANDERING_TRADER_* trade sets and
// despawns after 48000 ticks (40 minutes) unless the player is trading with it.
// The vanilla invisibility-at-night UseItemGoal is not ported (the port has no
// invisibility rendering yet); the wandering/despawn/trade behaviour is.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { AvoidEntityGoal } from '../ai/goal/AvoidEntityGoal.js';
import { PanicGoal } from '../ai/goal/PanicGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { Goal, GoalFlag } from '../ai/goal/Goal.js';
import { entityType } from '../EntityType.js';
import { WanderingTraderTrades } from './WanderingTraderTrades.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { Merchant } from '../../item/trading/Merchant.js';
import type { MerchantOffer } from '../../item/trading/MerchantOffer.js';

interface TraderPos { x: number; y: number; z: number }

/** WanderingTrader.WanderToPositionGoal. */
class WanderToPositionGoal extends Goal {
  constructor(
    private readonly trader: WanderingTrader,
    private readonly stopDistance: number,
    private readonly speed: number,
  ) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    const target = this.trader.wanderTarget;
    if (!target) return false;
    return this.trader.distanceToSqr(target.x + 0.5, target.y, target.z + 0.5) > this.stopDistance * this.stopDistance;
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const target = this.trader.wanderTarget;
    if (!target) return;
    this.trader.getMoveControl().setWantedPosition(target.x + 0.5, target.y, target.z + 0.5, this.speed);
  }

  stop(): void {
    this.trader.wanderTarget = null;
    this.trader.getNavigation().stop();
  }
}

export class WanderingTrader extends Mob implements Merchant {
  offers: MerchantOffer[] = [];
  tradingPlayer: unknown = null;
  /** WanderingTrader.despawnDelay: ticks until discard (48000 on spawn). */
  despawnDelay = 0;
  /** Home/meeting point set by the spawner; the trader wanders toward it. */
  wanderTarget: TraderPos | null = null;

  constructor(level: ClientLevel) {
    super(entityType('wandering_trader'), level);
    this.speed = 0.5;
    this.maxHealth = 20;
    this.health = 20;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    // WanderingTrader.registerGoals: avoid zombies and illagers; the port only
    // implements the zombie branch (illagers are not ported yet).
    this.goalSelector.addGoal(1, new AvoidEntityGoal(this, (e) => e.getTypeName() === 'zombie', 8, 0.5));
    this.goalSelector.addGoal(1, new PanicGoal(this, 0.5));
    this.goalSelector.addGoal(2, new WanderToPositionGoal(this, 2, 0.35));
    this.goalSelector.addGoal(8, new RandomStrollGoal(this, 0.35));
    this.goalSelector.addGoal(9, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(10, new RandomLookAroundGoal(this));
  }

  setDespawnDelay(ticks: number): void { this.despawnDelay = ticks; }
  getDespawnDelay(): number { return this.despawnDelay; }

  override aiStep(): void {
    super.aiStep();
    // WanderingTrader.maybeDespawn: never while the player has the screen open.
    if (this.despawnDelay > 0 && this.tradingPlayer == null) {
      this.despawnDelay--;
      if (this.despawnDelay === 0) this.remove();
    }
  }

  /** AbstractVillager: a trading villager holds still until the screen closes. */
  override serverAiStep(): void {
    if (this.tradingPlayer != null) {
      this.moveControl.reset();
      this.navigation.stop();
      this.setTarget(null);
      return;
    }
    super.serverAiStep();
  }

  /** WanderingTrader.updateTrades: buying -> uncommon -> common. */
  private updateTrades(): void {
    const trades = WanderingTraderTrades.current;
    const registry = this.world?.getRegistry?.() ?? null;
    if (!trades || !registry) return;
    this.offers = trades.createOffers(registry, this.random);
  }

  // ---- Merchant -----------------------------------------------------------

  getOffers(): MerchantOffer[] {
    if (this.offers.length === 0) this.updateTrades();
    return this.offers;
  }
  /** AbstractVillager.overrideOffers is a no-op for wandering traders. */
  overrideOffers(_offers: MerchantOffer[]): void { /* no-op, matches AbstractVillager */ }
  getVillagerXp(): number { return 0; }
  overrideXp(_xp: number): void { /* no-op, matches AbstractVillager */ }
  notifyTrade(offer: MerchantOffer): void { offer.increaseUses(); }
  notifyTradeUpdated(_stack: ItemStack): void { /* sound is played by the game layer */ }
  isClientSide(): boolean { return true; }
  getTradingPlayer(): unknown { return this.tradingPlayer; }
  setTradingPlayer(player: unknown): void { this.tradingPlayer = player; }
  getNotifyTradeSound(): string { return 'entity.wandering_trader.yes'; }
  stillValid(_player: unknown): boolean { return !this.isRemoved() && !this.dead; }
  /** Wandering traders never restock. */
  canRestock(): boolean { return false; }
}
