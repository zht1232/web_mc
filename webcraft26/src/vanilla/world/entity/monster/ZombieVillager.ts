// Source: net.minecraft.world.entity.monster.zombie.ZombieVillager
//
// Villager-shaped zombie: same zombie melee AI, different attributes.

import { Zombie } from './Zombie.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class ZombieVillager extends Zombie {
  constructor(level: ClientLevel) {
    super(level, entityType('zombie_villager'));
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 3;
  }
}
