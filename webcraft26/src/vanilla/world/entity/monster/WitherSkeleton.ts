// Source: net.minecraft.world.entity.monster.skeleton.WitherSkeleton
//
// Nether skeleton variant: melee attacker with a stone sword instead of the
// skeleton's bow. Uses the shared SkeletonModel skeleton and texture.

import { Skeleton } from './Skeleton.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { EquipmentSlot } from '../EquipmentSlot.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class WitherSkeleton extends Skeleton {
  constructor(level: ClientLevel) {
    super(level, entityType('wither_skeleton'));
    this.speed = 0.25;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 7;
    // Skeleton's constructor equips a bow; the wither skeleton wields a sword.
    this.setItemSlot(EquipmentSlot.MAINHAND, { id: 'minecraft:stone_sword', count: 1 });
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }
}
