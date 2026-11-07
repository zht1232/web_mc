// Source: net.minecraft.world.entity.monster.Monster
//
// Shared goal setup for hostile mobs: float, an attack goal (provided by the
// subclass), stroll / look goals and the standard target selectors. Concrete
// monsters override registerAttackGoals() to pick melee / ranged / swell.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { NearestAttackableTargetGoal } from '../ai/goal/NearestAttackableTargetGoal.js';
import { HurtByTargetGoal } from '../ai/goal/HurtByTargetGoal.js';

export class Monster extends Mob {
  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.registerAttackGoals();
    this.goalSelector.addGoal(5, new RandomStrollGoal(this, 0.8));
    this.goalSelector.addGoal(6, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(7, new RandomLookAroundGoal(this));
    this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
    this.targetSelector.addGoal(2, new NearestAttackableTargetGoal(this, this.getTargetRange(), this.playerPredicate));
  }

  /** Override to change the target acquisition distance. */
  protected getTargetRange(): number { return 16; }

  protected registerAttackGoals(): void {}
}
