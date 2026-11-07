// Source: net.minecraft.world.entity.SpawnPlacements (26.2)
//         net.minecraft.world.entity.SpawnPlacementTypes
//         net.minecraft.world.entity.Mob.checkMobSpawnRules / checkSpawnRules
//         net.minecraft.world.entity.Monster.checkMonsterSpawnRules / isDarkEnoughToSpawn
//         net.minecraft.world.entity.animal.Animal.checkAnimalSpawnRules
//         net.minecraft.world.entity.ambient.Bat.checkBatSpawnRules
//         net.minecraft.world.entity.monster.zombie.Drowned.checkDrownedSpawnRules
//         net.minecraft.world.entity.animal.fish.WaterAnimal.checkSurfaceWaterAnimalSpawnRules
//         net.minecraft.world.entity.monster.cubemob.Slime.checkSlimeSpawnRules (simplified)
//         data/minecraft/dimension_type/overworld.json (monster_spawn_light_level 0..7,
//           monster_spawn_block_light_limit 0)
//
// The placement table below mirrors the static block at the bottom of
// SpawnPlacements.java for every entity type this port registers a factory for.
// Types that are not implemented in the port are skipped by the natural spawner
// and never reach this module.

import type { ClientLevel } from '../level/ClientLevel.js';
import type { EntityType } from './EntityType.js';
import type { RandomSource } from '../../core/Random.js';

export enum SpawnPlacementType {
  ON_GROUND = 'ON_GROUND',
  IN_WATER = 'IN_WATER',
  IN_LAVA = 'IN_LAVA',
  NO_RESTRICTIONS = 'NO_RESTRICTIONS',
}

/** Vanilla SpawnPlacements.SpawnPredicate, keyed by the static registrations. */
export type SpawnRuleName =
  | 'monster'            // Monster::checkMonsterSpawnRules
  | 'any_light_monster'  // Monster::checkAnyLightMonsterSpawnRules
  | 'animal'             // Animal::checkAnimalSpawnRules
  | 'bat'                // Bat::checkBatSpawnRules
  | 'water_animal'       // WaterAnimal::checkSurfaceWaterAnimalSpawnRules
  | 'drowned'            // Drowned::checkDrownedSpawnRules
  | 'slime'              // Slime::checkSlimeSpawnRules (simplified)
  | 'mob';               // Mob::checkMobSpawnRules only

interface Placement {
  type: SpawnPlacementType;
  rule: SpawnRuleName | null;
}

const ON_GROUND_MONSTER: Placement = { type: SpawnPlacementType.ON_GROUND, rule: 'monster' };
const ON_GROUND_ANIMAL: Placement = { type: SpawnPlacementType.ON_GROUND, rule: 'animal' };
const ON_GROUND_MOB: Placement = { type: SpawnPlacementType.ON_GROUND, rule: 'mob' };
const ON_GROUND_ANY: Placement = { type: SpawnPlacementType.NO_RESTRICTIONS, rule: null };

