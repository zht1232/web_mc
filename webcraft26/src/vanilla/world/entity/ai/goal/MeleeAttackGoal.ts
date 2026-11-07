// Source: net.minecraft.world.entity.ai.goal.MeleeAttackGoal
//
// Approaches the current target (direct steering, with a periodically
// recomputed A* path) and attacks on a 20-tick cooldown once within reach.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class MeleeAttackGoal extends Goal {
  private attackTicks = 0;
  private pathTicks = 0;

  constructor(
    private readonly mob: Mob,
    private readonly speedModifier: number,
    private readonly followingTargetEvenIfNotSeen = true,
  ) {
    super();
    this.setFlags(GoalFlag.MOVE, GoalFlag.LOOK);
  }

  canUse(): boolean {
    const t = this.mob.getTarget();
    return t !== null && t.isAlive();
  }

  // Never delegate to canUse(): vanilla's canUse has a cooldown and would stop
  // the goal on most ticks. A live target is enough to keep attacking.
  canContinueToUse(): boolean {
    const t = this.mob.getTarget();
    if (!t || !t.isAlive()) return false;
    if (!this.followingTargetEvenIfNotSeen && this.mob.getNavigation().isDone()) return false;
    return true;
  }

  start(): void {
    this.mob.setAggressive(true);
    this.attackTicks = 0;
    this.pathTicks = 0;
    const t = this.mob.getTarget();
    if (t) this.mob.getNavigation().moveToEntity(t, this.speedModifier);
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const t = this.mob.getTarget();
    if (!t || !t.isAlive()) return;
    if (this.attackTicks > 0) this.attackTicks--;
    if (this.pathTicks > 0) this.pathTicks--;

    this.mob.lookAt(t, 30, 30);
    const dx = t.getX() - this.mob.x, dz = t.getZ() - this.mob.z;
    const dist = Math.hypot(dx, dz);

    if (this.mob.isWithinMeleeAttackRange(t)) {
      if (this.attackTicks <= 0) {
        this.mob.doHurtTarget(t);
        this.attackTicks = 20;
      }
    } else {
      // direct steering guarantees a monotonic approach on open terrain
      this.mob.getMoveControl().setWantedPosition(t.getX(), t.getY(), t.getZ(), this.speedModifier);
      if (this.pathTicks <= 0) {
        this.mob.getNavigation().moveToEntity(t, this.speedModifier);
        this.pathTicks = 10;
      }
    }
  }

  stop(): void {
    this.mob.setAggressive(false);
    this.mob.getNavigation().stop();
  }
}
