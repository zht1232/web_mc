// Source: net.minecraft.world.entity.EntityType
//
// Registry of all 158 entity types. The table below is GENERATED from
// data/entities.json (158 entries: {name, w, h, fireImmune, category}). It is
// embedded as a compile-time constant because that JSON is not shipped under
// /mc/ and this module must be importable from a headless test with no fetch.
//
// A subset of types is given a concrete factory (see EntityFactory.ts); the
// remaining entries still carry exact vanilla dimensions/category/fireImmune.

import { EntityDimensions } from './EntityDimensions.js';
import { MobCategory } from './MobCategory.js';
import type { Entity } from './Entity.js';
import type { ClientLevel } from '../level/ClientLevel.js';

export type EntityFactory<T extends Entity = Entity> = (level: ClientLevel, x: number, y: number, z: number) => T;

// name, width, height, fireImmune, category  -- generated from data/entities.json
const ENTITY_ROWS: readonly (readonly [string, number, number, number, string])[] = [
  ['acacia_boat',1.375,0.5625,0,'MISC'],
  ['acacia_chest_boat',1.375,0.5625,0,'MISC'],
  ['allay',0.35,0.6,0,'CREATURE'],
  ['area_effect_cloud',6,0.5,1,'MISC'],
  ['armadillo',0.7,0.65,0,'CREATURE'],
  ['armor_stand',0.5,1.975,0,'MISC'],
  ['arrow',0.5,0.5,0,'MISC'],
  ['axolotl',0.75,0.42,0,'AXOLOTLS'],
  ['bamboo_chest_raft',1.375,0.5625,0,'MISC'],
  ['bamboo_raft',1.375,0.5625,0,'MISC'],
  ['bat',0.5,0.9,0,'AMBIENT'],
  ['bee',0.55,0.5,0,'CREATURE'],
  ['birch_boat',1.375,0.5625,0,'MISC'],
  ['birch_chest_boat',1.375,0.5625,0,'MISC'],
  ['blaze',0.6,1.8,1,'MONSTER'],
  ['block_display',0,0,0,'MISC'],
  ['bogged',0.6,1.99,0,'MONSTER'],
  ['breeze',0.6,1.77,0,'MONSTER'],
  ['breeze_wind_charge',0.3125,0.3125,0,'MISC'],
  ['camel',1.7,2.375,0,'CREATURE'],
  ['camel_husk',1.7,2.375,0,'MONSTER'],
  ['cat',0.6,0.7,0,'CREATURE'],
  ['cave_spider',0.7,0.5,0,'MONSTER'],
  ['cherry_boat',1.375,0.5625,0,'MISC'],
  ['cherry_chest_boat',1.375,0.5625,0,'MISC'],
  ['chest_minecart',0.98,0.7,0,'MISC'],
  ['chicken',0.4,0.7,0,'CREATURE'],
  ['cod',0.5,0.3,0,'WATER_AMBIENT'],
  ['copper_golem',0.49,0.98,0,'MISC'],
  ['command_block_minecart',0.98,0.7,0,'MISC'],
  ['cow',0.9,1.4,0,'CREATURE'],
  ['creaking',0.9,2.7,0,'MONSTER'],
  ['creeper',0.6,1.7,0,'MONSTER'],
  ['dark_oak_boat',1.375,0.5625,0,'MISC'],
  ['dark_oak_chest_boat',1.375,0.5625,0,'MISC'],
  ['dolphin',0.9,0.6,0,'WATER_CREATURE'],
  ['donkey',1.3965,1.5,0,'CREATURE'],
  ['dragon_fireball',1,1,0,'MISC'],
  ['drowned',0.6,1.95,0,'MONSTER'],
  ['egg',0.25,0.25,0,'MISC'],
  ['elder_guardian',1.9975,1.9975,0,'MONSTER'],
  ['enderman',0.6,2.9,0,'MONSTER'],
  ['endermite',0.4,0.3,0,'MONSTER'],
  ['ender_dragon',16,8,1,'MONSTER'],
  ['ender_pearl',0.25,0.25,0,'MISC'],
  ['end_crystal',2,2,1,'MISC'],
  ['evoker',0.6,1.95,0,'MONSTER'],
  ['evoker_fangs',0.5,0.8,0,'MISC'],
  ['experience_bottle',0.25,0.25,0,'MISC'],
  ['experience_orb',0.5,0.5,0,'MISC'],
  ['eye_of_ender',0.25,0.25,0,'MISC'],
  ['falling_block',0.98,0.98,0,'MISC'],
  ['fireball',1,1,0,'MISC'],
  ['firework_rocket',0.25,0.25,0,'MISC'],
  ['fox',0.6,0.7,0,'CREATURE'],
  ['frog',0.5,0.5,0,'CREATURE'],
  ['furnace_minecart',0.98,0.7,0,'MISC'],
  ['ghast',4,4,1,'MONSTER'],
  ['happy_ghast',4,4,0,'CREATURE'],
  ['giant',3.6,12,0,'MONSTER'],
  ['glow_item_frame',0.5,0.5,0,'MISC'],
  ['glow_squid',0.8,0.8,0,'UNDERGROUND_WATER_CREATURE'],
  ['goat',0.9,1.3,0,'CREATURE'],
  ['guardian',0.85,0.85,0,'MONSTER'],
  ['hoglin',1.3965,1.4,0,'MONSTER'],
  ['hopper_minecart',0.98,0.7,0,'MISC'],
  ['horse',1.3965,1.6,0,'CREATURE'],
  ['husk',0.6,1.95,0,'MONSTER'],
  ['illusioner',0.6,1.95,0,'MONSTER'],
  ['interaction',0,0,0,'MISC'],
  ['iron_golem',1.4,2.7,0,'MISC'],
  ['item',0.25,0.25,0,'MISC'],
  ['item_display',0,0,0,'MISC'],
  ['item_frame',0.5,0.5,0,'MISC'],
  ['jungle_boat',1.375,0.5625,0,'MISC'],
  ['jungle_chest_boat',1.375,0.5625,0,'MISC'],
  ['leash_knot',0.375,0.5,0,'MISC'],
  ['lightning_bolt',0,0,0,'MISC'],
  ['llama',0.9,1.87,0,'CREATURE'],
  ['llama_spit',0.25,0.25,0,'MISC'],
  ['magma_cube',0.52,0.52,1,'MONSTER'],
  ['mangrove_boat',1.375,0.5625,0,'MISC'],
  ['mangrove_chest_boat',1.375,0.5625,0,'MISC'],
  ['mannequin',0.6,1.8,0,'MISC'],
  ['marker',0,0,0,'MISC'],
  ['minecart',0.98,0.7,0,'MISC'],
  ['mooshroom',0.9,1.4,0,'CREATURE'],
  ['mule',1.3965,1.6,0,'CREATURE'],
  ['nautilus',0.875,0.95,0,'WATER_CREATURE'],
  ['oak_boat',1.375,0.5625,0,'MISC'],
  ['oak_chest_boat',1.375,0.5625,0,'MISC'],
  ['ocelot',0.6,0.7,0,'CREATURE'],
  ['ominous_item_spawner',0.25,0.25,0,'MISC'],
  ['painting',0.5,0.5,0,'MISC'],
  ['pale_oak_boat',1.375,0.5625,0,'MISC'],
  ['pale_oak_chest_boat',1.375,0.5625,0,'MISC'],
  ['panda',1.3,1.25,0,'CREATURE'],
  ['parched',0.6,1.99,0,'MONSTER'],
  ['parrot',0.5,0.9,0,'CREATURE'],
  ['phantom',0.9,0.5,0,'MONSTER'],
  ['pig',0.9,0.9,0,'CREATURE'],
  ['piglin',0.6,1.95,0,'MONSTER'],
  ['piglin_brute',0.6,1.95,0,'MONSTER'],
  ['pillager',0.6,1.95,0,'MONSTER'],
  ['polar_bear',1.4,1.4,0,'CREATURE'],
  ['splash_potion',0.25,0.25,0,'MISC'],
  ['lingering_potion',0.25,0.25,0,'MISC'],
  ['pufferfish',0.7,0.7,0,'WATER_AMBIENT'],
  ['rabbit',0.49,0.6,0,'CREATURE'],
  ['ravager',1.95,2.2,0,'MONSTER'],
  ['salmon',0.7,0.4,0,'WATER_AMBIENT'],
  ['sheep',0.9,1.3,0,'CREATURE'],
  ['shulker',1,1,1,'MONSTER'],
  ['shulker_bullet',0.3125,0.3125,0,'MISC'],
  ['silverfish',0.4,0.3,0,'MONSTER'],
  ['skeleton',0.6,1.99,0,'MONSTER'],
  ['skeleton_horse',1.3965,1.6,0,'CREATURE'],
  ['slime',0.52,0.52,0,'MONSTER'],
  ['small_fireball',0.3125,0.3125,0,'MISC'],
  ['sniffer',1.9,1.75,0,'CREATURE'],
  ['snowball',0.25,0.25,0,'MISC'],
  ['snow_golem',0.7,1.9,0,'MISC'],
  ['spawner_minecart',0.98,0.7,0,'MISC'],
  ['spectral_arrow',0.5,0.5,0,'MISC'],
  ['spider',1.4,0.9,0,'MONSTER'],
  ['spruce_boat',1.375,0.5625,0,'MISC'],
  ['spruce_chest_boat',1.375,0.5625,0,'MISC'],
  ['squid',0.8,0.8,0,'WATER_CREATURE'],
  ['stray',0.6,1.99,0,'MONSTER'],
  ['strider',0.9,1.7,1,'CREATURE'],
  ['sulfur_cube',0.49,0.49,0,'MONSTER'],
  ['tadpole',0.4,0.3,0,'CREATURE'],
  ['text_display',0,0,0,'MISC'],
  ['tnt',0.98,0.98,1,'MISC'],
  ['tnt_minecart',0.98,0.7,0,'MISC'],
  ['trader_llama',0.9,1.87,0,'CREATURE'],
  ['trident',0.5,0.5,0,'MISC'],
  ['tropical_fish',0.5,0.4,0,'WATER_AMBIENT'],
  ['turtle',1.2,0.4,0,'CREATURE'],
  ['vex',0.4,0.8,1,'MONSTER'],
  ['villager',0.6,1.95,0,'MISC'],
  ['vindicator',0.6,1.95,0,'MONSTER'],
  ['wandering_trader',0.6,1.95,0,'CREATURE'],
  ['warden',0.9,2.9,1,'MONSTER'],
  ['wind_charge',0.3125,0.3125,0,'MISC'],
  ['witch',0.6,1.95,0,'MONSTER'],
  ['wither',0.9,3.5,1,'MONSTER'],
  ['wither_skeleton',0.7,2.4,1,'MONSTER'],
  ['wither_skull',0.3125,0.3125,0,'MISC'],
  ['wolf',0.6,0.85,0,'CREATURE'],
  ['zoglin',1.3965,1.4,1,'MONSTER'],
  ['zombie',0.6,1.95,0,'MONSTER'],
  ['zombie_horse',1.3965,1.6,0,'MONSTER'],
  ['zombie_nautilus',0.875,0.95,0,'MONSTER'],
  ['zombie_villager',0.6,1.95,0,'MONSTER'],
  ['zombified_piglin',0.6,1.95,1,'MONSTER'],
  ['player',0.6,1.8,0,'MISC'],
  ['fishing_bobber',0.25,0.25,0,'MISC'],
];