/** Table from SpawnPlacements.<clinit> for the types EntityFactory can create. */
const REGISTRY: Record<string, Placement> = {
  // ---- monsters (Monster::checkMonsterSpawnRules) ----
  zombie: ON_GROUND_MONSTER,
  zombie_villager: ON_GROUND_MONSTER,
  skeleton: ON_GROUND_MONSTER,
  creeper: ON_GROUND_MONSTER,
  spider: ON_GROUND_MONSTER,
  enderman: ON_GROUND_MONSTER,
  witch: ON_GROUND_MONSTER,
  silverfish: ON_GROUND_MONSTER,
  // Monster::checkSurfaceMonstersSpawnRules adds canSeeSky; the nether-only
  // monsters above are unreachable in the overworld, so surface variants are
  // not needed for the overworld-only client.
  husk: ON_GROUND_MONSTER,
  stray: ON_GROUND_MONSTER,
  cave_spider: ON_GROUND_MONSTER,
  bogged: ON_GROUND_MONSTER,
  // ---- water monster ----
  drowned: { type: SpawnPlacementType.IN_WATER, rule: 'drowned' },
  // ---- cubemob ----
  slime: { type: SpawnPlacementType.ON_GROUND, rule: 'slime' },
  // ---- animals (Animal::checkAnimalSpawnRules) ----
  pig: ON_GROUND_ANIMAL,
  cow: ON_GROUND_ANIMAL,
  sheep: ON_GROUND_ANIMAL,
  chicken: ON_GROUND_ANIMAL,
  rabbit: ON_GROUND_ANIMAL,
  wolf: ON_GROUND_ANIMAL,
  fox: ON_GROUND_ANIMAL,
  cat: ON_GROUND_ANIMAL,
  ocelot: ON_GROUND_ANIMAL,
  parrot: ON_GROUND_ANIMAL,
  // ---- ambient ----
  bat: { type: SpawnPlacementType.ON_GROUND, rule: 'bat' },
  // ---- water creatures (WaterAnimal::checkSurfaceWaterAnimalSpawnRules) ----
  squid: { type: SpawnPlacementType.IN_WATER, rule: 'water_animal' },
  glow_squid: { type: SpawnPlacementType.IN_WATER, rule: 'water_animal' },
  cod: { type: SpawnPlacementType.IN_WATER, rule: 'water_animal' },
  salmon: { type: SpawnPlacementType.IN_WATER, rule: 'water_animal' },
  // ---- non-mob entities ----
  item: ON_GROUND_ANY,
  experience_orb: ON_GROUND_ANY,
  arrow: ON_GROUND_ANY,
};

const DEFAULT_PLACEMENT: Placement = ON_GROUND_MOB;

// ---------------------------------------------------------------------------
// Block tags (loaded from public/mc/tags.json by the client)
// ---------------------------------------------------------------------------

export interface SpawnBlockTags {
  block?: Record<string, string[]>;
}

let BLOCK_TAGS: Record<string, string[]> = {};

/** Injects the vanilla block-tag table so the spawnable_on tags are exact. */
export function setSpawnBlockTags(tags: unknown): void {
  const t = tags as SpawnBlockTags | null | undefined;
  BLOCK_TAGS = (t && typeof t === 'object' && t.block) ? t.block : {};
}

/** Hard-coded fallbacks (same contents as the 26.2 datapack tags). */
const FALLBACK: Record<string, string[]> = {
  'minecraft:animals_spawnable_on': ['minecraft:grass_block'],
  'minecraft:bats_spawnable_on': [
    'minecraft:stone', 'minecraft:granite', 'minecraft:diorite', 'minecraft:andesite',
    'minecraft:tuff', 'minecraft:deepslate',
  ],
  'minecraft:foxes_spawnable_on': [
    'minecraft:grass_block', 'minecraft:snow', 'minecraft:snow_block',
    'minecraft:podzol', 'minecraft:coarse_dirt',
  ],
  'minecraft:rabbits_spawnable_on': [
    'minecraft:grass_block', 'minecraft:snow', 'minecraft:snow_block', 'minecraft:sand',
  ],
  'minecraft:wolves_spawnable_on': [
    'minecraft:grass_block', 'minecraft:snow', 'minecraft:snow_block',
    'minecraft:coarse_dirt', 'minecraft:podzol',
  ],
  'minecraft:parrots_spawnable_on': ['minecraft:grass_block'],
  'minecraft:invalid_spawn_inside': ['minecraft:end_portal', 'minecraft:end_gateway'],
};

function tagContains(tag: string, blockName: string): boolean {
  const list = BLOCK_TAGS[tag] ?? FALLBACK[tag];
  if (!list) return false;
  return list.indexOf(blockName) >= 0;
}

// ---------------------------------------------------------------------------
// Block / fluid helpers
// ---------------------------------------------------------------------------

/** Vanilla FluidTags.WATER (water, flowing_water, bubble_column, seagrass...). */
function isWater(level: ClientLevel, x: number, y: number, z: number): boolean {
  const state = level.getBlockState(x, y, z);
  if (state === 0) return false;
  const mc = level.mc;
  if (!mc.isLiquid(state)) return false;
  return mc.blockOf(state).name.indexOf('lava') < 0;
}

