// Source: net.minecraft.world.entity.monster.skeleton.Bogged
//
// Skeleton variant: same ranged AI, slightly different attributes.

import { Skeleton } from './Skeleton.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Bogged extends Skeleton {
  constructor(level: ClientLevel) {
    super(level, entityType('bogged'));
    this.speed = 0.25;
    this.maxHealth = 16; this.health = 16;
    this.attackDamage = 2;
  }
}
