// Source: net.minecraft.world.entity.animal.Pig

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Pig extends Animal {
  constructor(level: ClientLevel) {
    super(entityType('pig'), level);
    this.speed = 0.25;
    this.maxHealth = 10; this.health = 10;
  }
}