/** Vanilla NaturalSpawner.isValidEmptySpawnBlock (drops signal-source / danger checks). */
function isValidEmptySpawnBlock(level: ClientLevel, x: number, y: number, z: number): boolean {
  const mc = level.mc;
  const state = level.getBlockState(x, y, z);
  if (state === 0) return true;
  if (mc.isLiquid(state)) return false;
  const shape = mc.collision(state);
  if (shape.length === 1) {
    const b = shape[0];
    if (b.minX === 0 && b.minY === 0 && b.minZ === 0 && b.maxX === 1 && b.maxY === 1 && b.maxZ === 1) return false;
  }
  const name = mc.blockOf(state).name;
  if (tagContains('minecraft:invalid_spawn_inside', `minecraft:${name}`)) return false;
  return true;
}

/** BlockProperties default isValidSpawn: faceSturdy(UP) && lightEmission < 14. */
function isValidSpawnBlock(level: ClientLevel, x: number, y: number, z: number): boolean {
  const state = level.getBlockState(x, y, z);
  if (state === 0) return false;
  const mc = level.mc;
  if (!mc.isFaceSturdy(state, 1)) return false; // Direction.UP
  return mc.lightOf(state) < 14;
}

/** SpawnPlacementTypes.ON_GROUND.isSpawnPositionOk. */
function isOnGroundPositionOk(level: ClientLevel, x: number, y: number, z: number): boolean {
  if (!isValidSpawnBlock(level, x, y - 1, z)) return false;
  return isValidEmptySpawnBlock(level, x, y, z) && isValidEmptySpawnBlock(level, x, y + 1, z);
}

/** SpawnPlacements.isSpawnPositionOk (placement only, no predicates). */
export function isSpawnPositionOk(type: EntityType, level: ClientLevel, x: number, y: number, z: number): boolean {
  const p = REGISTRY[type.name] ?? DEFAULT_PLACEMENT;
  switch (p.type) {
    case SpawnPlacementType.NO_RESTRICTIONS:
      return true;
    case SpawnPlacementType.IN_WATER:
      // Fluid at pos is water and the block above is not a redstone conductor.
      return isWater(level, x, y, z) && !isRedstoneConductor(level, x, y + 1, z);
    case SpawnPlacementType.IN_LAVA: {
      const state = level.getBlockState(x, y, z);
      return state !== 0 && level.mc.blockOf(state).name.indexOf('lava') >= 0;
    }
    case SpawnPlacementType.ON_GROUND:
    default:
      return isOnGroundPositionOk(level, x, y, z);
  }
}

function isRedstoneConductor(level: ClientLevel, x: number, y: number, z: number): boolean {
  const state = level.getBlockState(x, y, z);
  if (state === 0) return false;
  return level.mc.collision(state).length > 0;
}

// ---------------------------------------------------------------------------
// Spawn predicates (vanilla static rule methods)
// ---------------------------------------------------------------------------

/** Monster.isDarkEnoughToSpawn (overworld: light test 0..7, block-light limit 0). */
export function isDarkEnoughToSpawn(level: ClientLevel, x: number, y: number, z: number, random: RandomSource): boolean {
  if (level.getSkyLight(x, y, z) > random.nextInt(32)) return false;
  if (level.mc.lightOf(level.getBlockState(x, y, z)) > 0) return false;
  if (level.getBlockLight(x, y, z) > 0) return false; // monster_spawn_block_light_limit = 0
  let brightness = level.getBrightness(x, y, z);
  if (level.isThundering()) brightness = Math.max(0, brightness - 10);
  // IntProvider UniformInt(0, 7).sample(random) == nextInt(8)
  return brightness <= random.nextInt(8);
}

function checkMonsterRules(level: ClientLevel, x: number, y: number, z: number, random: RandomSource): boolean {
  return isDarkEnoughToSpawn(level, x, y, z, random);
}

