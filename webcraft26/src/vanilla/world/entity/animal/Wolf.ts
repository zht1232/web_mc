// Source: net.minecraft.world.entity.animal.Wolf
//
// A hostile/neutral wolf: it can melee-attack a target (vanilla wolves are
// tameable and attack on command; here they are aggressive toward players).

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { TemptGoal } from '../ai/goal/TemptGoal.js';
import { NearestAttackableTargetGoal } from '../ai/goal/NearestAttackableTargetGoal.js';
import { HurtByTargetGoal } from '../ai/goal/HurtByTargetGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Wolf extends Mob {
  constructor(level: ClientLevel) {
    super(entityType('wolf'), level);
    this.speed = 0.3;
    this.maxHealth = 8; this.health = 8;
    this.attackDamage = 4;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new MeleeAttackGoal(this, 1.0));
    // ItemTags.WOLF_FOOD (untamed wolves follow meat).
    this.goalSelector.addGoal(2, new TemptGoal(this, 1.0, [
      'beef', 'chicken', 'mutton', 'porkchop', 'rabbit', 'cod', 'salmon', 'rotten_flesh',
      'cooked_beef', 'cooked_chicken', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit',
      'cooked_cod', 'cooked_salmon',
    ]));
    this.goalSelector.addGoal(3, new RandomStrollGoal(this, 0.8));
    this.goalSelector.addGoal(4, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(5, new RandomLookAroundGoal(this));
    this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
    this.targetSelector.addGoal(2, new NearestAttackableTargetGoal(this, 16, this.playerPredicate));
  }
}
