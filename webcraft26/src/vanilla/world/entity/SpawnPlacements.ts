// Source: net.minecraft.world.entity.SpawnPlacements
//
// Records where each entity type may spawn and validates a candidate position:
// solid ground below, two free blocks of headroom, and (for monsters) darkness.

import type { ClientLevel } from '../level/ClientLevel.js';
import type { EntityType } from './EntityType.js';

export enum SpawnPlacementType {
  ON_GROUND = 'ON_GROUND',
  IN_WATER = 'IN_WATER',
  IN_LAVA = 'IN_LAVA',
  NO_RESTRICTIONS = 'NO_RESTRICTIONS',
}

export interface SpawnPredicate {
  (level: ClientLevel, x: number, y: number, z: number): boolean;
}

interface Placement {
  type: SpawnPlacementType;
  predicate: SpawnPredicate | null;
}

const DEFAULT: Placement = { type: SpawnPlacementType.ON_GROUND, predicate: null };
const registry = new Map<string, Placement>();

export function registerSpawnPlacement(typeName: string, type: SpawnPlacementType, predicate: SpawnPredicate | null = null): void {
  registry.set(typeName, { type, predicate });
}

function solid(level: ClientLevel, x: number, y: number, z: number): boolean {
  const state = level.getBlockState(x, y, z);
  if (state === 0) return false;
  return level.mc.collision(state).length > 0;
}

/** Vanilla SpawnPlacements.checkSpawnRules / isSpawnPositionOk (simplified). */
export function checkSpawnRules(type: EntityType, level: ClientLevel, x: number, y: number, z: number): boolean {
  const p = registry.get(type.name) ?? DEFAULT;
  if (p.predicate && !p.predicate(level, x, y, z)) return false;

  switch (p.type) {
    case SpawnPlacementType.NO_RESTRICTIONS:
      return true;
    case SpawnPlacementType.IN_WATER:
      return level.mc.isLiquid(level.getBlockState(x, y, z));
    case SpawnPlacementType.IN_LAVA:
      return level.mc.isLiquid(level.getBlockState(x, y, z));
    case SpawnPlacementType.ON_GROUND:
    default: {
      // stand on a solid block with two free blocks above
      if (!solid(level, x, y - 1, z)) return false;
      if (solid(level, x, y, z) || solid(level, x, y + 1, z)) return false;
      // monsters only spawn in the dark
      if (type.category.name === 'MONSTER') {
        const light = level.getBrightness(x, y, z);
        if (light > 7) return false;
      }
      return true;
    }
  }
}

/** Day/night gate used by the natural spawner. */
export function canSpawnCategoryNow(level: ClientLevel, categoryName: string): boolean {
  if (categoryName === 'MONSTER') return !level.isDay();
  if (categoryName === 'CREATURE' || categoryName === 'AMBIENT' || categoryName === 'AXOLOTLS') return level.isDay();
  return true;
}
