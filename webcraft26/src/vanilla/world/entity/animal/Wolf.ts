// Source: net.minecraft.world.entity.animal.Wolf
//
// Tameable neutral wolf: bones tame it (1/3), an empty click toggles sitting,
// tamed wolves follow the player and stop treating the player as a target.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { TemptGoal } from '../ai/goal/TemptGoal.js';
import { NearestAttackableTargetGoal } from '../ai/goal/NearestAttackableTargetGoal.js';
import { HurtByTargetGoal } from '../ai/goal/HurtByTargetGoal.js';
import { FollowOwnerGoal } from '../ai/goal/FollowOwnerGoal.js';
import { entityType } from '../EntityType.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Wolf extends Mob {
  private readonly playerTargetGoal =
    new NearestAttackableTargetGoal(this, 16, this.playerPredicate);

  constructor(level: ClientLevel) {
    super(entityType('wolf'), level);
    this.speed = 0.3;
    this.maxHealth = 8; this.health = 8;
    this.attackDamage = 4;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new MeleeAttackGoal(this, 1.0));
    this.goalSelector.addGoal(2, new FollowOwnerGoal(this, 1.0));
    // ItemTags.WOLF_FOOD (untamed wolves follow meat).
    this.goalSelector.addGoal(3, new TemptGoal(this, 1.0, [
      'beef', 'chicken', 'mutton', 'porkchop', 'rabbit', 'cod', 'salmon', 'rotten_flesh',
      'cooked_beef', 'cooked_chicken', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit',
      'cooked_cod', 'cooked_salmon',
    ]));
    this.goalSelector.addGoal(4, new RandomStrollGoal(this, 0.8));
    this.goalSelector.addGoal(5, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(6, new RandomLookAroundGoal(this));
    this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
    this.targetSelector.addGoal(2, this.playerTargetGoal);
  }

  /** Tamed wolves no longer hunt the player. */
  protected onTamed(): void {
    this.targetSelector.removeGoal(this.playerTargetGoal);
  }

  /**
   * Wolf.mobInteract: bone (1/3) tames an untamed wolf; once tamed an empty or
   * non-food click toggles sitting.
   */
  interact(stack: ItemStack): 'tame' | 'fail' | 'toggle' | null {
    const name = stack.item?.name ?? '';
    if (name === 'bone') {
      if (this.tamed) return null;
      if (this.random.nextInt(3) === 0) {
        this.tamed = true;
        this.sitting = false;
        this.owner = 'player';
        this.onTamed();
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
