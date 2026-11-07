// Source: net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal
//
// Scans the loaded entities (and the player) for the nearest one matching a
// predicate and sets it as the mob's target. Runs in the target selector.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class NearestAttackableTargetGoal extends Goal {
  private chosen: Targetable | null = null;

  constructor(
    private readonly mob: Mob,
    private readonly range: number,
    private readonly predicate: (e: Targetable) => boolean,
  ) {
    super();
    this.setFlags(GoalFlag.TARGET);
  }

  canUse(): boolean {
    const world = this.mob.getWorld();
    if (!world) return false;
    let best: Targetable | null = null;
    let bestD = this.range * this.range;
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
    this.chosen = best;
    return true;
  }

  canContinueToUse(): boolean {
    return this.chosen !== null && this.chosen.isAlive();
  }

  start(): void { this.mob.setTarget(this.chosen); }

  // Deliberately does NOT clear the target: the melee/ranged goal in the other
  // selector keeps using it. It is replaced only when this goal re-acquires.
  stop(): void { this.chosen = null; }
}
