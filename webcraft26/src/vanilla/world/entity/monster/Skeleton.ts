// Source: net.minecraft.world.entity.monster.skeleton.Skeleton
//
// Ranged attacker: RangedBowAttackGoal drives the strafing, while
// rangedAttack() spawns an Arrow toward the target. The constructor takes an
// explicit EntityType so variant subclasses (Stray, Bogged) share the AI.

import { Monster } from './Monster.js';
import { RangedBowAttackGoal } from '../ai/goal/RangedBowAttackGoal.js';
import { Arrow } from '../projectile/Arrow.js';
import { EquipmentSlot } from '../EquipmentSlot.js';
import { entityType } from '../EntityType.js';
import type { EntityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { Targetable } from '../Entity.js';

export class Skeleton extends Monster {
  constructor(level: ClientLevel, type: EntityType = entityType('skeleton')) {
    super(type, level);
    this.speed = 0.25;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 2;
    // SkeletonRenderer's bow layer is chosen from the actual main-hand equipment.
    this.setItemSlot(EquipmentSlot.MAINHAND, { id: 'minecraft:bow', count: 1 });
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new RangedBowAttackGoal(this, 1.0));
  }

  override finalizeSpawn(): void {
    // WitherSkeleton.populateDefaultEquipmentSlots: stone sword only, no armor.
    if (this.getTypeName() === 'wither_skeleton') return;
    // AbstractSkeleton.populateDefaultEquipmentSlots: base 15% armor + bow.
    this.equipRandomArmor();
    this.equipMainHand('bow');
  }

  rangedAttack(target: Targetable): void {
    const world = this.getWorld();
    if (!world) return;
    const arrow = new Arrow(this.level, this.x, this.getEyeY() - 0.1, this.z);
    arrow.owner = this;
    const dx = target.getX() - this.x;
    const dy = (target.getY() + target.getHeight() * 0.5) - arrow.y;
    const dz = target.getZ() - this.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const s = 1.6;
    arrow.shoot((dx / len) * s, (dy / len) * s + 0.05, (dz / len) * s);
    world.spawnEntity(arrow);
  }
}
