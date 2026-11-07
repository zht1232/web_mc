// Source: net.minecraft.world.entity.monster.Enderman

import { Monster } from './Monster.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Enderman extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('enderman'), level);
    this.speed = 0.3;
    this.maxHealth = 40; this.health = 40;
    this.attackDamage = 7;
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }
}
