// Source: net.minecraft.world.entity.animal.Cat
//
// Passive animal (vanilla cat/ocelot differ only by taming data in the port).
// The constructor takes an explicit EntityType so Ocelot can reuse the goals.

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { EntityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Cat extends Animal {
  constructor(level: ClientLevel, type: EntityType = entityType('cat')) {
    super(type, level);
    this.speed = 0.3;
    this.maxHealth = 10; this.health = 10;
    this.baseScale = 0.8;
    this.scale = 0.8;
  }

  /** ItemTags.CAT_FOOD (Ocelot inherits). */
  protected getTemptingItems(): readonly string[] { return ['cod', 'salmon']; }
}

/** Source: net.minecraft.world.entity.animal.Ocelot. */
export class Ocelot extends Cat {
  constructor(level: ClientLevel) {
    super(level, entityType('ocelot'));
  }
}
