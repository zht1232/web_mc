// Source: net.minecraft.world.entity.animal.Chicken
//
// Adult chickens lay one egg every 6000-12000 ticks; the egg item itself is a
// separate throwable entity (ThrownEgg) ported below in projectile/.

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Chicken extends Animal {
  /** Chicken.eggTime, rolled once the entity RNG exists (finalizeSpawn). */
  eggTime = 6000;

  constructor(level: ClientLevel) {
    super(entityType('chicken'), level);
    this.speed = 0.25;
    this.maxHealth = 4; this.health = 4;
  }

  override finalizeSpawn(): void {
    super.finalizeSpawn();
    this.eggTime = 6000 + this.random.nextInt(6000);
  }

  override tick(): void {
    super.tick();
    if (this.isBaby() || this.dead || this.isRemoved()) return;
    if (--this.eggTime <= 0) {
      this.eggTime = 6000 + this.random.nextInt(6000);
      this.world?.onChickenLayEgg?.(this);
    }
  }

  /** ItemTags.CHICKEN_FOOD. */
  protected getTemptingItems(): readonly string[] {
    return ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'];
  }
}
