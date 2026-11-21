// Source: net.minecraft.world.entity.animal.Mooshroom
//
// Cow variant with a mushroom skin. The port has no mushroom-shearing /
// stew interaction yet; the shared Cow AI (wheat temptation, breeding) applies.

import { Cow } from './Cow.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Mooshroom extends Cow {
  constructor(level: ClientLevel) {
    super(level, entityType('mooshroom'));
    this.speed = 0.2;
    this.maxHealth = 10; this.health = 10;
  }
}
