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
    // TargetingConditions.forCombat().ignoreCreative(): creative and spectator players are
    // never acquired as targets (Horizon: mobs/ai.rs:1016-1023).
    const mode = world.getPlayerGameMode?.() ?? 'survival';
    if (p && p.isAlive() && mode !== 'creative' && mode !== 'spectator' && this.predicate(p)) {
      const d = this.mob.distanceToSqr(p.x, p.y, p.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) return false;
    this.chosen = best;
    return true;
  }

  canContinueToUse(): boolean {
    const chosen = this.chosen;
    if (chosen === null || !chosen.isAlive()) return false;
    // Switching to creative/spectator drops the pursuit as well.
    if (chosen.getTypeName() === 'player') {
      const mode = this.mob.getWorld()?.getPlayerGameMode?.() ?? 'survival';
      if (mode === 'creative' || mode === 'spectator') return false;
    }
    return true;
  }

  start(): void { this.mob.setTarget(this.chosen); }

  // Deliberately does NOT clear the target: the melee/ranged goal in the other
  // selector keeps using it. It is replaced only when this goal re-acquires.
  stop(): void { this.chosen = null; }
}
