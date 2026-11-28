// Source: net.minecraft.world.entity.ai.behavior.HarvestFarmland
//
// Farmers walk to a mature crop within 8 blocks, break it (the drops go into the
// villager's food/wheat stock, see Villager.harvestCrop) and replant it. Work
// runs for up to 200 ticks, then pauses for 40 ticks like the vanilla behavior's
// nextOkStartTime cooldown.

import { Goal, GoalFlag } from './Goal.js';
import type { Villager } from '../../npc/Villager.js';

export class FarmerHarvestGoal extends Goal {
  private target: { x: number; y: number; z: number } | null = null;
  private worked = 0;
  private cooldown = 0;

  constructor(private readonly villager: Villager, private readonly speed = 0.5) {
    super();
    this.setFlags(GoalFlag.MOVE, GoalFlag.LOOK);
  }

  canUse(): boolean {
    if (this.villager.profession !== 'farmer') return false;
    if (this.cooldown > 0) { this.cooldown--; return false; }
    const crop = this.villager.findHarvestableCrop(8);
    if (!crop) return false;
    this.target = crop;
    this.worked = 0;
    return true;
  }

  canContinueToUse(): boolean {
    return this.target !== null && this.worked < 200;
  }

  start(): void {
    this.worked = 0;
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const t = this.target;
    if (!t) return;
    this.worked++;
    const d2 = this.villager.distanceToSqr(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    if (d2 > 2.25) {
      this.villager.getMoveControl().setWantedPosition(t.x + 0.5, t.y + 0.5, t.z + 0.5, this.speed);
      return;
    }
    this.villager.harvestCrop(t.x, t.y, t.z);
    this.target = null;
    this.cooldown = 40;
  }

  stop(): void {
    this.target = null;
    this.villager.getNavigation().stop();
  }
}
