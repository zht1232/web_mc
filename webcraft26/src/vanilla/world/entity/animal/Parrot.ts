// Source: net.minecraft.world.entity.animal.Parrot
//
// Ambient flying passive bird: no gravity and a short wander, like Bat.

import { Mob } from '../Mob.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Parrot extends Mob {
  constructor(level: ClientLevel) {
    super(entityType('parrot'), level);
    this.noGravity = true;
    this.speed = 0.2;
    this.maxHealth = 6; this.health = 6;
    this.scale = 0.6;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new RandomStrollGoal(this, 1.0, 6));
    this.goalSelector.addGoal(1, new RandomLookAroundGoal(this));
  }
}
