// Source: net.minecraft.world.entity.monster.zombie.Drowned
//
// Water variant of the zombie. The port keeps the zombie's melee AI and only
// overrides the attributes / spawn placement (registered in SpawnPlacements.ts).

import { Zombie } from './Zombie.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Drowned extends Zombie {
  constructor(level: ClientLevel) {
    super(level, entityType('drowned'));
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 3;
  }
}
