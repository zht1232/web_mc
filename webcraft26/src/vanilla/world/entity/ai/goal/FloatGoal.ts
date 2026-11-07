// Source: net.minecraft.world.entity.ai.goal.FloatGoal
//
// Keeps a mob from drowning: when in water/lava it claims the MOVE flag and
// pushes the mob upward each tick.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';

export class FloatGoal extends Goal {
  constructor(private readonly mob: Mob) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean { return this.mob.isInWater() || this.mob.isInLava(); }

  tick(): void {
    this.mob.setJumping(true);
    this.mob.push(0, 0.02, 0);
  }
}
