// Source: net.minecraft.world.entity.ai.goal.LookAtPlayerGoal
//
// Turns the head toward a nearby player. Claims the LOOK flag so it does not
// fight with other LOOK goals.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import type { Targetable } from '../../Entity.js';

export class LookAtPlayerGoal extends Goal {
  private player: Targetable | null = null;
  private timer = 0;

  constructor(private readonly mob: Mob, private readonly lookDistance = 8, private readonly chance = 0.5) {
    super();
    this.setFlags(GoalFlag.LOOK);
  }

  canUse(): boolean {
    if ((this.mob.tickCount + this.mob.id * 7) % 20 !== 0) return false;
    if (this.mob.getRandom().nextFloat() > this.chance) return false;
    const p = this.mob.world ? this.mob.world.getPlayer() : null;
    if (!p || !p.isAlive()) return false;
    if (this.mob.distanceToSqr(p.x, p.y, p.z) > this.lookDistance * this.lookDistance) return false;
    this.player = p;
    return true;
  }

  canContinueToUse(): boolean {
    const p = this.player;
    return p !== null && p.isAlive() && this.timer > 0
      && this.mob.distanceToSqr(p.x, p.y, p.z) < (this.lookDistance + 4) * (this.lookDistance + 4);
  }

  start(): void { this.timer = 20 + this.mob.getRandom().nextInt(20); }

  tick(): void {
    const p = this.player;
    if (!p) return;
    this.timer--;
    this.mob.lookAt(p, 10, 10);
  }

  stop(): void { this.player = null; }
}
