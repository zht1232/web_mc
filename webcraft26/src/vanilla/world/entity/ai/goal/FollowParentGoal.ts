// Source: net.minecraft.world.entity.ai.goal.FollowParentGoal
//
// Baby animals follow their parent while more than ~2 blocks away.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class FollowParentGoal extends Goal {
  constructor(private readonly mob: Mob, private readonly speed: number) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    const p = this.mob.getParent();
    if (!this.mob.isBaby() || !p || !p.isAlive()) return false;
    return this.mob.distanceToSqr(p.x, p.y, p.z) > 4;
  }

  canContinueToUse(): boolean {
    const p = this.mob.getParent();
    return p !== null && p.isAlive() && this.mob.distanceToSqr(p.x, p.y, p.z) > 1.5;
  }

  tick(): void {
    const p = this.mob.getParent();
    if (p) this.mob.getMoveControl().setWantedPosition(p.x, p.y, p.z, this.speed);
  }

  stop(): void { this.mob.getNavigation().stop(); }
}
