// Source: net.minecraft.world.entity.npc.wanderingtrader.WanderingTraderSpawner (26.2)
//
// Every 1200 ticks the spawn delay drops by 1200; once it reaches zero the
// attempt chance grows by 25 (clamped 25..75) and a 1-in-10 roll tries to place
// a wandering trader (plus two trader llamas) near the village bell within 48
// blocks of the player. The saved WanderingTraderData of the vanilla server is
// session state here.

import { WanderingTrader } from './WanderingTrader.js';
import { TraderLlama } from '../animal/TraderLlama.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { Entity, Targetable } from '../Entity.js';
import type { RandomSource } from '../../../core/Random.js';

/** WanderingTraderSpawner.DEFAULT_TICK_DELAY / DEFAULT_SPAWN_DELAY / MIN_SPAWN_CHANCE. */
const TICK_DELAY = 1200;
const SPAWN_DELAY = 24000;
const MIN_SPAWN_CHANCE = 25;
const MAX_SPAWN_CHANCE = 75;
const SPAWN_CHANCE_INCREASE = 25;
const SPAWN_ONE_IN_X_CHANCE = 10;
const SPAWN_RADIUS = 48;
const SPAWN_ATTEMPTS = 10;
const LLAMA_RADIUS = 4;
const TRADER_DESPAWN_DELAY = 48000;

export interface WanderingTraderHost {
  readonly level: ClientLevel;
  readonly random: RandomSource;
  getPlayer(): Targetable | null;
  /** Queue a constructed entity (EntityManager.spawnEntity). */
  spawn(e: Entity): void;
}

export class WanderingTraderSpawner {
  private tickDelay = TICK_DELAY;
  private spawnDelay = SPAWN_DELAY;
  private spawnChance = MIN_SPAWN_CHANCE;

  constructor(private readonly host: WanderingTraderHost) {}

  /** CustomSpawner.tick, called once per game tick. */
  tick(): void {
    if (--this.tickDelay > 0) return;
    this.tickDelay = TICK_DELAY;
    this.spawnDelay -= TICK_DELAY;
    if (this.spawnDelay > 0) return;
    this.spawnDelay = SPAWN_DELAY;
    const chance = this.spawnChance;
    this.spawnChance = Math.min(MAX_SPAWN_CHANCE, chance + SPAWN_CHANCE_INCREASE);
    if (this.host.random.nextInt(100) <= chance && this.attemptSpawn()) {
      this.spawnChance = MIN_SPAWN_CHANCE;
    }
  }

  /**
   * WanderingTraderSpawner.spawn: 1-in-10 attempt, meeting point = nearest bell
   * within 48 blocks or the player, then a free spot within 48 of that point.
   * Returns true when a trader was spawned (or when no player exists).
   */
  attemptSpawn(): boolean {
    const player = this.host.getPlayer();
    if (!player) return true;
    const random = this.host.random;
    if (random.nextInt(SPAWN_ONE_IN_X_CHANCE) !== 0) return false;
    const level = this.host.level;
    const px = Math.floor(player.getX());
    const py = Math.floor(player.getY());
    const pz = Math.floor(player.getZ());
    const bell = this.findMeetingPoint(px, py, pz, SPAWN_RADIUS);
    const ref = bell ?? { x: px, y: py, z: pz };
    const spot = this.findSpawnPositionNear(ref.x, ref.z, SPAWN_RADIUS);
    if (!spot || !this.hasEnoughSpace(spot.x, spot.y, spot.z)) return false;

    const trader = new WanderingTrader(level);
    trader.setPos(spot.x + 0.5, spot.y, spot.z + 0.5);
    trader.xo = trader.x; trader.yo = trader.y; trader.zo = trader.z;
    trader.setDespawnDelay(TRADER_DESPAWN_DELAY);
    trader.wanderTarget = ref;
    this.host.spawn(trader);
    for (let i = 0; i < 2; i++) this.trySpawnLlama(trader);
    return true;
  }

  /** tryToSpawnLlamaFor: a trader llama within 4 blocks, linked to the trader. */
  private trySpawnLlama(trader: WanderingTrader): void {
    const spot = this.findSpawnPositionNear(
      Math.floor(trader.x), Math.floor(trader.z), LLAMA_RADIUS,
    );
    if (!spot) return;
    const llama = new TraderLlama(this.host.level);
    llama.finalizeSpawn();
    llama.setPos(spot.x + 0.5, spot.y, spot.z + 0.5);
    llama.xo = llama.x; llama.yo = llama.y; llama.zo = llama.z;
    llama.trader = trader;
    this.host.spawn(llama);
  }

  /** SpawnPlacements.ON_GROUND at a random column within `radius` of the reference. */
  private findSpawnPositionNear(refX: number, refZ: number, radius: number): { x: number; y: number; z: number } | null {
    const level = this.host.level;
    const random = this.host.random;
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const x = refX + random.nextInt(radius * 2 + 1) - radius;
      const z = refZ + random.nextInt(radius * 2 + 1) - radius;
      const y = level.getHeight(x, z) + 1;
      if (y <= level.minY || y >= level.minY + level.height) continue;
      if (level.getBlockState(x, y - 1, z) === 0) continue; // needs ground
      if (level.getBlockState(x, y, z) !== 0) continue; // feet must be air
      return { x, y, z };
    }
    return null;
  }

  /** hasEnoughSpace: the 2x3x2 box above the spawn position is collision-free. */
  private hasEnoughSpace(x: number, y: number, z: number): boolean {
    const level = this.host.level;
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 2; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const state = level.getBlockState(x + dx, y + dy, z + dz);
          if (state !== 0 && level.mc.collision(state).length > 0) return false;
        }
      }
    }
    return true;
  }

  /** PoiTypes.MEETING: nearest bell block within `radius` (vanilla POI manager). */
  private findMeetingPoint(x: number, y: number, z: number, radius: number): { x: number; y: number; z: number } | null {
    const level = this.host.level;
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = radius * radius;
    for (let dy = -8; dy <= 8; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const state = level.getBlockState(x + dx, y + dy, z + dz);
          if (state === 0 || level.mc.blockOf(state).name !== 'bell') continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; best = { x: x + dx, y: y + dy, z: z + dz }; }
        }
      }
    }
    return best;
  }
}
