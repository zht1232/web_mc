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
    if (this.mob.getAge() !== 0) return false; // Animal.canFallInLove: adults only
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
      if (m.getAge() !== 0) continue;
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
    return this.timer > 0;
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
      // Animal.spawnChildFromBreeding: spawns the child, XP and the 6000-tick
      // cooldown on both parents (the partner's love is reset there too).
      this.mob.breedWith(p as unknown as Mob);
      this.timer = 0;
    }
  }

  stop(): void {
    this.partner = null;
    this.mob.getNavigation().stop();
  }
}
