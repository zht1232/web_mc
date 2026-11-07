// Source: net.minecraft.world.entity.monster.Spider

import { Monster } from './Monster.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Spider extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('spider'), level);
    this.speed = 0.3;
    this.maxHealth = 16; this.health = 16;
    this.attackDamage = 2;
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }
}