function checkAnimalRules(level: ClientLevel, x: number, y: number, z: number, _random: RandomSource): boolean {
  const below = level.getBlockState(x, y - 1, z);
  const belowName = below === 0 ? 'minecraft:air' : `minecraft:${level.mc.blockOf(below).name}`;
  if (!tagContains('minecraft:animals_spawnable_on', belowName)) return false;
  // Animal.isBrightEnoughToSpawn: getRawBrightness(pos, 0) > 8, i.e. the raw skylight
  // (no darkening subtraction) at the spawn position.
  return level.getSkyLight(x, y, z) > 8;
}

function checkBatRules(level: ClientLevel, x: number, y: number, z: number, random: RandomSource): boolean {
  if (y >= level.getHeight(x, z)) return false; // below the WORLD_SURFACE heightmap
  if (random.nextBoolean()) return false;
  if (level.getBrightness(x, y, z) > random.nextInt(4)) return false;
  const below = level.getBlockState(x, y - 1, z);
  const belowName = below === 0 ? 'minecraft:air' : `minecraft:${level.mc.blockOf(below).name}`;
  return tagContains('minecraft:bats_spawnable_on', belowName);
}

function checkWaterAnimalRules(level: ClientLevel, x: number, y: number, z: number): boolean {
  const seaLevel = level.seaLevel;
  if (y < seaLevel - 13 || y > seaLevel) return false;
  if (!isWater(level, x, y - 1, z)) return false;
  const above = level.getBlockState(x, y + 1, z);
  if (above === 0) return false;
  return level.mc.blockOf(above).name === 'water';
}

function checkDrownedRules(level: ClientLevel, x: number, y: number, z: number, random: RandomSource): boolean {
  if (!isWater(level, x, y - 1, z)) return false;
  const canMonsterSpawn = isDarkEnoughToSpawn(level, x, y, z, random) && isWater(level, x, y, z);
  if (!canMonsterSpawn) return false;
  // Vanilla: 1/40 chance (1/15 in MORE_FREQUENT_DROWNED_SPAWNS biomes).
  return random.nextInt(40) === 0;
}

function checkSlimeRules(level: ClientLevel, x: number, y: number, z: number, random: RandomSource): boolean {
  // Vanilla: surface slimes in swamp-like biomes (y 50..70) or slime chunks below y 40.
  // The slime-chunk seed search is not ported; the surface branch is exact.
  if (y > 50 && y < 70) {
    if (random.nextFloat() < 0.1 && level.getBrightness(x, y, z) <= random.nextInt(8)) return true;
  }
  if (y < 40) return random.nextInt(10) === 0;
  return false;
}

/** SpawnPlacements.checkSpawnRules (26.2): runs the registered predicate for the type. */
export function checkSpawnRules(
  type: EntityType,
  level: ClientLevel,
  x: number,
  y: number,
  z: number,
  random: RandomSource,
): boolean {
  const p = REGISTRY[type.name] ?? DEFAULT_PLACEMENT;
  if (!p.rule) return true;
  switch (p.rule) {
    case 'monster': return checkMonsterRules(level, x, y, z, random);
    case 'any_light_monster': return true;
    case 'animal': return checkAnimalRules(level, x, y, z, random);
    case 'bat': return checkBatRules(level, x, y, z, random);
    case 'water_animal': return checkWaterAnimalRules(level, x, y, z);
    case 'drowned': return checkDrownedRules(level, x, y, z, random);
    case 'slime': return checkSlimeRules(level, x, y, z, random);
    case 'mob':
    default: return true;
  }
}

/**
 * Legacy day/night gate.
 * Vanilla has no day/night spawn gate: monsters are gated purely by light
 * (Monster.isDarkEnoughToSpawn), passive mobs spawn from chunk generation and
 * from the periodic "persistent" pass. Kept for API compatibility.
 */
export function canSpawnCategoryNow(_level: ClientLevel, _categoryName: string): boolean {
  return true;
}
