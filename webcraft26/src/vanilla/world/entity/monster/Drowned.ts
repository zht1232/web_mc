// Source: net.minecraft.world.entity.monster.zombie.Drowned
//
// Water variant of the zombie. The port keeps the zombie's melee AI and only
// overrides the attributes / spawn placement (registered in SpawnPlacements.ts).

import { Zombie } from './Zombie.js';
import { EquipmentSlot } from '../EquipmentSlot.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Drowned extends Zombie {
  constructor(level: ClientLevel) {
    super(level, entityType('drowned'));
    this.speed = 0.23;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 3;
  }

  /** Drowned.populateDefaultEquipmentSlots + finalizeSpawn's nautilus-shell roll. */
  override finalizeSpawn(): void {
    this.equipRandomArmor();
    const r = this.getRandom();
    if (r.nextFloat() > 0.9) {
      this.equipMainHand(r.nextInt(16) < 10 ? 'trident' : 'fishing_rod');
    }
    if (!this.getItemBySlot(EquipmentSlot.OFFHAND) && r.nextFloat() < 0.03) {
      this.setItemSlot(EquipmentSlot.OFFHAND, { id: 'minecraft:nautilus_shell', count: 1 });
    }
  }
}
