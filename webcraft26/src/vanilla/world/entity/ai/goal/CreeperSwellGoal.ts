// Source: net.minecraft.world.entity.ai.goal.CreeperSwellGoal
//
// The creeper approaches its target, then inflates (`swell`) once within a few
// blocks; at swell == 1 it explodes (Creeper.explode damages nearby entities
// and removes the creeper).

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class CreeperSwellGoal extends Goal {
  constructor(private readonly mob: Mob) {
    super();
    this.setFlags(GoalFlag.MOVE, GoalFlag.LOOK);
  }

  /** Creative/spectator players must never make a creeper swell or explode. */
  private targetIsProtectedPlayer(): boolean {
    const t = this.mob.getTarget();
    if (!t || t.getTypeName() !== 'player') return false;
    const mode = this.mob.getWorld()?.getPlayerGameMode?.() ?? 'survival';
    return mode === 'creative' || mode === 'spectator';
  }

  canUse(): boolean {
    const t = this.mob.getTarget();
    return t !== null && t.isAlive() && this.mob.swell < 1
      && !this.targetIsProtectedPlayer()
      && this.mob.distanceToSqr(t.x, t.y, t.z) < 81;
  }

  canContinueToUse(): boolean {
    const t = this.mob.getTarget();
    return t !== null && t.isAlive() && this.mob.swell < 1 && !this.mob.isRemoved()
      && !this.targetIsProtectedPlayer();
  }

  start(): void {
    this.mob.swellDir = 1;
    this.mob.getNavigation().stop();
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const t = this.mob.getTarget();
    if (!t || !t.isAlive()) return;
    const dx = t.getX() - this.mob.x, dz = t.getZ() - this.mob.z;
    const dist = Math.hypot(dx, dz);
    this.mob.lookAt(t, 30, 30);
    if (dist > 2.2) {
      this.mob.getMoveControl().setWantedPosition(t.getX(), t.getY(), t.getZ(), 1);
      if (this.mob.swell > 0) this.mob.swell = Math.max(0, this.mob.swell - 0.05);
    } else {
      this.mob.swell = Math.min(1, this.mob.swell + 0.05);
      if (this.mob.swell >= 1) this.mob.explode();
    }
  }

  stop(): void { this.mob.swellDir = -1; }
}
