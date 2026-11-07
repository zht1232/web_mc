// Source: net.minecraft.world.entity.ExperienceOrb
//
// A floating XP orb. Uses the same light gravity/friction as an item and drifts
// toward a nearby player; pickup is handled by EntityManager.pickupXp.

import { Entity } from './Entity.js';
import { entityType } from './EntityType.js';
import type { ClientLevel } from '../level/ClientLevel.js';

export class ExperienceOrb extends Entity {
  /** How much XP this orb is worth. */
  value = 1;
  age = 0;

  constructor(level: ClientLevel, x: number, y: number, z: number, value = 1) {
    super(entityType('experience_orb'), level);
    this.setPos(x, y, z);
    this.value = value;
    this.scale = 0.5;
  }

  getValue(): number { return this.value; }

  tick(): void {
    this.baseTick();
    this.age++;
    // light gravity and drag (vanilla ExperienceOrb)
    this.vy = (this.vy - 0.03) * 0.98;
    this.vx *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.6; this.vz *= 0.6; }
    // drift toward the player when close
    const world = this.world;
    const p = world ? world.getPlayer() : null;
    if (p) {
      const dx = p.getX() - this.x, dz = p.getZ() - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 && d > 0.01) {
        this.vx += (dx / d) * 0.03;
        this.vz += (dz / d) * 0.03;
      }
    }
    this.move(this.vx, this.vy, this.vz);
    if (this.age > 6000) this.remove();
  }
}
