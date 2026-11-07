// Source: net.minecraft.world.entity.animal.Animal
//
// Shared passive-animal goals: float, panic, breed, tempt, follow parent,
// stroll, look at player and idle head movement.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { PanicGoal } from '../ai/goal/PanicGoal.js';
import { BreedGoal } from '../ai/goal/BreedGoal.js';
import { TemptGoal } from '../ai/goal/TemptGoal.js';
import { FollowParentGoal } from '../ai/goal/FollowParentGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';

export class Animal extends Mob {
  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new PanicGoal(this, 1.5));
    this.goalSelector.addGoal(2, new BreedGoal(this, 1.0));
    this.goalSelector.addGoal(3, new TemptGoal(this, 1.25));
    this.goalSelector.addGoal(4, new FollowParentGoal(this, 1.1));
    this.goalSelector.addGoal(5, new RandomStrollGoal(this, 0.8));
    this.goalSelector.addGoal(6, new LookAtPlayerGoal(this, 6));
    this.goalSelector.addGoal(7, new RandomLookAroundGoal(this));
  }
}
