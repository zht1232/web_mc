// Source: net.minecraft.world.entity.monster.cubemob.Slime (simplified)
//
// A hopping cube mob: it keeps its target from the standard Monster target
// selector and hops toward it, dealing damage on contact. Size 2 (vanilla
// slime sizes are 1/2/4; the port keeps a single 2-block size, 16 HP).
//
// Not simulated: riding/stacking, squish animation, split-on-death, slime
// chunk seed search (see SpawnPlacements.checkSlimeRules).

import { Monster } from './Monster.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Slime extends Monster {
  private hopCooldown = 0;

  constructor(level: ClientLevel) {
    super(entityType('slime'), level);
    this.speed = 0.25;
    this.maxHealth = 16; this.health = 16;
    this.attackDamage = 4;
    this.scale = 2;
  }

  /** Vanilla Slime.tick: hop periodically; the travel code applies gravity. */
  tick(): void {
    if (this.onGround && this.hopCooldown-- <= 0) {
      const t = this.target;
      const r = this.getRandom();
      let dx: number;
      let dz: number;
      if (t && t.isAlive()) {
        dx = t.getX() - this.x;
        dz = t.getZ() - this.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
      } else {
        const a = r.nextFloat() * Math.PI * 2;
        dx = Math.cos(a); dz = Math.sin(a);
      }
      this.vy = 0.42;
      this.vx = dx * 0.2;
      this.vz = dz * 0.2;
      this.hopCooldown = 10 + r.nextInt(10);
      // contact damage while hopping into the target
      if (t && t.isAlive() && this.distanceToSqr(t.getX(), t.getY(), t.getZ()) < 4) this.doHurtTarget(t);
    }
    super.tick();
  }
}
