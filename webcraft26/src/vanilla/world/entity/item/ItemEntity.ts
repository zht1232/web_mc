// Source: net.minecraft.world.entity.item.ItemEntity
//
// A dropped item. It falls with a light gravity (0.04), loses horizontal speed
// to ground friction, becomes still once landed, and can be picked up after the
// pickup delay. Bob/rotation are exposed for the renderer.

import { Entity } from '../Entity.js';
import { entityType } from '../EntityType.js';
import type { ItemStack } from '../LivingEntity.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class ItemEntity extends Entity {
  item: ItemStack;
  age = 0;
  pickupDelay = 10;
  health = 5;
  /** render bob phase */
  bob = 0;
  spin = 0;

  constructor(level: ClientLevel, x: number, y: number, z: number, item: ItemStack) {
    super(entityType('item'), level);
    this.setPos(x, y, z);
    this.item = item;
    this.scale = 0.4;
  }

  getItem(): ItemStack { return this.item; }
  setPickupDelay(ticks: number): void { this.pickupDelay = ticks; }

  /** Vanilla ItemEntity: pickup allowed once it has rested and the delay elapsed. */
  isPickable(): boolean {
    return this.age > 5 && this.pickupDelay <= 0 && this.onGround
      && Math.abs(this.vy) < 0.01;
  }

  isAtRest(): boolean {
    return this.onGround && Math.abs(this.vy) < 0.01
      && Math.abs(this.vx) < 0.01 && Math.abs(this.vz) < 0.01;
  }

  tick(): void {
    this.baseTick();
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.bob += 0.04;
    this.spin += 0.03;

    // vanilla ItemEntity gravity/drag
    this.vy = (this.vy - 0.04) * 0.98;
    this.vx *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.6; this.vz *= 0.6; }

    this.move(this.vx, this.vy, this.vz);
    if (this.age > 6000) this.remove();
  }
}
