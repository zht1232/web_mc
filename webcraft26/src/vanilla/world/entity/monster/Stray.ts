// Source: net.minecraft.world.entity.monster.skeleton.Stray
//
// Cold variant of the skeleton (slowness arrows are not simulated; the ranged
// AI is inherited unchanged).

import { Skeleton } from './Skeleton.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Stray extends Skeleton {
  constructor(level: ClientLevel) {
    super(level, entityType('stray'));
    this.speed = 0.25;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 2;
  }
}
