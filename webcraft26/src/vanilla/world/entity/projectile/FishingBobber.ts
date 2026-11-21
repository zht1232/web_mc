// Source: net.minecraft.world.entity.projectile.FishingHook (26.2)
//
// Simplified bobber: it flies with gravity, floats on water and starts a random
// 5-25 s bite timer once it is in water. The rod reels it in; only a bitten
// bobber yields loot (rolled by Game, which owns the item registry/statistics).

import { Entity, type Targetable } from '../Entity.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import { DEG_TO_RAD } from '../../../core/Mth.js';

export class FishingBobber extends Entity {
  owner: Targetable | null = null;
  /** Lure enchantment level: each level shortens the random wait by 100 ticks. */
  lureLevel = 0;
  life = 0;
  /** Ticks until a bite; -1 while not floating in water. */
  waitTicks = -1;
  biting = false;
  /** Game plays entity.fishing_bobber.splash once when the bite starts. */
  splashPlayed = false;
  /** Visual dip applied by the renderer. */
  bob = 0;

  constructor(level: ClientLevel, x = 0, y = 0, z = 0) {
    super(entityType('fishing_bobber'), level);
    this.setPos(x, y, z);
  }

  /** Sets the initial velocity (blocks/tick) and faces the flight direction. */
  shoot(vx: number, vy: number, vz: number): void {
    this.vx = vx; this.vy = vy; this.vz = vz;
    const horiz = Math.hypot(vx, vz);
    if (horiz > 1e-4) {
      this.yaw = Math.atan2(-vx, vz) / DEG_TO_RAD;
      this.pitch = -Math.atan2(vy, horiz) / DEG_TO_RAD;
    }
  }

  tick(): void {
    this.baseTick();
    this.life++;

    if (this.inWater) {
      // FishingHook: float on the surface, tiny bob, then bite after a random wait.
      this.vx *= 0.9; this.vz *= 0.9;
      this.vy = 0;
      this.move(this.vx, 0, this.vz);
      this.bob = Math.sin(this.life * 0.2) * 0.02;
      if (this.waitTicks < 0 && !this.biting) {
        this.waitTicks = Math.max(20, 100 + this.random.nextInt(400) - this.lureLevel * 100);
      }
    } else {
      this.vy -= 0.03;
      this.vx *= 0.92; this.vz *= 0.92;
      this.move(this.vx, this.vy, this.vz);
      if (this.onGround) { this.vx = 0; this.vy = 0; this.vz = 0; }
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      if (this.waitTicks === 0) {
        this.biting = true;
        this.vy = -0.08;
      }
    }
    if (this.life > 1200) this.remove();
  }

  /** Reeling in: returns true when the bobber had a bite (loot is rolled by Game). */
  reel(): boolean {
    const caught = this.biting;
    this.remove();
    return caught;
  }
}
