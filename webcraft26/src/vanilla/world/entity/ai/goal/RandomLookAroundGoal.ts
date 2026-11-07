// Source: net.minecraft.world.entity.ai.goal.RandomLookAroundGoal
//
// Idle head movement: pick a random yaw/pitch and rotate toward it smoothly.

import { Goal, GoalFlag } from './Goal.js';
import type { Mob } from '../../Mob.js';
import { approachDegrees } from '../../../../core/Mth.js';

export class RandomLookAroundGoal extends Goal {
  private wantYaw = 0;
  private wantPitch = 0;
  private timer = 0;

  constructor(private readonly mob: Mob) {
    super();
    this.setFlags(GoalFlag.LOOK);
  }

  canUse(): boolean {
    if ((this.mob.tickCount + this.mob.id * 11) % 20 !== 0) return false;
    const r = this.mob.getRandom();
    if (r.nextFloat() > 0.3) return false;
    this.wantYaw = this.mob.yaw + (r.nextFloat() * 2 - 1) * 120;
    this.wantPitch = (r.nextFloat() * 2 - 1) * 20;
    return true;
  }

  canContinueToUse(): boolean { return this.timer > 0; }

  start(): void { this.timer = 20 + this.mob.getRandom().nextInt(20); }

  tick(): void {
    this.timer--;
    this.mob.setYRot(approachDegrees(this.mob.yaw, this.wantYaw, 5));
    this.mob.setXRot(approachDegrees(this.mob.pitch, this.wantPitch, 3));
  }
}
