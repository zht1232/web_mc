// Source: net.minecraft.world.entity.player.Player (AI-facing proxy)
//
// In vanilla Player extends LivingEntity. Here player/Player.ts is a standalone
// physics class, so this thin LivingEntity wrapper exposes the player to the
// entity AI (targeting / damage) without duplicating the player simulation.

import { LivingEntity } from './LivingEntity.js';
import { entityType } from './EntityType.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { Player } from './player/Player.js';
import type { Targetable } from './Entity.js';

export class PlayerTarget extends LivingEntity {
  constructor(level: ClientLevel, private readonly player: Player | null) {
    super(entityType('player'), level);
    this.maxHealth = 20;
    this.health = 20;
    this.speed = 0.2159;
    this.syncFromPlayer();
  }

  syncFromPlayer(): void {
    const p = this.player;
    if (!p) return;
    this.x = p.pos.x; this.y = p.pos.y; this.z = p.pos.z;
    this.yaw = p.yaw; this.pitch = p.pitch;
    this.onGround = p.onGround;
  }

  /** No physics/AI: the human player is simulated by Game.ts. */
  tick(): void {
    this.baseTick();
    this.syncFromPlayer();
  }

  /** Damage to the human player is applied by the main game, not by mob AI. */
  hurt(_amount: number, _attacker: Targetable | null): void {}
}
