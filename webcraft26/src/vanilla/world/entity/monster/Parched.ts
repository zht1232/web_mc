// Source: net.minecraft.world.entity.monster.skeleton.Parched (26.2)
//
// Desert skeleton variant: ranged bow AI like the base skeleton. Its weakness
// arrows are not simulated yet; the shared SkeletonModel + parched texture are.

import { Skeleton } from './Skeleton.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Parched extends Skeleton {
  constructor(level: ClientLevel) {
    super(level, entityType('parched'));
    this.speed = 0.25;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 2;
  }
}
