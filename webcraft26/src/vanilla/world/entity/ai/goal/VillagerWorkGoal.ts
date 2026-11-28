// Source: net.minecraft.world.entity.ai.behavior.WorkAtPoi
//         + VillagerSchedules.VILLAGER_DEFAULT (Activity.WORK)
//
// During the two WORK windows the villager walks back to its claimed job site
// and works there. Farmers keep HarvestFarmland at a higher goal priority, so
// this goal is the "stand at the workstation" fallback once the fields are
// tended.

import { Goal, GoalFlag } from './Goal.js';
import type { Villager } from '../../npc/Villager.js';

/** Within 1.5 blocks of the workstation (WorkAtPoi's close-enough distance). */
const ARRIVE_DISTANCE_SQR = 2.25;

export class VillagerWorkGoal extends Goal {
  constructor(private readonly villager: Villager) {
    super();
    this.setFlags(GoalFlag.MOVE, GoalFlag.LOOK);
  }

  canUse(): boolean {
    const v = this.villager;
    if (v.isBaby() || v.sleeping || v.tradingPlayer != null) return false;
    if (v.getSchedulePhase() !== 'work') return false;
    return v.jobSite !== null;
  }

  canContinueToUse(): boolean {
    return this.canUse();
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const v = this.villager;
    const job = v.jobSite;
    if (!job) return;
    const tx = job.x + 0.5, ty = job.y, tz = job.z + 0.5;
    if (v.distanceToSqr(tx, ty, tz) > ARRIVE_DISTANCE_SQR) {
      v.getMoveControl().setWantedPosition(tx, ty, tz, 0.5);
      return;
    }
    v.getNavigation().stop();
    // Face the workstation while working (WorkAtPoi's look behaviour).
    const dx = tx - v.x, dz = tz - v.z;
    v.yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
    v.pitch = 25;
  }

  stop(): void {
    this.villager.getNavigation().stop();
  }
}
