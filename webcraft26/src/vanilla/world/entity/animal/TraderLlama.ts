// Source: net.minecraft.world.entity.animal.equine.TraderLlama (26.2)
//
// The two llamas that accompany a wandering trader. Vanilla ties them to the
// trader with a leash; the port has no leash rendering/physics, so a follow
// goal keeps them within a few blocks instead. Their despawn delay mirrors the
// trader's, so they vanish together (TraderLlama.maybeDespawn).

import { Llama } from './Llama.js';
import { Goal, GoalFlag } from '../ai/goal/Goal.js';
import { entityType } from '../EntityType.js';
import { WanderingTrader } from '../npc/WanderingTrader.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

/** TraderLlama.DEFAULT_DESPAWN_DELAY. */
const DEFAULT_DESPAWN_DELAY = 47999;
/** LlamaFollowCaravanGoal-ish distance the follower keeps from the trader. */
const FOLLOW_START_DISTANCE_SQR = 9;
const FOLLOW_STOP_DISTANCE_SQR = 6.25;

/** Keeps the llama near its wandering trader (the port's caravan substitute). */
class FollowTraderGoal extends Goal {
  private trader: WanderingTrader | null = null;

  constructor(private readonly llama: TraderLlama, private readonly speed = 2.0) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    const trader = this.llama.findTrader(16);
    if (!trader) return false;
    this.trader = trader;
    return this.llama.distanceToSqr(trader.x, trader.y, trader.z) > FOLLOW_START_DISTANCE_SQR;
  }

  canContinueToUse(): boolean {
    const trader = this.trader;
    if (!trader || trader.isRemoved() || trader.dead) return false;
    return this.llama.distanceToSqr(trader.x, trader.y, trader.z) > FOLLOW_STOP_DISTANCE_SQR;
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const trader = this.trader;
    if (!trader) return;
    this.llama.getMoveControl().setWantedPosition(trader.x, trader.y, trader.z, this.speed);
  }

  stop(): void { this.llama.getNavigation().stop(); }
}

export class TraderLlama extends Llama {
  /** TraderLlama.despawnDelay; synced to the trader every tick while linked. */
  despawnDelay = DEFAULT_DESPAWN_DELAY;
  /** The trader this llama follows; set by the spawner and re-found after reload. */
  trader: WanderingTrader | null = null;

  constructor(level: ClientLevel) {
    super(level, 'trader_llama');
    this.maxHealth = 30;
    this.health = 30;
  }

  override isTraderLlama(): boolean { return true; }

  protected override registerGoals(): void {
    super.registerGoals();
    this.goalSelector.addGoal(1, new FollowTraderGoal(this));
  }

  /** Nearest living wandering trader within `radius` blocks. */
  findTrader(radius: number): WanderingTrader | null {
    const world = this.world;
    if (!world) return null;
    let best: WanderingTrader | null = null;
    let bestD = radius * radius;
    for (const e of world.getEntities()) {
      if (!(e instanceof WanderingTrader) || e.isRemoved() || e.dead) continue;
      const d = this.distanceToSqr(e.x, e.y, e.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  override aiStep(): void {
    super.aiStep();
    this.tickDespawn();
  }

  /** TraderLlama.maybeDespawn: follow the trader's timer, discard together. */
  private tickDespawn(): void {
    if (!this.trader || this.trader.isRemoved() || this.trader.dead) {
      // Vanilla drops the leash and the llama's own countdown (already synced
      // to the trader's) removes it within a tick or two.
      if (this.trader) { this.remove(); return; }
      this.trader = this.findTrader(24);
    }
    if (this.trader) {
      this.despawnDelay = this.trader.getDespawnDelay() - 1;
      if (this.despawnDelay <= 0) this.remove();
      return;
    }
    if (this.despawnDelay > 0 && --this.despawnDelay === 0) this.remove();
  }
}
