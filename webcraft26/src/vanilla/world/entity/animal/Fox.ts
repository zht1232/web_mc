// Source: net.minecraft.world.entity.animal.Fox
//
// Passive animal with the shared Animal goals; the port does not simulate the
// vanilla pounce / chicken hunting behaviour.

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Fox extends Animal {
  constructor(level: ClientLevel) {
    super(entityType('fox'), level);
    this.speed = 0.3;
    this.maxHealth = 10; this.health = 10;
    this.scale = 0.8;
  }
}
