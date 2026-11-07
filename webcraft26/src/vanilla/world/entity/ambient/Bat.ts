// Source: net.minecraft.world.entity.ambient.Bat
//
// A flying ambient mob: no gravity, wanders at a fixed height.

import { Mob } from '../Mob.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Bat extends Mob {
  constructor(level: ClientLevel) {
    super(entityType('bat'), level);
    this.noGravity = true;
    this.speed = 0.15;
    this.maxHealth = 6; this.health = 6;
    this.scale = 0.5;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new RandomStrollGoal(this, 1.0, 8));
    this.goalSelector.addGoal(1, new RandomLookAroundGoal(this));
  }
}
