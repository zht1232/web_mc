// Source: net.minecraft.world.entity.monster.spider.CaveSpider
//
// Smaller spider: 12 HP and 2 attack damage, melee AI inherited.

import { Monster } from './Monster.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class CaveSpider extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('cave_spider'), level);
    this.speed = 0.3;
    this.maxHealth = 12; this.health = 12;
    this.attackDamage = 2;
    this.scale = 0.7;
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }
}
