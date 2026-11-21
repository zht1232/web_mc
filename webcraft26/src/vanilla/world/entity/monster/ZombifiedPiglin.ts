// Source: net.minecraft.world.entity.monster.ZombifiedPiglin
//
// Neutral Nether zombie: it only fights back after being hurt. Monster's normal
// player-target selector is replaced by HurtByTargetGoal here.

import { Zombie } from './Zombie.js';
import { HurtByTargetGoal } from '../ai/goal/HurtByTargetGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class ZombifiedPiglin extends Zombie {
  constructor(level: ClientLevel) {
    super(level, entityType('zombified_piglin'));
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 5;
  }

  /** Neutral: do not acquire players proactively, only retaliate when hurt. */
  protected registerTargetGoals(): void {
    this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
  }
}
