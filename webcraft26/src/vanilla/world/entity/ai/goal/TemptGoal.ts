// Source: net.minecraft.world.entity.ai.goal.TemptGoal
//
// Animals follow a player that is (nominally) holding food. The item check is
// simplified to "player within range", but the goal keeps vanilla's pacing.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class TemptGoal extends Goal {
  private player: Targetable | null = null;
  private timer = 0;
  private readonly foodItems: ReadonlySet<string>;

  constructor(
    private readonly mob: Mob,
    private readonly speed: number,
    foodItems: readonly string[] = [],
    private readonly range = 10,
  ) {
    super();
    this.foodItems = new Set(foodItems);
    this.setFlags(GoalFlag.MOVE);
  }

  /** TemptGoal.shouldFollow: main hand or offhand holds one of the species' foods. */
  private hasFood(): boolean {
    if (this.foodItems.size === 0) return false;
    const held = this.mob.getWorld()?.getPlayerHeldItems?.() ?? [];
    for (let i = 0; i < held.length; i++) if (this.foodItems.has(held[i])) return true;
    return false;
  }

  canUse(): boolean {
    // gate the expensive/random check to once every ~20 ticks per mob
    if ((this.mob.tickCount + this.mob.id * 3) % 20 !== 0) return false;
    const p = this.mob.world ? this.mob.world.getPlayer() : null;
    if (!p || !p.isAlive()) return false;
    if (!this.hasFood()) return false;
    if (this.mob.distanceToSqr(p.x, p.y, p.z) > this.range * this.range) return false;
    if (this.mob.getRandom().nextInt(3) !== 0) return false;
    this.player = p;
    return true;
  }

  canContinueToUse(): boolean {
    const p = this.player;
    return p !== null && p.isAlive() && this.timer > 0 && this.hasFood()
      && this.mob.distanceToSqr(p.x, p.y, p.z) < (this.range + 4) * (this.range + 4)
      && this.mob.distanceToSqr(p.x, p.y, p.z) > 2.25;
  }

  start(): void {
    this.timer = 60 + this.mob.getRandom().nextInt(40);
  }

  tick(): void {
    const p = this.player;
    if (!p) return;
    this.timer--;
    this.mob.getMoveControl().setWantedPosition(p.getX(), p.getY(), p.getZ(), this.speed);
  }

  stop(): void {
    this.player = null;
    this.mob.getNavigation().stop();
  }
}
