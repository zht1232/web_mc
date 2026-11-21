// Source: net.minecraft.world.entity.animal.Animal
//
// Shared passive-animal goals: float, panic, breed, tempt, follow parent,
// stroll, look at player and idle head movement.
//
// AgeableMob state (age / love) lives on Mob; this class implements the
// Animal-specific parts: the food tag, breeding readiness, baby feeding and
// spawnChildFromBreeding.

import { Mob } from '../Mob.js';
import { ExperienceOrb } from '../ExperienceOrb.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { PanicGoal } from '../ai/goal/PanicGoal.js';
import { BreedGoal } from '../ai/goal/BreedGoal.js';
import { TemptGoal } from '../ai/goal/TemptGoal.js';
import { FollowParentGoal } from '../ai/goal/FollowParentGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';

export class Animal extends Mob {
  /** Item short names that tempt this species (vanilla ItemTags.*_FOOD). */
  protected getTemptingItems(): readonly string[] { return []; }

  /** Animal.isFood: the temptation tag is also the breeding food tag. */
  isFood(itemName: string): boolean { return this.getTemptingItems().includes(itemName); }

  /** AgeableMob.canFallInLove: adult, off cooldown and not already in love. */
  canFallInLove(): boolean { return this.getAge() === 0 && !this.isInLove(); }

  /** AgeableMob.mobInteract baby path: skip 10% of the remaining growth time. */
  feedBaby(): void {
    const remaining = -this.getAge();
    if (remaining <= 0) return;
    this.setAge(Math.min(0, this.getAge() + Math.floor(remaining * 0.1)));
  }

  /**
   * Source: Animal.spawnChildFromBreeding. Both parents reset love and go on
   * the 6000-tick cooldown; the child is the same entity type at half size and
   * is parented so FollowParentGoal can keep it close.
   */
  override breedWith(partner: Mob): void {
    const world = this.getWorld();
    if (!world) return;
    this.setInLove(false);
    partner.setInLove(false);
    this.setAge(6000);
    partner.setAge(6000);

    const child = this.type.create(this.level, this.x, this.y, this.z);
    if (child instanceof Mob) {
      child.setAge(-24000);
      child.setPos((this.x + partner.x) / 2, (this.y + partner.y) / 2, (this.z + partner.z) / 2);
      child.setParent(this);
      world.spawnEntity(child);
    }
    // Animal.spawnChildFromBreeding: 1-7 experience.
    world.spawnEntity(new ExperienceOrb(this.level, this.x, this.y, this.z, 1 + this.random.nextInt(7)));
    world.onAnimalBred?.(this);
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new PanicGoal(this, 1.5));
    this.goalSelector.addGoal(2, new BreedGoal(this, 1.0));
    this.goalSelector.addGoal(3, new TemptGoal(this, 1.25, this.getTemptingItems()));
    this.goalSelector.addGoal(4, new FollowParentGoal(this, 1.1));
    this.goalSelector.addGoal(5, new RandomStrollGoal(this, 0.8));
    this.goalSelector.addGoal(6, new LookAtPlayerGoal(this, 6));
    this.goalSelector.addGoal(7, new RandomLookAroundGoal(this));
  }
}
