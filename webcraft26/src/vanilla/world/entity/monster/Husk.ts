// Source: net.minecraft.world.entity.monster.zombie.Husk
//
// Desert zombie: same melee AI, 20 HP, 3 attack damage on normal difficulty.

import { Zombie } from './Zombie.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Husk extends Zombie {
  constructor(level: ClientLevel) {
    super(level, entityType('husk'));
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 3;
  }
}