export class EntityType<T extends Entity = Entity> {
  readonly dimensions: EntityDimensions;
  readonly width: number;
  readonly height: number;
  readonly category: MobCategory;
  readonly fireImmune: boolean;
  factory: EntityFactory<T> | null = null;

  constructor(
    readonly name: string,
    width: number,
    height: number,
    fireImmune: number,
    category: string,
  ) {
    this.width = width;
    this.height = height;
    this.dimensions = EntityDimensions.fixed(width, height);
    this.fireImmune = fireImmune !== 0;
    this.category = MobCategory.byName(category);
  }

  getCategory(): MobCategory { return this.category; }
  isFireImmune(): boolean { return this.fireImmune; }
  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }
  getDimensions(): EntityDimensions { return this.dimensions; }
  setFactory(factory: EntityFactory<T>): this { this.factory = factory; return this; }
  create(level: ClientLevel, x: number, y: number, z: number): T | null {
    return this.factory ? this.factory(level, x, y, z) : null;
  }
  toString(): string { return this.name; }
}

class EntityTypeRegistry {
  private readonly byName = new Map<string, EntityType>();
  readonly list: EntityType[] = [];

  constructor(rows: readonly (readonly [string, number, number, number, string])[]) {
    for (const [name, w, h, fire, cat] of rows) {
      const t = new EntityType(name, w, h, fire, cat);
      this.byName.set(name, t);
      this.list.push(t);
    }
  }

