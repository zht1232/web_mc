// Source: net.minecraft.world.entity.monster.Zombie

import { Monster } from './Monster.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Zombie extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('zombie'), level);
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 3;
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }
}
