// Source: net.minecraft.world.entity.animal.Chicken

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Chicken extends Animal {
  constructor(level: ClientLevel) {
    super(entityType('chicken'), level);
    this.speed = 0.25;
    this.maxHealth = 4; this.health = 4;
  }
}
