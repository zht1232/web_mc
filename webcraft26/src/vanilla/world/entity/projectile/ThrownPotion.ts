// Source: net.minecraft.world.entity.projectile.ThrownSplashPotion /
//         ThrownLingeringPotion (ThrowableProjectile)
//
// Gravity 0.05, drag 0.99. It breaks on the first block or mob contact and
// reports the splash to the world: Game applies the distance-scaled effects for
// a splash potion, or spawns the AreaEffectCloud for a lingering potion.

import { Entity, type Targetable } from '../Entity.js';
import { Mob } from '../Mob.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import { DEG_TO_RAD } from '../../../core/Mth.js';
import type { ItemStack } from '../../item/ItemStack.js';

export class ThrownPotion extends Entity {
  owner: Targetable | null = null;
  item: ItemStack | null = null;
  life = 0;
  readonly lingering: boolean;

  constructor(level: ClientLevel, x = 0, y = 0, z = 0, lingering = false) {
    super(entityType(lingering ? 'lingering_potion' : 'splash_potion'), level);
    this.lingering = lingering;
    this.setPos(x, y, z);
  }

  /** PotionItem id stored on the stack (`splash_potion` / `lingering_potion`). */
  getItem(): ItemStack | null { return this.item; }

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
    // ThrowableProjectile.tick: gravity 0.05, drag 0.99.
    this.vy -= 0.05;
    this.vx *= 0.99; this.vz *= 0.99;
    const oldX = this.x, oldY = this.y, oldZ = this.z;
    this.move(this.vx, this.vy, this.vz);
    if (this.hitEntity(oldX, oldY, oldZ)) { this.splash(); return; }
    if (this.onGround || this.horizontalCollision || this.verticalCollision) { this.splash(); return; }
    if (this.life > 1200) this.remove();
  }

  /** ThrowableProjectile.hitEntity: any mob box along this tick's segment. */
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

  /** AbstractThrownPotion.onHit: hand the potion id to the area-effect handler. */
  private splash(): void {
    const potionId = this.item?.components.potion ?? 'water';
    this.world?.onPotionSplash?.(this.x, this.y, this.z, potionId, this.life, this.lingering);
    this.remove();
  }
}
