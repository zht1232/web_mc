// Source: net.minecraft.world.entity.projectile.Arrow
//
// Simple projectile physics: gravity 0.05, drag 0.99, orientation follows the
// velocity vector. Sticks in the ground on contact and despawns after 1200 ticks.

import { Entity } from '../Entity.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import { DEG_TO_RAD } from '../../../core/Mth.js';

export class Arrow extends Entity {
  life = 0;
  damage = 2;
  inGround = false;
  critical = false;

  constructor(level: ClientLevel, x: number, y: number, z: number) {
    super(entityType('arrow'), level);
    this.setPos(x, y, z);
    this.scale = 0.5;
  }

  /** Sets the initial velocity (blocks/tick). */
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
    if (this.inGround) {
      if (this.life > 1200) this.remove();
      return;
    }

    this.vy -= 0.05;
    this.vx *= 0.99; this.vy *= 0.99; this.vz *= 0.99;

    const horiz = Math.hypot(this.vx, this.vz);
    if (horiz > 1e-4) {
      this.yaw = Math.atan2(-this.vx, this.vz) / DEG_TO_RAD;
      this.pitch = -Math.atan2(this.vy, horiz) / DEG_TO_RAD;
    }

    this.move(this.vx, this.vy, this.vz);
    if (this.onGround) {
      this.inGround = true;
      this.vx = this.vy = this.vz = 0;
    }
    if (this.life > 1200) this.remove();
  }
}
