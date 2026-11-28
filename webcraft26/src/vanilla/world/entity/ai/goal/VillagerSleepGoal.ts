// Source: net.minecraft.world.entity.ai.behavior.SleepInBed (villager Sleep activity)
//
// At sunset the villager claims a nearby bed, walks to it and lies down. The
// goal stops once the villager is sleeping; waking is driven by
// Villager.tickSleep when the sun rises or the bed is destroyed.

import { Goal, GoalFlag } from './Goal.js';
import type { Villager, VillagerBed } from '../../npc/Villager.js';

/** Bed scans are POI-style lookups, throttled like the job-site scan. */
const BED_SCAN_INTERVAL = 40;

export class VillagerSleepGoal extends Goal {
  private bed: VillagerBed | null = null;
  private nextScan = 0;

  constructor(private readonly villager: Villager) {
    super();
    this.setFlags(GoalFlag.MOVE);
  }

  canUse(): boolean {
    const v = this.villager;
    if (v.sleeping || v.isBaby() || v.tradingPlayer != null) return false;
    if (!v.isNight()) return false;
    if (v.tickCount >= this.nextScan) {
      this.nextScan = v.tickCount + BED_SCAN_INTERVAL;
      this.bed = v.findAvailableBed();
    }
    return !!this.bed && v.canClaimBed(this.bed);
  }

  start(): void {
    const bed = this.bed;
    if (!bed || !this.villager.canClaimBed(bed)) { this.bed = null; return; }
    this.villager.claimBed(bed);
  }

  canContinueToUse(): boolean {
    if (!this.bed || this.villager.sleeping) return false;
    if (!this.villager.isNight()) return false;
    return this.villager.ownsBed() && this.villager.hasBed();
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const bed = this.bed;
    if (!bed) return;
    // Centre of the two-block bed (foot block centre + half toward the head).
    const cx = bed.hx + 0.5 - bed.fx * 0.5;
    const cz = bed.hz + 0.5 - bed.fz * 0.5;
    this.villager.getMoveControl().setWantedPosition(cx, bed.hy + 0.8, cz, 0.5);
    if (this.villager.distanceToSqr(cx, bed.hy + 0.8, cz) < 2.25) {
      this.villager.startSleeping(bed);
    }
  }

  stop(): void {
    if (!this.villager.sleeping) this.villager.releaseBed();
    this.bed = null;
    this.villager.getNavigation().stop();
  }
}
