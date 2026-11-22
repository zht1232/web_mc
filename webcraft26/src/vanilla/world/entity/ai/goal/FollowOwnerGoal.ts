// Source: net.minecraft.world.entity.ai.goal.FollowOwnerGoal
//
// A tamed pet walks toward the player and teleports when it falls too far
// behind. The port has a single local player, so the owner is the player
// Targetable exposed by MobWorld.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class FollowOwnerGoal extends Goal {
  private owner: Targetable | null = null;

  constructor(private readonly mob: Mob, private readonly speed = 1.0) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  private player(): Targetable | null {
    const p = this.mob.world ? this.mob.world.getPlayer() : null;
    return p && p.isAlive() ? p : null;
  }

  canUse(): boolean {
    if (!this.mob.tamed || this.mob.sitting) return false;
    const p = this.player();
    if (!p) return false;
    if (this.mob.distanceToSqr(p.getX(), p.getY(), p.getZ()) < 16) return false;
    this.owner = p;
    return true;
  }

  canContinueToUse(): boolean {
    const p = this.owner;
    if (!p || !this.mob.tamed || this.mob.sitting) return false;
    return this.mob.distanceToSqr(p.getX(), p.getY(), p.getZ()) > 4;
  }

  tick(): void {
    const p = this.owner;
    if (!p) return;
    const d2 = this.mob.distanceToSqr(p.getX(), p.getY(), p.getZ());
    // TameableAnimal.shouldFollowOwner: teleport once the pet is 12+ blocks away.
    if (d2 > 144) {
      this.mob.setPos(p.getX(), p.getY(), p.getZ());
      this.mob.getNavigation().stop();
      return;
    }
    this.mob.getMoveControl().setWantedPosition(p.getX(), p.getY(), p.getZ(), this.speed);
  }

  stop(): void {
    this.owner = null;
    this.mob.getNavigation().stop();
  }
}
