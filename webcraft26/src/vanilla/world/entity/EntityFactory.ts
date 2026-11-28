// Source: net.minecraft.world.entity.EntityType (factory side)
//
// Binds the concrete entity classes to their EntityType registry entries so
// that the natural spawner and the test harness can create an entity by name.
//
// Every type listed in a `biomes[].spawners` table of worldgen.json that this
// port can create is bound here; the natural spawner skips the remaining types
// instead of counting them as spawn failures (see EntityManager.tryNaturalSpawn).

import type { ClientLevel } from '../level/ClientLevel.js';
import { ItemStack } from '../item/ItemStack.js';
import type { Entity } from './Entity.js';
import { ENTITY_TYPES } from './EntityType.js';

import { Zombie } from './monster/Zombie.js';
import { Drowned } from './monster/Drowned.js';
import { Husk } from './monster/Husk.js';
import { ZombieVillager } from './monster/ZombieVillager.js';
import { Skeleton } from './monster/Skeleton.js';
import { Stray } from './monster/Stray.js';
import { Bogged } from './monster/Bogged.js';
import { Parched } from './monster/Parched.js';
import { Creeper } from './monster/Creeper.js';
import { WitherSkeleton } from './monster/WitherSkeleton.js';
import { MagmaCube } from './monster/MagmaCube.js';
import { ZombifiedPiglin } from './monster/ZombifiedPiglin.js';
import { Spider } from './monster/Spider.js';
import { CaveSpider } from './monster/CaveSpider.js';
import { Enderman } from './monster/Enderman.js';
import { Silverfish } from './monster/Silverfish.js';
import { Slime } from './monster/Slime.js';
import { Witch } from './monster/Witch.js';
import { Pig } from './animal/Pig.js';
import { Cow } from './animal/Cow.js';
import { Mooshroom } from './animal/Mooshroom.js';
import { Sheep } from './animal/Sheep.js';
import { Chicken } from './animal/Chicken.js';
import { Wolf } from './animal/Wolf.js';
import { Fox } from './animal/Fox.js';
import { Rabbit } from './animal/Rabbit.js';
import { Cat, Ocelot } from './animal/Cat.js';
import { Parrot } from './animal/Parrot.js';
import { Bat } from './ambient/Bat.js';
import { Villager } from './npc/Villager.js';
import { IronGolem } from './animal/IronGolem.js';
import { Minecart } from './vehicle/Minecart.js';
import { Boat } from './vehicle/Boat.js';
import { Squid, GlowSquid, Cod, Salmon } from './animal/WaterAnimal.js';
import { ItemEntity } from './item/ItemEntity.js';
import { PrimedTnt } from './item/PrimedTnt.js';
import { FishingBobber } from './projectile/FishingBobber.js';
import { ThrownEgg } from './projectile/ThrownEgg.js';
import { ThrownPotion } from './projectile/ThrownPotion.js';
import { ExperienceOrb } from './ExperienceOrb.js';
import { Arrow } from './projectile/Arrow.js';

type Ctor = (level: ClientLevel) => Entity;

const CTORS: Record<string, Ctor> = {
  // monsters
  zombie: l => new Zombie(l),
  drowned: l => new Drowned(l),
  husk: l => new Husk(l),
  zombie_villager: l => new ZombieVillager(l),
  skeleton: l => new Skeleton(l),
  stray: l => new Stray(l),
  bogged: l => new Bogged(l),
  parched: l => new Parched(l),
  creeper: l => new Creeper(l),
  wither_skeleton: l => new WitherSkeleton(l),
  magma_cube: l => new MagmaCube(l),
  zombified_piglin: l => new ZombifiedPiglin(l),
  spider: l => new Spider(l),
  cave_spider: l => new CaveSpider(l),
  enderman: l => new Enderman(l),
  silverfish: l => new Silverfish(l),
  slime: l => new Slime(l),
  witch: l => new Witch(l),
  // passive animals
  pig: l => new Pig(l),
  cow: l => new Cow(l),
  mooshroom: l => new Mooshroom(l),
  sheep: l => new Sheep(l),
  chicken: l => new Chicken(l),
  wolf: l => new Wolf(l),
  fox: l => new Fox(l),
  rabbit: l => new Rabbit(l),
  cat: l => new Cat(l),
  ocelot: l => new Ocelot(l),
  parrot: l => new Parrot(l),
  villager: l => new Villager(l),
  iron_golem: l => new IronGolem(l),
  minecart: l => new Minecart(l, 'minecart'),
  chest_minecart: l => new Minecart(l, 'chest_minecart'),
  // ambient
  bat: l => new Bat(l),
  // water creatures
  squid: l => new Squid(l),
  glow_squid: l => new GlowSquid(l),
  cod: l => new Cod(l),
  salmon: l => new Salmon(l),
  // non-mob
  item: l => new ItemEntity(l, 0, 0, 0, ItemStack.EMPTY),
  experience_orb: l => new ExperienceOrb(l, 0, 0, 0, 1),
  arrow: l => new Arrow(l, 0, 0, 0),
  tnt: l => new PrimedTnt(l),
  fishing_bobber: l => new FishingBobber(l),
  egg: l => new ThrownEgg(l),
  splash_potion: l => new ThrownPotion(l, 0, 0, 0, false),
  lingering_potion: l => new ThrownPotion(l, 0, 0, 0, true),
};

/** Boat / raft entity types (BoatItem creates the type matching the item name). */
const BOAT_KINDS = [
  'acacia_boat', 'acacia_chest_boat',
  'bamboo_raft', 'bamboo_chest_raft',
  'birch_boat', 'birch_chest_boat',
  'cherry_boat', 'cherry_chest_boat',
  'dark_oak_boat', 'dark_oak_chest_boat',
  'jungle_boat', 'jungle_chest_boat',
  'mangrove_boat', 'mangrove_chest_boat',
  'oak_boat', 'oak_chest_boat',
  'pale_oak_boat', 'pale_oak_chest_boat',
  'spruce_boat', 'spruce_chest_boat',
];
for (const kind of BOAT_KINDS) {
  CTORS[kind] = (l: ClientLevel) => new Boat(l, kind);
}

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
