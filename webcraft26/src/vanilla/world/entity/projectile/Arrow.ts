// Source: net.minecraft.world.entity.projectile.Arrow
//
// Simple projectile physics: gravity 0.05, drag 0.99, orientation follows the
// velocity vector. Sticks in the ground on contact and despawns after 1200 ticks.
//
// Hit detection is a single sweep test against the player every tick (the only
// Targetable in the world that has a stable proxy: see PlayerTarget).

import { Entity, type Targetable } from '../Entity.js';
import { LivingEntity } from '../LivingEntity.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import { DEG_TO_RAD } from '../../../core/Mth.js';

export class Arrow extends Entity {
  life = 0;
  /** Base damage on normal difficulty (Arrow: 2; witch bolt overrides to 3). */
  damage = 2;
  inGround = false;
  critical = false;
  /** Shooter, used for last-damage-source attribution on the player. */
  owner: Targetable | null = null;

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

    const oldX = this.x, oldY = this.y, oldZ = this.z;
    this.move(this.vx, this.vy, this.vz);
    this.hitEntities(oldX, oldY, oldZ);
    if (this.onGround) {
      this.inGround = true;
      this.vx = this.vy = this.vz = 0;
    }
    if (this.life > 1200) this.remove();
  }

  /** Arrow.onHitEntity: sweep the travelled segment against mobs, then the player proxy. */
  private hitEntities(oldX: number, oldY: number, oldZ: number): void {
    const world = this.world;
    if (!world) return;
    // Mob targets (a player-shot arrow must be able to damage mobs; a skeleton arrow may
    // hit another mob on the way through).
    for (const e of world.getEntities()) {
      if (e === this || e === this.owner || e.isRemoved() || !e.isAlive()) continue;
      if (!(e instanceof LivingEntity)) continue;
      if (!this.segmentHits(e, oldX, oldY, oldZ)) continue;
      e.hurt(this.damage, this.owner);
      this.remove();
      return;
    }
    const target = world.getPlayer();
    if (!target || !target.isAlive() || target === this.owner) return;
    if (!this.segmentHits(target, oldX, oldY, oldZ)) return;
    target.hurt(this.damage, this.owner);
    this.remove();
  }

  /** Samples the tick segment against the target's AABB. */
  private segmentHits(target: Targetable, oldX: number, oldY: number, oldZ: number): boolean {
    const box = (target as unknown as { getBoundingBox?: () => { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } }).getBoundingBox?.();
    if (!box) return false;
    for (let s = 0; s <= 1; s += 0.25) {
      const px = oldX + (this.x - oldX) * s;
      const py = oldY + (this.y - oldY) * s;
      const pz = oldZ + (this.z - oldZ) * s;
      if (px >= box.minX && px <= box.maxX
        && py >= box.minY && py <= box.maxY
        && pz >= box.minZ && pz <= box.maxZ) return true;
    }
    return false;
  }
}
