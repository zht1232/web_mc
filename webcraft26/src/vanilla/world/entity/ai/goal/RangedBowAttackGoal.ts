// Source: net.minecraft.world.entity.ai.goal.RangedBowAttackGoal
//
// Keeps a preferred distance from the target, strafes, and fires an arrow via
// Mob.rangedAttack every ~20-40 ticks (Skeleton overrides that method).

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class RangedBowAttackGoal extends Goal {
  private attackTime = 0;
  private strafeTime = 0;
  private strafeDir = 1;

  constructor(private readonly mob: Mob, private readonly speed: number) {
    super();
    this.setFlags(GoalFlag.MOVE, GoalFlag.LOOK);
  }

  canUse(): boolean {
    const t = this.mob.getTarget();
    return t !== null && t.isAlive();
  }

  canContinueToUse(): boolean { return this.canUse(); }

  start(): void { this.attackTime = 0; this.strafeTime = 0; }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const t = this.mob.getTarget();
    if (!t || !t.isAlive()) return;
    const r = this.mob.getRandom();
    if (this.attackTime > 0) this.attackTime--;
    if (this.strafeTime > 0) this.strafeTime--;
    if (this.strafeTime <= 0) {
      this.strafeDir = r.nextBoolean() ? 1 : -1;
      this.strafeTime = 20 + r.nextInt(20);
    }

    this.mob.lookAt(t, 30, 30);
    const dx = t.getX() - this.mob.x, dz = t.getZ() - this.mob.z;
    const dist = Math.hypot(dx, dz) || 1;

    if (this.attackTime <= 0 && dist < 16) {
      this.mob.rangedAttack(t);
      this.attackTime = 20 + r.nextInt(20);
    }

    if (dist > 12) {
      this.mob.getMoveControl().setWantedPosition(t.getX(), t.getY(), t.getZ(), this.speed);
    } else if (dist < 6) {
      const ux = dx / dist, uz = dz / dist;
      this.mob.getMoveControl().setWantedPosition(this.mob.x - ux * 4, this.mob.y, this.mob.z - uz * 4, this.speed);
    } else {
      const px = -dz / dist, pz = dx / dist;
      this.mob.getMoveControl().setWantedPosition(
        this.mob.x + px * this.strafeDir * 3, this.mob.y, this.mob.z + pz * this.strafeDir * 3, this.speed * 0.6,
      );
    }
  }

  stop(): void { this.mob.getNavigation().stop(); }
}
