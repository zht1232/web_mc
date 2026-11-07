// Source: net.minecraft.world.entity.ai.goal.target.HurtByTargetGoal
//
// When hurt by another mob, retaliate against that attacker for a short while.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class HurtByTargetGoal extends Goal {
  private chosen: Targetable | null = null;

  constructor(private readonly mob: Mob) {
    super();
    this.setFlags(GoalFlag.TARGET);
  }

  canUse(): boolean {
    const a = this.mob.getLastHurtBy();
    if (!a || !a.isAlive()) return false;
    if (this.mob.tickCount - this.mob.getLastHurtByMobTime() >= 100) return false;
    this.chosen = a;
    return true;
  }

  canContinueToUse(): boolean {
    return this.chosen !== null && this.chosen.isAlive();
  }

  start(): void { this.mob.setTarget(this.chosen); }
  stop(): void { this.chosen = null; }
}
