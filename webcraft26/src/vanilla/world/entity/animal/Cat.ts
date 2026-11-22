// Source: net.minecraft.world.entity.animal.Cat
//
// Passive tameable cat/ocelot. Raw cod or salmon tames a cat (1/3), an empty
// click toggles sitting, and tamed cats follow the player.

import { Animal } from './Animal.js';
import { FollowOwnerGoal } from '../ai/goal/FollowOwnerGoal.js';
import { entityType } from '../EntityType.js';
import type { EntityType } from '../EntityType.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Cat extends Animal {
  constructor(level: ClientLevel, type: EntityType = entityType('cat')) {
    super(type, level);
    this.speed = 0.3;
    this.maxHealth = 10; this.health = 10;
    this.baseScale = 0.8;
    this.scale = 0.8;
  }

  protected registerGoals(): void {
    super.registerGoals();
    this.goalSelector.addGoal(2, new FollowOwnerGoal(this, 1.0));
  }

  /** ItemTags.CAT_FOOD (Ocelot inherits). */
  protected getTemptingItems(): readonly string[] { return ['cod', 'salmon']; }

  /** Cat.mobInteract: fish tames an untamed cat; after that a click toggles sitting. */
  interact(stack: ItemStack): 'tame' | 'fail' | 'toggle' | null {
    const name = stack.item?.name ?? '';
    if (name === 'cod' || name === 'salmon') {
      if (this.tamed) return null;
      if (this.random.nextInt(3) === 0) {
        this.tamed = true;
        this.sitting = true;
        this.owner = 'player';
        this.getNavigation().stop();
        return 'tame';
      }
      return 'fail';
    }
    if (!this.tamed) return null;
    this.sitting = !this.sitting;
    if (this.sitting) {
      this.getNavigation().stop();
      this.setTarget(null);
    }
    return 'toggle';
  }
}

/** Source: net.minecraft.world.entity.animal.Ocelot. */
export class Ocelot extends Cat {
  constructor(level: ClientLevel) {
    super(level, entityType('ocelot'));
  }
}
