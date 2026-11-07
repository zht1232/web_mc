// Source: net.minecraft.world.entity.monster.Creeper
//
// Approaches the player and inflates (CreeperSwellGoal). explode() follows
// Explosion: the world's explosion hook damages entities and breaks blocks
// (implemented by EntityManager + Game); without a hook it falls back to a
// radius-only entity damage so headless tests still behave.

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
    const power = this.powered ? 6 : 3;
    if (world) {
      if (world.explode) {
        world.explode(this.x, this.y + 0.5, this.z, power);
      } else {
        // Fallback (no Game attached): entity damage only inside power blocks.
        const ents = world.getEntities();
        const r2 = power * power;
        for (let i = 0; i < ents.length; i++) {
          const e = ents[i];
          if (e === this || !e.isAlive()) continue;
          if (this.distanceToSqr(e.x, e.y, e.z) < r2) e.hurt(power, null);
        }
      }
    }
    this.remove();
  }
}
