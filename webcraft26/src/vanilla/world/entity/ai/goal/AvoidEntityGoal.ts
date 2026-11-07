// Source: net.minecraft.world.entity.ai.goal.AvoidEntityGoal
//
// Steers the mob away from the nearest entity matching a predicate (used by
// creepers avoiding cats/ocelots, etc.).

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class AvoidEntityGoal extends Goal {
  private avoid: Targetable | null = null;
  private tx = 0; private ty = 0; private tz = 0;

  constructor(
    private readonly mob: Mob,
    private readonly predicate: (e: Targetable) => boolean,
    private readonly maxDist: number,
    private readonly speed: number,
  ) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    const world = this.mob.getWorld();
    if (!world) return false;
    let best: Targetable | null = null;
    let bestD = this.maxDist * this.maxDist;
    const ents = world.getEntities();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e === this.mob || !e.isAlive() || !this.predicate(e)) continue;
      const d = this.mob.distanceToSqr(e.x, e.y, e.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    const p = world.getPlayer();
    if (p && p.isAlive() && this.predicate(p)) {
      const d = this.mob.distanceToSqr(p.x, p.y, p.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) return false;
    this.avoid = best;
    const dx = this.mob.x - best.getX(), dz = this.mob.z - best.getZ();
    const len = Math.hypot(dx, dz) || 1;
    this.tx = this.mob.x + (dx / len) * 8;
    this.tz = this.mob.z + (dz / len) * 8;
    this.ty = this.mob.y;
    return true;
  }

  canContinueToUse(): boolean {
    const a = this.avoid;
    return a !== null && a.isAlive() && this.mob.distanceToSqr(a.x, a.y, a.z) < this.maxDist * this.maxDist * 4;
  }

  tick(): void {
    this.mob.getMoveControl().setWantedPosition(this.tx, this.ty, this.tz, this.speed);
  }

  stop(): void {
    this.avoid = null;
    this.mob.getNavigation().stop();
  }
}
