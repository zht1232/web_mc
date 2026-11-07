// Source: net.minecraft.world.entity.ai.goal.RandomStrollGoal
//
// Occasionally picks a random nearby point and walks to it. The roll is gated
// by the world tick so the deterministic RNG is only consumed every ~20 ticks.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class RandomStrollGoal extends Goal {
  private tx = 0; private ty = 0; private tz = 0;
  private timer = 0;

  constructor(private readonly mob: Mob, private readonly speed: number, private readonly radius = 10) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    // cheap deterministic gate: no RNG consumption on most ticks
    if ((this.mob.tickCount + this.mob.id) % 20 !== 0) return false;
    const r = this.mob.getRandom();
    if (r.nextInt(3) !== 0) return false;
    const dx = (r.nextFloat() * 2 - 1) * this.radius;
    const dz = (r.nextFloat() * 2 - 1) * this.radius;
    this.tx = this.mob.x + dx;
    this.tz = this.mob.z + dz;
    this.ty = this.mob.y;
    return true;
  }

  canContinueToUse(): boolean {
    return this.timer > 0 && !this.reached();
  }

  start(): void {
    this.timer = 40 + this.mob.getRandom().nextInt(40);
    this.mob.getNavigation().moveTo(this.tx, this.ty, this.tz, this.speed);
  }

  tick(): void {
    this.timer--;
    this.mob.getMoveControl().setWantedPosition(this.tx, this.ty, this.tz, this.speed);
  }

  stop(): void {
    this.timer = 0;
    this.mob.getNavigation().stop();
  }

  private reached(): boolean {
    return this.mob.distanceToSqr(this.tx, this.mob.y, this.tz) < 2;
  }
}
