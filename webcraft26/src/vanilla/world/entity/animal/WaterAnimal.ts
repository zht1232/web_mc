// Source: net.minecraft.world.entity.animal.fish.WaterAnimal
//
// Shared base for the passive water mobs. The port has no fluid physics for
// mobs, so water animals simply hover (`noGravity`) and wander horizontally at
// their spawn depth. Spawn placement (IN_WATER + surface water rules) is what
// keeps them inside the ocean, see SpawnPlacements.ts.

import { Mob } from '../Mob.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { entityType } from '../EntityType.js';
import type { EntityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class WaterAnimal extends Mob {
  constructor(level: ClientLevel, type: EntityType) {
    super(type, level);
    this.noGravity = true;
    this.speed = 0.15;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new RandomStrollGoal(this, 1.0, 8));
    this.goalSelector.addGoal(1, new RandomLookAroundGoal(this));
  }
}

/** Source: net.minecraft.world.entity.animal.fish.Squid. */
export class Squid extends WaterAnimal {
  constructor(level: ClientLevel) {
    super(level, entityType('squid'));
    this.maxHealth = 10; this.health = 10;
    this.scale = 0.8;
  }
}

/** Source: net.minecraft.world.entity.animal.fish.GlowSquid. */
export class GlowSquid extends WaterAnimal {
  constructor(level: ClientLevel) {
    super(level, entityType('glow_squid'));
    this.maxHealth = 10; this.health = 10;
    this.scale = 0.8;
  }
}

/** Source: net.minecraft.world.entity.animal.fish.Cod. */
export class Cod extends WaterAnimal {
  constructor(level: ClientLevel) {
    super(level, entityType('cod'));
    this.maxHealth = 3; this.health = 3;
    this.scale = 0.6;
  }
}

/** Source: net.minecraft.world.entity.animal.fish.Salmon. */
export class Salmon extends WaterAnimal {
  constructor(level: ClientLevel) {
    super(level, entityType('salmon'));
    this.maxHealth = 3; this.health = 3;
    this.scale = 0.7;
  }
}
