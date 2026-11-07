// Source: net.minecraft.world.entity.monster.Creeper
//
// Approaches the player and inflates (CreeperSwellGoal). explode() damages
// nearby entities (no knockback) and removes the creeper.

import { Monster } from './Monster.js';
import { CreeperSwellGoal } from '../ai/goal/CreeperSwellGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class Creeper extends Monster {
  constructor(level: ClientLevel) {
    super(entityType('creeper'), level);
    this.speed = 0.25;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 0;
  }

  protected getTargetRange(): number { return 6; }

  protected registerAttackGoals(): void {
    this.goalSelector.addGoal(2, new CreeperSwellGoal(this));
  }

  explode(): void {
    const world = this.getWorld();
    if (world) {
      const power = this.powered ? 6 : 3;
      const ents = world.getEntities();
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (e === this || !e.isAlive()) continue;
        if (this.distanceToSqr(e.x, e.y, e.z) < 9) e.hurt(power, null);
      }
    }
    this.remove();
  }
}
