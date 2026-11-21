// Source: net.minecraft.world.entity.projectile.ThrownEgg
//
// Thrown egg: gravity 0.03, drag 0.99; it shatters on the first block contact
// and has a 1/8 chance to spawn a baby chicken (ThrownEgg.onHit).

import { Entity, type Targetable } from '../Entity.js';
import { Mob } from '../Mob.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import { DEG_TO_RAD } from '../../../core/Mth.js';

export class ThrownEgg extends Entity {
  owner: Targetable | null = null;
  life = 0;

  constructor(level: ClientLevel, x = 0, y = 0, z = 0) {
    super(entityType('egg'), level);
    this.setPos(x, y, z);
  }

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
    this.vy -= 0.03;
    this.vx *= 0.99; this.vz *= 0.99;
    const oldX = this.x, oldY = this.y, oldZ = this.z;
    this.move(this.vx, this.vy, this.vz);
    // A flying egg that clips a mob shatters too (damage 0 in vanilla).
    if (this.hitEntity(oldX, oldY, oldZ)) { this.shatter(); return; }
    if (this.onGround || this.horizontalCollision || this.verticalCollision) { this.shatter(); return; }
    if (this.life > 600) this.remove();
  }

  /** Entity hit test along the tick segment (no damage; eggs only knock back in vanilla). */
  private hitEntity(oldX: number, oldY: number, oldZ: number): boolean {
    const world = this.world;
    if (!world) return false;
    for (const e of world.getEntities()) {
      if (e === this || e === this.owner || e.isRemoved() || !e.isAlive()) continue;
      if (!(e instanceof Mob)) continue;
      const box = e.getBoundingBox().inflateAll(0.15);
      if (box.minX > Math.max(oldX, this.x) || box.maxX < Math.min(oldX, this.x)) continue;
      if (box.minY > Math.max(oldY, this.y) || box.maxY < Math.min(oldY, this.y)) continue;
      if (box.minZ > Math.max(oldZ, this.z) || box.maxZ < Math.min(oldZ, this.z)) continue;
      return true;
    }
    return false;
  }

  /** ThrownEgg.onHit: 1/8 chance of a baby chicken, then discard. */
  private shatter(): void {
    if (this.world && this.random.nextInt(8) === 0) {
      const chick = entityType('chicken').create(this.level, this.x, this.y, this.z);
      if (chick instanceof Mob) {
        chick.setBaby(true);
        chick.setPos(this.x, this.y, this.z);
        this.world.spawnEntity(chick);
      }
    }
    this.remove();
  }
}
