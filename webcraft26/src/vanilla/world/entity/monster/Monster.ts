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
import { EquipmentSlot } from '../EquipmentSlot.js';

export class Monster extends Mob {
  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.registerAttackGoals();
    this.goalSelector.addGoal(5, new RandomStrollGoal(this, 0.8));
    this.goalSelector.addGoal(6, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(7, new RandomLookAroundGoal(this));
    this.registerTargetGoals();
  }

  /** Hostile monsters acquire the player; neutral variants override this (ZombifiedPiglin). */
  protected registerTargetGoals(): void {
    this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
    this.targetSelector.addGoal(2, new NearestAttackableTargetGoal(this, this.getTargetRange(), this.playerPredicate));
  }

  /** Override to change the target acquisition distance. */
  protected getTargetRange(): number { return 16; }

  /**
   * Simplified Zombie/Skeleton.populateDefaultEquipmentSlots for the fixed normal
   * difficulty: one material roll (leather/chainmail/iron), then a 50% roll per slot.
   */
  protected equipRandomArmor(chance: number): void {
    const r = this.getRandom();
    if (r.nextFloat() >= chance) return;
    const roll = r.nextFloat();
    const material = roll < 0.5 ? 'leather' : roll < 0.8 ? 'chainmail' : 'iron';
    if (r.nextFloat() < 0.5) this.setItemSlot(EquipmentSlot.HEAD, { id: `minecraft:${material}_helmet`, count: 1 });
    if (r.nextFloat() < 0.5) this.setItemSlot(EquipmentSlot.CHEST, { id: `minecraft:${material}_chestplate`, count: 1 });
    if (r.nextFloat() < 0.5) this.setItemSlot(EquipmentSlot.LEGS, { id: `minecraft:${material}_leggings`, count: 1 });
    if (r.nextFloat() < 0.5) this.setItemSlot(EquipmentSlot.FEET, { id: `minecraft:${material}_boots`, count: 1 });
  }

  protected registerAttackGoals(): void {}
}
