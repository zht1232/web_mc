// Source: net.minecraft.world.entity.ai.behavior.MeetAtPoi (Activity.MEET)
//
// During the 3000-6000 MEET window villagers gather around the village bell
// (the vanilla meeting point is a bell POI; this port scans for a bell block).
// Each villager stops on a per-villager offset around the bell so a crowd does
// not stack on the same block.

import { Goal, GoalFlag } from './Goal.js';
import type { Villager } from '../../npc/Villager.js';

const BELL_SCAN_RADIUS = 32;
const BELL_SCAN_INTERVAL = 100;
/** Stop distance from the bell (vanilla villagers chat within a few blocks). */
const GATHER_RADIUS = 2.2;
const ARRIVE_DISTANCE_SQR = 1.5;

interface BellPos { x: number; y: number; z: number }

export class VillagerMeetGoal extends Goal {
  private bell: BellPos | null = null;
  private nextScan = 0;
  private targetX = 0;
  private targetZ = 0;

  constructor(private readonly villager: Villager) {
    super();
    this.setFlags(GoalFlag.MOVE, GoalFlag.LOOK);
  }

  canUse(): boolean {
    const v = this.villager;
    if (v.isBaby() || v.sleeping || v.tradingPlayer != null) return false;
    if (v.getSchedulePhase() !== 'meet') return false;
    if (!this.bell) {
      if (v.tickCount < this.nextScan) return false;
      this.nextScan = v.tickCount + BELL_SCAN_INTERVAL;
      this.bell = this.findBell();
    }
    return this.bell !== null;
  }

  start(): void {
    const bell = this.bell;
    if (!bell) return;
    // Spread the crowd around the bell (vanilla picks random POI positions).
    const angle = ((this.villager.id % 16) / 16) * Math.PI * 2;
    this.targetX = bell.x + 0.5 + Math.cos(angle) * GATHER_RADIUS;
    this.targetZ = bell.z + 0.5 + Math.sin(angle) * GATHER_RADIUS;
  }

  canContinueToUse(): boolean {
    const bell = this.bell;
    if (!bell) return false;
    if (!this.isBell(bell.x, bell.y, bell.z)) return false;
    return this.villager.getSchedulePhase() === 'meet';
  }

  requiresUpdateEveryTick(): boolean { return true; }

  tick(): void {
    const bell = this.bell;
    if (!bell) return;
    const v = this.villager;
    if (v.distanceToSqr(this.targetX, bell.y, this.targetZ) > ARRIVE_DISTANCE_SQR) {
      v.getMoveControl().setWantedPosition(this.targetX, bell.y, this.targetZ, 0.5);
      return;
    }
    v.getNavigation().stop();
    // Face the bell while chatting.
    const dx = bell.x + 0.5 - v.x, dz = bell.z + 0.5 - v.z;
    v.yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
  }

  stop(): void {
    this.villager.getNavigation().stop();
  }

  private isBell(x: number, y: number, z: number): boolean {
    const level = this.villager.level;
    const state = level.getBlockState(x, y, z);
    return state !== 0 && level.mc.blockOf(state).name === 'bell';
  }

  private findBell(): BellPos | null {
    const level = this.villager.level;
    const mc = level.mc;
    const ox = Math.floor(this.villager.x), oy = Math.floor(this.villager.y), oz = Math.floor(this.villager.z);
    let best: BellPos | null = null;
    let bestD = Infinity;
    for (let dy = -6; dy <= 6; dy++) {
      const y = oy + dy;
      for (let dz = -BELL_SCAN_RADIUS; dz <= BELL_SCAN_RADIUS; dz++) {
        for (let dx = -BELL_SCAN_RADIUS; dx <= BELL_SCAN_RADIUS; dx++) {
          const x = ox + dx, z = oz + dz;
          const state = level.getBlockState(x, y, z);
          if (state === 0) continue;
          if (mc.blockOf(state).name !== 'bell') continue;
          const d = this.villager.distanceToSqr(x + 0.5, y + 0.5, z + 0.5);
          if (d < bestD) { bestD = d; best = { x, y, z }; }
        }
      }
    }
    return best;
  }
}
