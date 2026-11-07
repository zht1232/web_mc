// Source: net.minecraft.world.entity.monster.Silverfish

import { Monster } from './Monster.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Silverfish extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('silverfish'), level);
    this.speed = 0.25;
    this.maxHealth = 8; this.health = 8;
    this.attackDamage = 1;
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }
}
