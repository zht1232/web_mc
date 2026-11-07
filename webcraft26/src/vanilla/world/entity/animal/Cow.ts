// Source: net.minecraft.world.entity.animal.Cow

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Cow extends Animal {
  constructor(level: ClientLevel) {
    super(entityType('cow'), level);
    this.speed = 0.2;
    this.maxHealth = 10; this.health = 10;
  }
}
