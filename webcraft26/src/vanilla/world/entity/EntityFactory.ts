// Source: net.minecraft.world.entity.EntityType (factory side)
//
// Binds the concrete entity classes to their EntityType registry entries so
// that the natural spawner and the test harness can create an entity by name.

import type { ClientLevel } from '../level/ClientLevel.js';
import type { Entity } from './Entity.js';
import { ENTITY_TYPES } from './EntityType.js';

import { Zombie } from './monster/Zombie.js';
import { Skeleton } from './monster/Skeleton.js';
import { Creeper } from './monster/Creeper.js';
import { Spider } from './monster/Spider.js';
import { Enderman } from './monster/Enderman.js';
import { Silverfish } from './monster/Silverfish.js';
import { Pig } from './animal/Pig.js';
import { Cow } from './animal/Cow.js';
import { Sheep } from './animal/Sheep.js';
import { Chicken } from './animal/Chicken.js';
import { Wolf } from './animal/Wolf.js';
import { Rabbit } from './animal/Rabbit.js';
import { Bat } from './ambient/Bat.js';
import { ItemEntity } from './item/ItemEntity.js';
import { ExperienceOrb } from './ExperienceOrb.js';
import { Arrow } from './projectile/Arrow.js';

type Ctor = (level: ClientLevel) => Entity;

const CTORS: Record<string, Ctor> = {
  zombie: l => new Zombie(l),
  skeleton: l => new Skeleton(l),
  creeper: l => new Creeper(l),
  spider: l => new Spider(l),
  enderman: l => new Enderman(l),
  silverfish: l => new Silverfish(l),
  pig: l => new Pig(l),
  cow: l => new Cow(l),
  sheep: l => new Sheep(l),
  chicken: l => new Chicken(l),
  wolf: l => new Wolf(l),
  rabbit: l => new Rabbit(l),
  bat: l => new Bat(l),
  item: l => new ItemEntity(l, 0, 0, 0, { id: 'minecraft:stone', count: 1 }),
  experience_orb: l => new ExperienceOrb(l, 0, 0, 0, 1),
  arrow: l => new Arrow(l, 0, 0, 0),
};

/** Register factories on the 158-entry EntityType registry. Idempotent. */
export function registerEntityFactories(): void {
  ENTITY_TYPES.forEach(t => {
    const ctor = CTORS[t.name];
    if (ctor && !t.factory) {
      t.setFactory((level, x, y, z) => {
        const e = ctor(level);
        e.setPos(x, y, z);
        return e;
      });
    }
  });
}

/** Creates an entity by its vanilla name, or null when unimplemented. */
export function createEntity(name: string, level: ClientLevel, x: number, y: number, z: number): Entity | null {
  const t = ENTITY_TYPES.get(name);
  if (!t || !t.factory) return null;
  return t.factory(level, x, y, z);
}

export function canCreateEntity(name: string): boolean {
  const t = ENTITY_TYPES.get(name);
  return t !== undefined && t.factory !== null;
}

// register on first import
registerEntityFactories();
