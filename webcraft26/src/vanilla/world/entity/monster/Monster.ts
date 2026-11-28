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

/** Mob.getEquipmentForSlot material ladder (0 leather .. 5 diamond, 26.2 adds copper). */
const ARMOR_MATERIALS = ['leather', 'copper', 'golden', 'chainmail', 'iron', 'diamond'] as const;
const ARMOR_PIECES: Readonly<Record<number, readonly [string, string]>> = {
  [EquipmentSlot.HEAD.index]: ['helmet', 'helmet'],
  [EquipmentSlot.CHEST.index]: ['chestplate', 'chestplate'],
  [EquipmentSlot.LEGS.index]: ['leggings', 'leggings'],
  [EquipmentSlot.FEET.index]: ['boots', 'boots'],
};
const ARMOR_SLOTS = [EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET];

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
   * Mob.populateDefaultEquipmentSlots for normal difficulty (special multiplier 1.0):
   * 15% armor roll, one material from the six-step ladder, then the head slot plus
   * each lower slot, stopping with 25% chance (EQUIPMENT_POPULATION_ORDER).
   */
  protected equipRandomArmor(): void {
    const r = this.getRandom();
    if (r.nextFloat() >= 0.15) return;
    let materialType = r.nextInt(3);
    for (let i = 0; i < 3; i++) {
      if (r.nextFloat() < 0.1087) materialType++;
    }
    const material = ARMOR_MATERIALS[Math.min(ARMOR_MATERIALS.length - 1, materialType)];
    let first = true;
    for (const slot of ARMOR_SLOTS) {
      if (!first && r.nextFloat() < 0.25) break;
      first = false;
      if (this.getItemBySlot(slot)) continue;
      const piece = ARMOR_PIECES[slot.index]?.[0];
      if (piece) this.setItemSlot(slot, { id: `minecraft:${material}_${piece}`, count: 1 });
    }
  }

  /** Equips a main-hand item (Zombie weapons, Drowned tridents, piglin swords). */
  protected equipMainHand(item: string): void {
    this.setItemSlot(EquipmentSlot.MAINHAND, { id: `minecraft:${item}`, count: 1 });
  }

  protected registerAttackGoals(): void {}
}
