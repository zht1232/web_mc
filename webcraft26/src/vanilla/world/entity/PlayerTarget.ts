// Source: net.minecraft.world.entity.player.Player (AI-facing proxy)
//
// In vanilla Player extends LivingEntity. Here player/Player.ts is a standalone
// physics class, so this thin LivingEntity wrapper exposes the player to the
// entity AI (targeting / damage) without duplicating the player simulation.
//
// Damage landed on the proxy is forwarded through `onHurt` to the main game,
// which applies it to SurvivalState (armor / hunger / death handling live there).

import { LivingEntity } from './LivingEntity.js';
import { entityType } from './EntityType.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { Player } from './player/Player.js';
import type { Targetable } from './Entity.js';

export class PlayerTarget extends LivingEntity {
  /** Set by Game: forwards mob/arrow damage to SurvivalState.damage(). */
  onHurt?: (amount: number, attacker: Targetable | null) => void;

  constructor(level: ClientLevel, private player: Player | null) {
    super(entityType('player'), level);
    this.maxHealth = 20;
    this.health = 20;
    this.speed = 0.2159;
    this.syncFromPlayer();
  }

  /** Rebinds the proxy after Game.respawnPlayer() created a new Player instance. */
  setPlayer(player: Player | null): void {
    this.player = player;
    this.removed = false;
    this.dead = false;
    this.health = this.maxHealth;
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
  hurt(amount: number, attacker: Targetable | null): void {
    if (amount <= 0 || !this.player) return;
    if (this.onHurt) this.onHurt(amount, attacker);
  }
}
