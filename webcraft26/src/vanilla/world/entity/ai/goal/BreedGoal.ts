// Source: net.minecraft.world.entity.ai.goal.BreedGoal
//
// Two animals in love mode approach each other; on contact the love state is
// cleared (vanilla then spawns a baby; entity creation is delegated to the
// world/factory so this goal stays allocation-free).

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class BreedGoal extends Goal {
  private partner: Targetable | null = null;
  private timer = 0;

  constructor(private readonly mob: Mob, private readonly speed: number) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    if (!this.mob.isInLove()) return false;
    const world = this.mob.getWorld();
    if (!world) return false;
    let best: Targetable | null = null;
    let bestD = 64;
    const ents = world.getEntities();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e === this.mob || !e.isAlive()) continue;
      if (e.getTypeName() !== this.mob.getTypeName()) continue;
      const m = e as unknown as Mob;
      if (!m.isInLove || !m.isInLove()) continue;
      const d = this.mob.distanceToSqr(e.x, e.y, e.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (!best) return false;
    this.partner = best;
    return true;
  }

  canContinueToUse(): boolean {
    const p = this.partner;
    if (!p || !p.isAlive() || !this.mob.isInLove()) return false;
    return this.timer > 0 && this.mob.distanceToSqr(p.x, p.y, p.z) > 4;
  }

  start(): void {
    this.timer = 60 + this.mob.getRandom().nextInt(40);
  }

  tick(): void {
    const p = this.partner;
    if (!p) return;
    this.timer--;
    this.mob.getMoveControl().setWantedPosition(p.getX(), p.getY(), p.getZ(), this.speed);
    if (this.mob.distanceToSqr(p.getX(), p.getY(), p.getZ()) < 4) {
      this.mob.setInLove(false);
      const partner = p as unknown as Mob;
      partner.setInLove(false);
    }
  }

  stop(): void {
    this.partner = null;
    this.mob.getNavigation().stop();
  }
}
