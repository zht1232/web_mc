// Source: net.minecraft.world.entity.monster.Witch
//
// Vanilla witches throw splash potions. The port has no potion entity, so the
// witch is wired to the skeleton's ranged attack and fires an Arrow as a stand
// in "magic bolt" (documented simplification; damage matches a harming splash
// potion on normal difficulty).

import { Monster } from './Monster.js';
import { RangedBowAttackGoal } from '../ai/goal/RangedBowAttackGoal.js';
import { Arrow } from '../projectile/Arrow.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { Targetable } from '../Entity.js';

export class Witch extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('witch'), level);
    this.speed = 0.25;
    this.maxHealth = 26; this.health = 26;
    this.attackDamage = 3;
  }

  protected getTargetRange(): number { return 16; }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new RangedBowAttackGoal(this, 1.0));
  }

  rangedAttack(target: Targetable): void {
    const world = this.getWorld();
    if (!world) return;
    const bolt = new Arrow(this.level, this.x, this.getEyeY() - 0.1, this.z);
    bolt.owner = this;
    bolt.damage = 3;
    const dx = target.getX() - this.x;
    const dy = (target.getY() + target.getHeight() * 0.5) - bolt.y;
    const dz = target.getZ() - this.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    bolt.shoot(dx / len * 1.2, dy / len * 1.2 + 0.05, dz / len * 1.2);
    world.spawnEntity(bolt);
  }
}
