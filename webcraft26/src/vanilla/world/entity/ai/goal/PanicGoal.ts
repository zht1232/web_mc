// Source: net.minecraft.world.entity.ai.goal.PanicGoal
//
// After being hurt (or while burning) the mob runs to a random point away from
// the threat at an elevated speed.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class PanicGoal extends Goal {
  private tx = 0; private ty = 0; private tz = 0;
  private active = false;

  constructor(private readonly mob: Mob, private readonly speed: number) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    if (!this.isPanicking()) return false;
    const r = this.mob.getRandom();
    const dx = (r.nextFloat() * 2 - 1) * 16;
    const dz = (r.nextFloat() * 2 - 1) * 16;
    this.tx = this.mob.x + dx;
    this.tz = this.mob.z + dz;
    this.ty = this.mob.y + 1;
    this.active = true;
    return true;
  }

  canContinueToUse(): boolean {
    return this.active && !this.reached();
  }

  start(): void {
    this.mob.getNavigation().moveTo(this.tx, this.ty, this.tz, this.speed);
  }

  tick(): void {
    this.mob.getMoveControl().setWantedPosition(this.tx, this.ty, this.tz, this.speed);
  }

  stop(): void {
    this.active = false;
    this.mob.getNavigation().stop();
  }

  private isPanicking(): boolean {
    if (this.mob.isOnFire()) return true;
    const a = this.mob.getLastHurtBy();
    return a !== null && a.isAlive() && this.mob.tickCount - this.mob.getLastHurtByMobTime() < 100;
  }

  private reached(): boolean {
    return this.mob.distanceToSqr(this.tx, this.mob.y, this.tz) < 4;
  }
}
