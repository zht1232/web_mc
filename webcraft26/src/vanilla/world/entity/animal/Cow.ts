// Source: net.minecraft.world.entity.animal.Cow

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { EntityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Cow extends Animal {
  constructor(level: ClientLevel, type: EntityType = entityType('cow')) {
    super(type, level);
    this.speed = 0.2;
    this.maxHealth = 10; this.health = 10;
  }

  /** ItemTags.COW_FOOD. */
  protected getTemptingItems(): readonly string[] { return ['wheat']; }
}
