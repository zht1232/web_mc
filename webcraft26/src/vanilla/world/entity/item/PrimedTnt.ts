// Source: net.minecraft.world.entity.item.PrimedTnt
//
// Primed TNT: falls with gravity 0.04, loses speed to drag 0.98 (0.7 horizontally
// on the ground), and explodes after `fuse` ticks. Explosion power 4 matches
// TntBlock; the explosion itself is resolved by the world hook (Game) so block
// destruction, chain reactions and entity damage stay in one place.

import { Entity } from '../Entity.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class PrimedTnt extends Entity {
  fuse = 80;
  /** Explosion.power for TNT (TntBlock sets 4.0F). */
  explosionPower = 4;

  constructor(level: ClientLevel, x = 0, y = 0, z = 0) {
    super(entityType('tnt'), level);
    this.setPos(x, y, z);
  }

  /** PrimedTnt.setFuse. */
  setFuse(ticks: number): void { this.fuse = ticks; }

  tick(): void {
    this.baseTick();
    if (!this.noGravity) this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) {
      this.vx *= 0.7;
      this.vz *= 0.7;
      this.vy *= -0.5;
    }

    this.fuse--;
    if (this.fuse <= 0) {
      this.remove();
      // PrimedTnt.explode: Explosion at getY(0.0625) with Level.ExplosionInteraction.TNT.
      this.world?.explode?.(this.x, this.y + 0.0625, this.z, this.explosionPower, 'tnt');
    }
  }
}
