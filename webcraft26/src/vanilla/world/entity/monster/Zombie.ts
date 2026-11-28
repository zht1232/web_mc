// Source: net.minecraft.world.entity.monster.Zombie
//
// The constructor takes an explicit EntityType so variant subclasses (Drowned,
// Husk, ZombieVillager) share the AI without duplicating it.

import { Monster } from './Monster.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { entityType } from '../EntityType.js';
import type { EntityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Zombie extends Monster {
  constructor(level: ClientLevel, type: EntityType = entityType('zombie')) {
    super(type, level);
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 3;
  }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0));
  }

  override finalizeSpawn(): void {
    const type = this.getTypeName();
    if (type === 'zombie' || type === 'husk') {
      // Mob.populateDefaultEquipmentSlots (15% armor) + Zombie's 1% weapon roll.
      this.equipRandomArmor();
      const r = this.getRandom();
      if (r.nextFloat() < 0.01) {
        const pick = r.nextInt(6);
        this.equipMainHand(pick === 0 ? 'iron_sword' : pick === 1 ? 'iron_spear' : 'iron_shovel');
      }
    }
  }
}
