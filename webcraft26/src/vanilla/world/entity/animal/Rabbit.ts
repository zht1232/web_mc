// Source: net.minecraft.world.entity.animal.Rabbit
//
// Skittish: adds AvoidEntityGoal (flees players/wolves) on top of the standard
// Animal goals so it counts among the "会逃跑" mobs.

import { Animal } from './Animal.js';
import { AvoidEntityGoal } from '../ai/goal/AvoidEntityGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Rabbit extends Animal {
  constructor(level: ClientLevel) {
    super(entityType('rabbit'), level);
    this.speed = 0.3;
    this.maxHealth = 3; this.health = 3;
  }

  /** ItemTags.RABBIT_FOOD. */
  protected getTemptingItems(): readonly string[] { return ['carrot', 'golden_carrot', 'dandelion']; }

  protected registerGoals(): void {
    super.registerGoals();
    this.goalSelector.addGoal(1, new AvoidEntityGoal(
      this,
      e => e.getTypeName() === 'player' || e.getTypeName() === 'wolf',
      10, 1.6,
    ));
  }
}
