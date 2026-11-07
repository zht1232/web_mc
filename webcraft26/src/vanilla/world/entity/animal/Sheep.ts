// Source: net.minecraft.world.entity.animal.Sheep

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Sheep extends Animal {
  /** wool colour index, exposed for the renderer */
  woolColor = 0;
  sheared = false;

  constructor(level: ClientLevel) {
    super(entityType('sheep'), level);
    this.speed = 0.23;
    this.maxHealth = 8; this.health = 8;
  }
}
