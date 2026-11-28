// Source: net.minecraft.world.entity.animal.equine.Llama (26.2)
//
// Chested-horse relative reduced to the parts this port needs: four coat
// variants, the llama wander/panic AI and the 30-health body. Chests, taming,
// breeding, caravans and the llama-spit projectile are not ported yet; the
// trader variant in TraderLlama adds the caravan-follow behaviour.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { PanicGoal } from '../ai/goal/PanicGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

/** Llama.Variant ids: creamy, white, brown, gray. */
export const LLAMA_VARIANTS = ['creamy', 'white', 'brown', 'gray'] as const;

export class Llama extends Mob {
  /** Llama.Variant id (0 creamy, 1 white, 2 brown, 3 gray). */
  variant = 0;

  constructor(level: ClientLevel, typeName = 'llama') {
    super(entityType(typeName), level);
    this.speed = 0.225;
    this.maxHealth = 30;
    this.health = 30;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(3, new PanicGoal(this, 1.2));
    this.goalSelector.addGoal(7, new RandomStrollGoal(this, 0.7));
    this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, 6));
    this.goalSelector.addGoal(9, new RandomLookAroundGoal(this));
  }

  /** Llama.finalizeSpawn: a random coat variant (the port has no group data). */
  override finalizeSpawn(): void {
    super.finalizeSpawn();
    this.variant = this.random.nextInt(LLAMA_VARIANTS.length);
  }

  isTraderLlama(): boolean { return false; }
}