  get(name: string): EntityType | undefined { return this.byName.get(name); }
  require(name: string): EntityType {
    const t = this.byName.get(name);
    if (!t) throw new Error(`unknown entity type: ${name}`);
    return t;
  }
  getById(id: number): EntityType | undefined { return this.list[id]; }
  size(): number { return this.list.length; }
  forEach(cb: (t: EntityType) => void): void { for (const t of this.list) cb(t); }
}

/** The 158 vanilla entity types, generated from data/entities.json. */
export const ENTITY_TYPES = new EntityTypeRegistry(ENTITY_ROWS);

/** Convenience accessor: throws on an unknown name. */
export function entityType(name: string): EntityType { return ENTITY_TYPES.require(name); }

/** EntityTypes in #minecraft:undead (instant health hurts them, instant damage heals them). */
const UNDEAD_ENTITY_NAMES: ReadonlySet<string> = new Set([
  'zombie', 'zombie_villager', 'husk', 'drowned', 'zombified_piglin',
  'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton',
  'phantom', 'zoglin', 'zombie_horse', 'skeleton_horse', 'wither',
]);

/** EntityType.isInvertedHealAndHarm equivalent for the ported effect system. */
export function isUndeadType(name: string): boolean { return UNDEAD_ENTITY_NAMES.has(name); }
